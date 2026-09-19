/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * Long-lived manual-test machines for the lab products.
 *
 * Two VMs — `teacher` and `student` — booted from the same Packer box the acceptance run uses, each
 * carrying the freshly packaged installer for its role and an automatic desktop logon so the product
 * can be driven by hand. They are the place to look at the UI on a real Windows machine; the
 * acceptance run in lab.mjs stays disposable and is not affected by anything here.
 *
 * The three actions are deliberately asymmetric:
 *
 *   boot    refuses when the machine exists at all, running or not. A stale halted VM would silently
 *           keep the old installer and the old Windows state, which is exactly what a manual test must
 *           not do; `reset` is the explicit way to replace it.
 *   reset   destroys it first (there may be nothing to destroy) and then boots a fresh one.
 *   delete  destroys it and stops.
 *
 * Both boot and reset package the installer first and only then touch the VM: a build failure must not
 * cost the machine that is already there.
 */
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createRunner,
  enableDesktopSession,
  ensureProvider,
  ensureVmwareUtility,
  exists,
  filesServerTaskScript,
  guestAddressScript,
  guestCommand,
  guestFileServerUrl,
  initializeEnvironment,
  labInstallerName,
  labPreflight,
  validateLabConfig,
  parseGuestAddress,
  putGuestFile,
  readGuestOutput,
  sha256,
  waitForGuestFileServer,
  waitForInteractiveSession,
  withLock,
  verifyBox
} from './lab.mjs'

const labRoot = path.dirname(fileURLToPath(import.meta.url))
const manualRoot = path.join(labRoot, 'manual')
const projectRoot = path.resolve(labRoot, '..', '..')

// The state directory is per role: destroying or rebuilding one machine cannot disturb the other, and
// neither can disturb the disposable acceptance VM's `vagrant-state`.
export function manualStateDirectory(root, role) {
  return path.join(root, '.local', `vagrant-state-manual-${role}`)
}

// These machines are driven by hand, not loaded, and there are two of them next to the disposable
// acceptance VM: 4 GB each is enough for Windows, the lab service and one Electron client, and it keeps
// all three machines inside a normal developer host. The acceptance environment deliberately keeps
// guest.json's MemoryMB (8 GB) because its load case holds 32 client connections open at once, so the two
// environments no longer read the same number.
export const MANUAL_MEMORY_MB = 4096

// `ManualMemoryMB` is optional so a config.local.json written before this existed still boots; the
// default here and the Vagrantfile's fallback have to agree, which the tests pin.
export function manualMemoryMB(config = {}) {
  const value = config.ManualMemoryMB ?? MANUAL_MEMORY_MB
  if (!Number.isInteger(value) || value < 2048 || value > 262144)
    throw new Error(
      `Invalid ManualMemoryMB: expected integer 2048-262144 (or omit it for ${MANUAL_MEMORY_MB})`
    )
  return value
}

export function manualEnvironment(root, role, inherited, memory = MANUAL_MEMORY_MB) {
  return {
    ...inherited,
    VAGRANT_CWD: manualRoot,
    VAGRANT_DOTFILE_PATH: manualStateDirectory(root, role),
    LS101_MANUAL_ROLE: role,
    // `vagrant up` is a separate process, so the resolved memory reaches the Vagrantfile through the
    // environment and nowhere else.
    LS101_MANUAL_MEMORY: String(memory)
  }
}

export const manualActions = ['boot', 'reset', 'delete', 'status']

const help = `Manual-test machines for the lab products (run on a Windows x64 host)
  yarn vm:teacher:boot     Start the teacher machine; refuses if it already exists in any state
  yarn vm:teacher:reset    Destroy and recreate the teacher machine, then upload the new installer
  yarn vm:teacher:delete   Destroy the teacher machine
  yarn vm:teacher:status   Show its state
  yarn vm:student:boot     Same, for the student machine
  yarn vm:student:reset
  yarn vm:student:delete
  yarn vm:student:status

boot and reset both build the current installer on this host, import a fresh copy of the same base box,
enable automatic console logon, reboot once so it takes effect, upload the installer, and put a shortcut
to it on the desktop. They leave the machine running for manual testing.
--no-build reuses the installer already in dist/ instead of rebuilding it.`

export function parseManualAction(args) {
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
    return { action: 'help' }
  }
  const [target, ...rest] = args
  const noBuild = rest.includes('--no-build')
  const unknown = rest.filter((value) => value !== '--no-build')
  if (unknown.length) throw new Error(help)
  const [role, action] = target.split(':')
  if (!['teacher', 'student'].includes(role) || !manualActions.includes(action))
    throw new Error(help)
  return { role, action, build: !noBuild }
}

// What distinguishes the two machines on the host, in the VMware library and inside Windows.
export function manualMachine(role) {
  if (!['teacher', 'student'].includes(role)) throw new Error(`Unknown role: ${role}`)
  return {
    role,
    name: role,
    hostname: `ls101-${role}`,
    displayName: `ls101-manual-${role}`,
    // ASCII on purpose. A Chinese name travelled host -> WinRM -EncodedCommand -> here-string ->
    // Set-Content -Encoding UTF8 -> scheduled task -> powershell -File, and came out as `?????`:
    // `?` is not legal in a Windows file name, so WScript.Shell's Save() failed with "Unable to save
    // shortcut ...?????.lnk". Nothing about a test machine's convenience shortcut justifies that chain.
    desktopShortcut:
      role === 'teacher' ? 'Install LS101 Lab Teacher.lnk' : 'Install LS101 Lab Student.lnk',
    // Only the teacher machine hosts the service, so only it needs the documented HTTPS port opened
    // for the student machine to reach it.
    opensServicePort: role === 'teacher'
  }
}

// `vagrant status <name> --machine-readable` prints one `,state,` line per machine. Anything other than
// `not_created` means the machine exists, which for `boot` is a refusal — a halted VM still holds the
// previous installer and the previous Windows state.
export function machineState(output, name) {
  const lines = String(output).split(/\r?\n/)
  const state = lines
    .map((line) => line.split(','))
    .filter((fields) => fields[2] === 'state' && (fields[1] === name || fields[1] === 'default'))
    .map((fields) => fields[3])
  if (state.length === 0) throw new Error(`vagrant did not report a state for ${name}`)
  if (state.length > 1) throw new Error(`vagrant reported ${state.length} machines for ${name}`)
  return state[0]
}

export function machineExists(output, name) {
  return machineState(output, name) !== 'not_created'
}

// The desktop entry for the installer, created in the *console* session through a one-shot interactive
// task — the same mechanism the file server and the acceptance phase run use, and for the same reason:
// a WinRM logon has no interactive profile, while `[Environment]::GetFolderPath('Desktop')` and the
// WScript COM object both depend on one. Nothing in this repository touches HKCU or COM over WinRM;
// the first two real boots of this code failed here with a bare exit code 1.
//
// The guest writes its outcome to a file the file server already exposes, so a failure reaches the host
// with the guest's own words instead of an exit code. Strict: the boot stops unless it says `created`.
export const DESKTOP_ENTRY_RESULT = 'desktop-entry.txt'

export function desktopEntryScript(role, installerGuestPath) {
  const machine = manualMachine(role)
  const target = installerGuestPath.replaceAll('/', '\\')
  return [
    `$log = 'C:\\ls101-lab\\results\\${DESKTOP_ENTRY_RESULT}'`,
    `try {`,
    `  $desktop = [Environment]::GetFolderPath('Desktop')`,
    `  if (-not $desktop) { throw "GetFolderPath('Desktop') returned nothing for $env:USERNAME" }`,
    `  $path = Join-Path $desktop '${machine.desktopShortcut}'`,
    `  $shell = New-Object -ComObject WScript.Shell`,
    `  $link = $shell.CreateShortcut($path)`,
    `  $link.TargetPath = '${target}'`,
    `  $link.WorkingDirectory = 'C:\\ls101-lab\\transfers'`,
    `  $link.Description = 'LS101 Lab ${role} installer'`,
    `  $link.Save()`,
    `  Set-Content -LiteralPath $log -Encoding UTF8 -Value "created $path"`,
    `} catch {`,
    `  Set-Content -LiteralPath $log -Encoding UTF8 -Value "failed $($_.Exception.Message)"`,
    `  throw`,
    `}`
  ].join('\n')
}

// Registers that one-shot task, starts it, and waits for the result file to appear. The file is the
// authoritative outcome: a task that reports success without writing it is not a desktop entry.
export function desktopEntryTaskScript(role, installerGuestPath) {
  // The task carries the script as an encoded command instead of writing a .ps1 first: base64 of UTF-16LE
  // is plain ASCII, so nothing in the chain can re-encode it. Writing a file and reading it back with
  // `-File` is where the shortcut name came out as `?????` — and `?` is not legal in a Windows file name,
  // which is what made WScript.Shell's Save() fail.
  const encoded = Buffer.from(desktopEntryScript(role, installerGuestPath), 'utf16le').toString(
    'base64'
  )
  return [
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}' -WorkingDirectory 'C:\\ls101-lab'`,
    `$principal = New-ScheduledTaskPrincipal -UserId 'vagrant' -LogonType Interactive -RunLevel Highest`,
    `Register-ScheduledTask -TaskName 'ls101-desktop-entry' -Action $action -Principal $principal -Force | Out-Null`,
    `Remove-Item -LiteralPath 'C:\\ls101-lab\\results\\${DESKTOP_ENTRY_RESULT}' -Force -ErrorAction SilentlyContinue`,
    `Start-ScheduledTask -TaskName 'ls101-desktop-entry'`
  ].join('\n')
}

// Reads the outcome over WinRM rather than the file server: the result is one line, and the bulk channel
// has no business carrying it (it is also the channel that died in the run this replaced).
export function desktopEntryProbeScript() {
  const log = `C:\\ls101-lab\\results\\${DESKTOP_ENTRY_RESULT}`
  return [
    `$log = '${log}'`,
    `if (Test-Path -LiteralPath $log) { 'result=' + ((Get-Content -LiteralPath $log -Raw).Trim()) } else { 'result=pending' }`,
    `$task = Get-ScheduledTask -TaskName 'ls101-desktop-entry' -ErrorAction SilentlyContinue`,
    `if ($task) { 'state=' + $task.State } else { 'state=missing' }`
  ].join('\n')
}

async function waitForDesktopEntry({ run }) {
  const deadline = Date.now() + 60000
  let polls = 0
  let last = 'no answer'
  for (;;) {
    const output = run(
      'vagrant.exe',
      ['winrm', '--command', guestCommand(desktopEntryProbeScript())],
      { capture: true }
    )
    const result = (/result=(.*)/.exec(output)?.[1] ?? '').trim()
    const state = (/state=(.*)/.exec(output)?.[1] ?? '').trim()
    last = `result='${result}' state='${state}'`
    // PowerShell 5.1 writes UTF-8 with a BOM, which is not part of the message.
    const line = result.replace(/^\uFEFF/, '')
    if (line.startsWith('created')) return line
    if (line.startsWith('failed'))
      throw new Error(`The desktop entry was not created: ${line || 'the guest wrote nothing'}`)
    polls += 1
    // A finished task that wrote nothing has nothing more to say; saying so beats waiting out the clock.
    if (state === 'Ready' && polls >= 3)
      throw new Error(`The desktop entry task finished without writing a result (${last})`)
    if (Date.now() >= deadline)
      throw new Error(
        `The desktop entry task produced no result within 60 s (${last}); the interactive session may not be running it`
      )
    await sleep(2000)
  }
}

// Host and base-box checks, run before anything is built or destroyed. `labPreflight` is a version check
// and the box check hashes the base image, so both are cheap next to packaging, and they fail with a
// message that names the real problem (a missing box, the wrong Node version) instead of an installer
// error later. Exported because it is part of the contract callers may replace in tests.
export async function manualPreflight(root, run) {
  const winswPath = path.join(projectRoot, 'externals/lab/windows/WinSW.NET461.exe')
  labPreflight({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    winswSha256: (await exists(winswPath)) ? await sha256(winswPath) : ''
  })
  await verifyBox(root)
  ensureProvider(run)
  ensureVmwareUtility(run)
}

async function packageInstaller(role, { run, build }) {
  const metadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const version = metadata.version
  const name = labInstallerName(role, version)
  const file = path.join(projectRoot, 'dist', `lab-${role}`, name)
  if (!build && (await exists(file))) {
    console.log(`Reusing ${name}`)
    return { name, file, version, bytes: (await stat(file)).size }
  }
  console.log(`Packaging the ${role} installer from the current source tree`)
  run(process.execPath, [path.join(projectRoot, 'scripts', 'lab', 'package-desktop.mjs'), role], {
    cwd: projectRoot
  })
  if (!(await exists(file))) throw new Error(`Packaging did not produce ${name}`)
  return { name, file, version, bytes: (await stat(file)).size }
}

async function startMachine(role, { config, run, installer }) {
  const machine = manualMachine(role)
  run('vagrant.exe', ['up', machine.name, '--provider', 'vmware_desktop'])
  // The base box deliberately ships without automatic logon. A manual test needs the console desktop,
  // and the helper reboots once because logon settings only apply at boot.
  await enableDesktopSession(config, run)
  const sessions = await waitForInteractiveSession(run)
  if (!sessions) throw new Error('The manual machine did not reach an interactive desktop session')
  // Bulk input travels over the guest file server on the guest's own NAT address, as in the acceptance
  // run: 100 MB over WinRM is slow, and the streaming PUT verifies the byte count itself. The server
  // itself is a script the guest does not have yet, so it has to be uploaded *before* the task that runs
  // it is registered — a task pointing at a file that does not exist starts, fails and leaves the host
  // waiting for a port that never opens.
  run('vagrant.exe', [
    'upload',
    path.join(labRoot, 'guest', 'fileserver.mjs'),
    'C:/ls101-lab/fileserver.mjs'
  ])
  run('vagrant.exe', ['winrm', '--command', guestCommand(filesServerTaskScript(config))])
  const baseUrl = await guestFileServerUrl(run)
  try {
    await waitForGuestFileServer({ baseUrl })
  } catch (error) {
    // The reason is inside the guest: a missing script, a crashed process or a task that never got a
    // user session. Without this the host only reports that a port did not answer.
    console.error(`Guest file server did not answer on ${baseUrl}; collecting its state:`)
    try {
      console.error(
        readGuestOutput(
          run,
          [
            `Get-ScheduledTask -TaskName 'ls101-files' | Select-Object State | Format-List`,
            `Get-ScheduledTaskInfo -TaskName 'ls101-files' | Select-Object LastRunTime, LastTaskResult | Format-List`,
            `if (Test-Path 'C:\\ls101-lab\\results\\fileserver.log') { Get-Content 'C:\\ls101-lab\\results\\fileserver.log' -Tail 20 } else { 'no fileserver.log' }`,
            `Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, StartTime | Format-Table`
          ].join('\n')
        )
      )
    } catch (diagnosticError) {
      console.error(`The guest state could not be read: ${diagnosticError.message}`)
    }
    throw error
  }
  const bytes = await putGuestFile(installer.file, installer.name, { baseUrl })
  const address = parseGuestAddress(readGuestOutput(run, guestAddressScript(), { quiet: true }))
  const guestInstaller = `C:/ls101-lab/transfers/${installer.name}`
  // Strict: the boot continues only when the guest reports that the entry exists, and any refusal comes
  // back with its own message rather than as an exit code.
  run('vagrant.exe', [
    'winrm',
    '--command',
    guestCommand(desktopEntryTaskScript(role, guestInstaller))
  ])
  await waitForDesktopEntry({ run })
  // Both clients show the activation screen first, so the manual machine needs the invitation code
  // somewhere reachable. It travels the same way the acceptance run sends it — a file uploaded over the
  // encrypted WinRM channel — and never through the plain-HTTP file server that carries bulk files.
  const invitationCode = validateLabConfig(config)
  const temporary = path.join(tmpdir(), `ls101-invitation-${randomUUID()}.txt`)
  await writeFile(temporary, invitationCode, { mode: 0o600 })
  try {
    run('vagrant.exe', ['upload', temporary, 'C:/ls101-lab/invitation.txt'])
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
  if (machine.opensServicePort) {
    // The product opens no port by itself (that is a deployment step and the acceptance run asserts as
    // much); a manual test with two machines needs it, so it is done here and printed below.
    run('vagrant.exe', [
      'winrm',
      '--command',
      guestCommand(
        [
          `$rule = Get-NetFirewallRule -Name 'LS101-Lab-HTTPS' -ErrorAction SilentlyContinue`,
          `if (-not $rule) { New-NetFirewallRule -Name 'LS101-Lab-HTTPS' -DisplayName 'LS101 Lab HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443 -RemoteAddress LocalSubnet | Out-Null }`
        ].join('\n')
      )
    ])
  }
  console.log('')
  console.log(`The ${role} machine is running and ready for manual testing.`)
  console.log(`  VMware window : ${machine.displayName} (console, automatic logon as vagrant)`)
  // Printed on purpose: these machines exist for manual testing, and the login has to be available
  // without reading config.local.json by hand. It never reaches the host result file — only console
  // output — and the automatic-logon script is uploaded as a file rather than passed as an argument.
  console.log(`  guest login   : vagrant / ${config.GuestPassword}`)
  console.log(`  guest address : ${address ?? 'unknown'}`)
  console.log(`  installer     : ${guestInstaller} (${Math.round(bytes / (1024 * 1024))} MiB)`)
  console.log(`  desktop       : shortcut "${machine.desktopShortcut}" - run it yourself`)
  console.log(`  file uploads  : ${baseUrl}/files/<name> (PUT) while this machine lives`)
  console.log('  invitation    : C:\\ls101-lab\\invitation.txt (the activation screen needs it)')
  if (machine.opensServicePort)
    console.log('  8443 inbound is open on this machine so the student machine can connect to it.')
  if (role === 'student')
    console.log(
      "  the teacher machine's address and public-key fingerprint come from its connection page"
    )
  console.log('')
  console.log(`Rebuild it with yarn vm:${role}:reset, remove it with yarn vm:${role}:delete.`)
}

// Exported so the ordering rules below can be tested without a lock, a report file or a real config:
// `main` wraps this with the host checks, and the tests that care about ordering call it directly.
export async function withMachine(
  role,
  action,
  { run, build, config, preflight, package: packageStep }
) {
  const machine = manualMachine(role)
  // One status call answers every question this function asks; `vagrant status` on a single-machine
  // environment is cheap but not free, and the three actions must not disagree about what they saw.
  const currentState = machineState(
    run('vagrant.exe', ['status', machine.name, '--machine-readable'], {
      capture: true,
      quiet: true
    }),
    machine.name
  )
  const existing = currentState !== 'not_created'
  if (action === 'status') {
    console.log(`${machine.displayName}: ${currentState}`)
    if (currentState !== 'not_created')
      console.log(`guest login: vagrant / ${config.GuestPassword}`)
    return
  }
  if (action === 'delete') {
    if (!existing) {
      console.log(`The ${role} machine does not exist; nothing to delete.`)
      return
    }
    run('vagrant.exe', ['destroy', '--force', machine.name])
    console.log(`The ${role} machine was destroyed.`)
    return
  }
  if (action === 'boot' && existing) {
    throw new Error(
      `The ${role} machine already exists (${currentState}). boot never reuses one: run yarn vm:${role}:reset to rebuild it, or yarn vm:${role}:delete to remove it.`
    )
  }
  // Everything that can fail runs before the VM is touched: the host and base-box checks first (cheap,
  // and they name the real problem), then the build. A failure in any of them leaves an existing machine
  // exactly as it was rather than half replaced.
  await preflight()
  const installer = await packageStep(role, { run, build })
  if (existing) run('vagrant.exe', ['destroy', '--force', machine.name])
  await startMachine(role, { config, run, installer })
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const parsed = parseManualAction(args)
  if (parsed.action === 'help') {
    console.log(help)
    return
  }
  const root = dependencies.root ?? labRoot
  if (
    (dependencies.platform ?? process.platform) !== 'win32' ||
    (dependencies.arch ?? process.arch) !== 'x64'
  ) {
    throw new Error('Manual-test machines require a Windows x64 host (not WSL).')
  }
  return withLock(path.join(root, '.local'), async () => {
    const report = { action: `${parsed.role}:${parsed.action}`, steps: [], success: false }
    const reportPath = path.join(
      root,
      '.local',
      'results',
      `${Date.now()}-manual-${parsed.role}-${parsed.action}.json`
    )
    try {
      // The config is read before the environment is built, because the memory these machines get travels
      // to the Vagrantfile through it. It stays inside the `try` so that a broken config still leaves a
      // report saying so, like every other failure.
      const config = JSON.parse(await readFile(path.join(root, 'config.local.json'), 'utf8'))
      const env = manualEnvironment(
        root,
        parsed.role,
        await initializeEnvironment(root),
        manualMemoryMB(config)
      )
      await mkdir(env.VAGRANT_DOTFILE_PATH, { recursive: true })
      const run = createRunner(manualRoot, env, report, dependencies.spawn)
      await withMachine(parsed.role, parsed.action, {
        run,
        build: parsed.build !== false,
        config,
        preflight: dependencies.preflight ?? (() => manualPreflight(root, run)),
        package: dependencies.package ?? packageInstaller
      })
      report.success = true
    } catch (error) {
      // The report is the only artefact a failed boot leaves behind, so it has to say what happened.
      report.error = error.message
      throw error
    } finally {
      report.finishedAt = new Date().toISOString()
      // A failure before `initializeEnvironment` ran (an unreadable config) leaves `.local/results`
      // missing; without this the report write would fail with its own ENOENT and hide that reason.
      await mkdir(path.dirname(reportPath), { recursive: true })
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
      console.log(`Host result: ${reportPath}`)
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
