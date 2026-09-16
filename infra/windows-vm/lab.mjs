/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  exists,
  sha256,
  verifyHash,
  downloadAsset,
  validateIsoConfig,
  prepareIsos,
  resolveIsoHashes
} from './assets.mjs'
export { exists, sha256, verifyHash } from './assets.mjs'

const labRoot = path.dirname(fileURLToPath(import.meta.url))
const boxFile = 'ls101-windows-server-2022-vmware.box'
const actions = [
  'setup',
  'init',
  'prepare',
  'box:validate',
  'box:build',
  'up',
  'status',
  'halt',
  'destroy',
  'cycle'
  ,'acceptance'
]
const help = `Windows VMware lab (run on a Windows x64 host with Node and Yarn)
  yarn vm:setup         Initialize config, download assets and build (or verify/reuse) box
  yarn vm:init          Create config.local.json with a random test password
  yarn vm:prepare       Download official ISOs/tools, record hashes, initialize Packer
  yarn vm:box:validate  Validate the independent base-box template
  yarn vm:box:build     Build the base box; never copy application code
  yarn vm:up            Install the pinned provider if needed, import box, boot VM
  yarn vm:status        Show this project's VM state
  yarn vm:halt          Shut down this project's VM
  yarn vm:destroy       Destroy this project's VM without a prompt; retain base box
  yarn vm:cycle         Require a fresh VM, boot, shut down, destroy; record outcome
  yarn vm:acceptance    Run Windows product documentation tests in a fresh disposable VM
  yarn vm --help        Show this help

Default ISO URLs download automatically and record first-download SHA-256 values.
For custom/local ISOs, set the URL/path and a reviewed SHA-256 in config.local.json.
Host requirements: VMware Workstation, Vagrant, Vagrant VMware Utility.
Only the disposable Vagrant VM is destroyed. The base box and build output are retained.
cycle verifies VM lifecycle/WinRM readiness, not application or desktop tests.
acceptance uploads the current source tree, enables automatic console logon, installs
dependencies in the lightweight product-docs setup mode, runs yarn test:product-docs through
an interactive scheduled task, exports the guest log and the product documentation preview
artifacts, and destroys the VM only after a successful run.`

export function parseAction(args) {
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) return 'help'
  if (args.length !== 1 || !actions.includes(args[0])) throw new Error(help)
  return args[0]
}

export function validateConfig(config) {
  for (const key of ['PackerVersion', 'NodeVersion', 'MinGitVersion']) {
    if (typeof config[key] !== 'string' || !/^\d+\.\d+\.\d+$/.test(config[key])) {
      throw new Error(`Invalid ${key}: expected a numeric x.y.z version`)
    }
  }
  if (config.PackerVersion !== '1.14.1')
    throw new Error('PackerVersion must match packer/windows.pkr.hcl (1.14.1)')
  if (!/^v\d+\.\d+\.\d+\.windows\.\d+$/.test(config.MinGitRelease))
    throw new Error('Invalid MinGitRelease')
  for (const key of ['PackerSha256', 'NodeSha256', 'MinGitSha256']) {
    if (typeof config[key] !== 'string' || !/^[a-f\d]{64}$/i.test(config[key])) {
      throw new Error(`Fill in the reviewed ${key} in config.local.json`)
    }
  }
  for (const key of ['WindowsIso', 'VMwareToolsIso']) {
    if (typeof config[key] !== 'string' || !config[key].trim() || /[\r\n\0]/.test(config[key]))
      throw new Error(`Invalid ${key}`)
  }
  for (const [key, min, max] of [
    ['WindowsImageIndex', 1, 100],
    ['Cpus', 1, 64],
    ['MemoryMB', 2048, 262144],
    ['DiskMB', 32768, 2097152]
  ]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max)
      throw new Error(`Invalid ${key}: expected integer ${min}–${max}`)
  }
  validateIsoConfig(config)
  const password = config.GuestPassword
  if (
    typeof password !== 'string' ||
    !/^[A-Za-z\d!#._-]{12,64}$/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/\d/.test(password) ||
    !/[!#._-]/.test(password)
  ) {
    throw new Error(
      'GuestPassword requires 12–64 allowed characters, uppercase, lowercase, digit and !#._-'
    )
  }
  return config
}

export async function initializeEnvironment(root, inherited = process.env) {
  const local = path.join(root, '.local')
  const env = { ...inherited }
  for (const [key, subdirectory] of Object.entries({
    PACKER_CACHE_DIR: 'cache/packer',
    PACKER_PLUGIN_PATH: 'tools/packer-plugins',
    PACKER_CONFIG_DIR: 'config/packer',
    VAGRANT_HOME: 'vagrant-home',
    VAGRANT_DOTFILE_PATH: 'vagrant-state',
    TEMP: 'tmp',
    TMP: 'tmp'
  })) {
    env[key] = path.join(local, subdirectory)
    await mkdir(env[key], { recursive: true })
  }
  for (const directory of [
    'downloads',
    'build',
    'boxes',
    'vms',
    'logs',
    'generated',
    'transfers',
    'results'
  ]) {
    await mkdir(path.join(local, directory), { recursive: true })
  }
  return Object.assign(env, {
    VAGRANT_CWD: root,
    VAGRANT_VAGRANTFILE: 'Vagrantfile',
    VAGRANT_DEFAULT_PROVIDER: 'vmware_desktop',
    VAGRANT_NONINTERACTIVE: '1',
    CHECKPOINT_DISABLE: '1',
    PACKER_LOG: '1',
    PACKER_LOG_PATH: path.join(local, 'logs', 'packer.log'),
    // Vagrant's forwarded WinRM endpoint is local; never send it through a
    // host HTTPS proxy (common with Clash/V2Ray environments).
    NO_PROXY: [env.NO_PROXY, env.no_proxy, '127.0.0.1', 'localhost'].filter(Boolean).join(','),
    no_proxy: [env.no_proxy, env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',')
  })
}

export async function withLock(local, callback) {
  const file = path.join(local, 'operation.lock')
  let handle
  try {
    handle = await open(file, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    throw new Error(
      `Another lab operation holds ${file}. If a previous process crashed, confirm Node/Packer/Vagrant have exited before removing that lock.`
    )
  }
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
    )
    return await callback()
  } finally {
    await handle.close()
    await unlink(file)
  }
}

// Console and report readability aid: an encoded payload is unreadable by design, so every step
// that uses one logs the decoded script instead of the blob. This is safe only because scripts
// sent through `guestCommand` never contain credentials (see the note there); a decoded script is
// plain text and would otherwise expose whatever it contains.
export function decodeGuestCommand(args) {
  const match = /-EncodedCommand\s+(\S+)/.exec(args.at(-1) ?? '')
  if (!match) return null
  return Buffer.from(match[1], 'base64').toString('utf16le')
}

// First meaningful line of a decoded script, short enough for an error message.
export function firstScriptLine(script, limit = 100) {
  const line = script.split(/\r?\n/).find((entry) => entry.trim()) ?? ''
  const trimmed = line.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed
}

export function describeStep(command, args, script, previewLines = 12) {
  const printable = args.map((arg) =>
    arg.replace(/-EncodedCommand\s+\S+/, '-EncodedCommand <base64, decoded below>')
  )
  if (script === null || script === undefined) return `${command} ${printable.join(' ')}`
  const lines = script.split(/\r?\n/)
  while (lines.length > 1 && !lines.at(-1).trim()) lines.pop()
  const head = lines.slice(0, previewLines)
  const omitted = lines.length - head.length
  const body = head.map((line) => `      ${line}`).join('\n')
  return [
    `${command} ${printable.join(' ')}  (encoded PowerShell, ${lines.length} lines)`,
    body,
    omitted > 0 ? `      … ${omitted} more line(s)` : null
  ]
    .filter(Boolean)
    .join('\n')
}

export function createRunner(root, env, report, spawn = spawnSync) {
  // `quiet` keeps repeated polling commands out of the console and out of the report steps, which
  // would otherwise fill both with encoded PowerShell.
  return (command, args, { capture = false, extraEnv = {}, cwd = root, quiet = false } = {}) => {
    const step = { command: path.basename(command), args, startedAt: new Date().toISOString() }
    const script = decodeGuestCommand(args)
    if (script !== null) step.script = script
    if (!quiet) {
      report.steps.push(step)
      console.log(`Running ${describeStep(step.command, args, script)}`)
    }
    const result = spawn(command, args, {
      cwd,
      env: { ...env, ...extraEnv },
      shell: false,
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
      maxBuffer: 4 * 1024 * 1024
    })
    step.finishedAt = new Date().toISOString()
    step.exitCode = result.status ?? null
    step.signal = result.signal ?? null
    if (result.error || result.status !== 0) {
      // Do not persist captured output or environment, which can contain guest credentials.
      if (capture && result.stderr) process.stderr.write(result.stderr)
      // Name what the failing command was doing: `vagrant.exe winrm failed (1)` alone says nothing.
      const intent = script === null ? '' : `; script: ${firstScriptLine(script)}`
      throw new Error(
        `${step.command} ${args[0] ?? ''} failed (${result.error?.code ?? result.signal ?? result.status})${intent}`
      )
    }
    return result.stdout ?? ''
  }
}

function assets(root, config) {
  const downloads = path.join(root, '.local', 'downloads')
  return {
    packer: {
      file: path.join(downloads, `packer_${config.PackerVersion}_windows_amd64.zip`),
      hash: config.PackerSha256,
      url: `https://releases.hashicorp.com/packer/${config.PackerVersion}/packer_${config.PackerVersion}_windows_amd64.zip`
    },
    node: {
      file: path.join(downloads, `node-v${config.NodeVersion}-win-x64.zip`),
      hash: config.NodeSha256,
      url: `https://nodejs.org/dist/v${config.NodeVersion}/node-v${config.NodeVersion}-win-x64.zip`
    },
    git: {
      file: path.join(downloads, `MinGit-${config.MinGitVersion}-64-bit.zip`),
      hash: config.MinGitSha256,
      url: `https://github.com/git-for-windows/git/releases/download/${config.MinGitRelease}/MinGit-${config.MinGitVersion}-64-bit.zip`
    }
  }
}

function extract(run, archive, destination) {
  // A single Windows built-in ZIP operation. All orchestration and config parsing are JS.
  // Paths arrive as environment values, never interpolated into PowerShell source.
  const script =
    "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:LS101_VM_ARCHIVE -DestinationPath $env:LS101_VM_DESTINATION -Force"
  run(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ],
    {
      extraEnv: { LS101_VM_ARCHIVE: archive, LS101_VM_DESTINATION: destination }
    }
  )
}

async function prepare(root, config, run) {
  const isos = await prepareIsos(root, config)
  const downloads = assets(root, config)
  for (const asset of Object.values(downloads))
    await downloadAsset(asset.url, asset.file, asset.hash)
  extract(
    run,
    downloads.packer.file,
    path.join(root, '.local', 'tools', `packer-${config.PackerVersion}`)
  )
  run(packerPath(root, config), ['init', packerTemplatePath(root)])
  await writeFile(
    path.join(root, '.local', 'logs', 'asset-inventory.json'),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        assets: [...Object.values(downloads), ...isos]
      },
      null,
      2
    ) + '\n'
  )
}

function packerPath(root, config) {
  return path.join(root, '.local', 'tools', `packer-${config.PackerVersion}`, 'packer.exe')
}

function packerTemplatePath(root) {
  // Packer file()/templatefile() resolve relative paths against the template directory.
  // An absolute path.root prevents "packer/packer/..." when HCL joins path.root again.
  return path.resolve(root, 'packer').replaceAll('\\', '/')
}

export async function buildBox(root, config, run, validateOnly) {
  config = await resolveIsoHashes(root, config)
  const local = path.join(root, '.local')
  const output = path.join(local, 'build', 'windows-server-2022')
  const box = path.join(local, 'boxes', boxFile)
  const guestFile = path.join(local, 'generated', 'guest.json')
  if (
    !validateOnly &&
    ((await exists(output)) ||
      (await exists(box)) ||
      (await exists(`${box}.sha256`)) ||
      (await exists(guestFile)))
  ) {
    throw new Error(
      'Base-box output or guest metadata already exists. Archive it explicitly before rebuilding; no automatic overwrite.'
    )
  }
  const downloads = assets(root, config)
  for (const asset of Object.values(downloads)) await verifyHash(asset.file, asset.hash)
  await verifyHash(path.resolve(root, config.WindowsIso), config.WindowsIsoSha256)
  await verifyHash(path.resolve(root, config.VMwareToolsIso), config.VMwareToolsIsoSha256)
  extract(run, downloads.packer.file, path.dirname(packerPath(root, config)))
  const slash = (value) => value.replaceAll('\\', '/')
  const variables = {
    windows_iso: slash(path.resolve(root, config.WindowsIso)),
    windows_iso_sha256: config.WindowsIsoSha256,
    tools_iso: slash(path.resolve(root, config.VMwareToolsIso)),
    tools_iso_sha256: config.VMwareToolsIsoSha256,
    node_zip: slash(downloads.node.file),
    node_sha256: config.NodeSha256,
    node_version: config.NodeVersion,
    git_zip: slash(downloads.git.file),
    git_sha256: config.MinGitSha256,
    image_index: config.WindowsImageIndex,
    guest_password: config.GuestPassword,
    cpus: config.Cpus,
    memory: config.MemoryMB,
    disk_size: config.DiskMB,
    output_directory: slash(output),
    box_output: slash(box)
  }
  const varsPath = path.join(local, 'generated', 'build.pkrvars.json')
  await writeFile(varsPath, JSON.stringify(variables, null, 2) + '\n', { mode: 0o600 })
  run(packerPath(root, config), ['validate', `-var-file=${varsPath}`, packerTemplatePath(root)])
  if (validateOnly) return
  // Preserve the VM and attached bootstrap media on failure for diagnosis.
  // Packer's default cleanup otherwise deletes the VM before it can be inspected.
  run(packerPath(root, config), [
    'build',
    '-on-error=abort',
    `-var-file=${varsPath}`,
    packerTemplatePath(root)
  ])
  const hash = await sha256(box)
  await writeFile(`${box}.sha256`, `${hash}\n`, { flag: 'wx' })
  // Publish credentials only after a successful build; validate cannot change a running VM's password.
  await writeFile(
    guestFile,
    JSON.stringify(
      {
        username: 'vagrant',
        password: config.GuestPassword,
        cpus: config.Cpus,
        memory: config.MemoryMB,
        box_sha256: hash
      },
      null,
      2
    ) + '\n',
    { flag: 'wx', mode: 0o600 }
  )
}

export async function verifyBox(root) {
  const box = path.join(root, '.local', 'boxes', boxFile)
  const guest = JSON.parse(
    await readFile(path.join(root, '.local', 'generated', 'guest.json'), 'utf8')
  )
  const checksum = (await readFile(`${box}.sha256`, 'utf8')).trim()
  if (!guest.password || guest.username !== 'vagrant' || checksum !== guest.box_sha256) {
    throw new Error(
      'Base-box credentials/checksum metadata is missing or inconsistent. Build with yarn vm:box:build.'
    )
  }
  await verifyHash(box, checksum)
}

export function ensureProvider(run) {
  const output = run('vagrant.exe', ['plugin', 'list'], { capture: true })
  const match = output.match(/^vagrant-vmware-desktop\s+\(([^,)\s]+)/m)
  if (match && match[1] !== '3.0.5')
    throw new Error(
      `Expected VMware provider 3.0.5; found ${match[1]} in this project's VAGRANT_HOME`
    )
  if (!match)
    run('vagrant.exe', [
      'plugin',
      'install',
      'vagrant-vmware-desktop',
      '--plugin-version',
      '3.0.5',
      '--plugin-clean-sources',
      '--plugin-source',
      'https://rubygems.org'
    ])
}

export function ensureVmwareUtility(run) {
  // Vagrant's VMware provider requires the host utility service on 127.0.0.1:9922.
  // Start it when installed but stopped; leave a focused error when it is absent.
  const script =
    "$service = Get-Service -Name 'VagrantVMware' -ErrorAction Stop; if ($service.Status -ne 'Running') { $elevated = \"`$ErrorActionPreference = 'Stop'; Start-Service -Name 'VagrantVMware' -ErrorAction Stop\"; $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($elevated)); $child = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded); if ($child.ExitCode -ne 0) { throw \"elevated service start failed with exit code $($child.ExitCode)\" } }; $service = Get-Service -Name 'VagrantVMware'; if ($service.Status -ne 'Running') { throw 'Vagrant VMware Utility service is not running' }; Write-Output $service.Status"
  try {
    const output = run('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], { capture: true })
    if (!/Running/i.test(output)) throw new Error('service did not report Running')
  } catch (error) {
    throw new Error(
      `Vagrant VMware Utility is unavailable on 127.0.0.1:9922. Install/start the 'vagrant-vmware-utility' service, then retry. ${error.message}`
    )
  }
}

export async function lifecycle(action, run, prepareUp, ensureUtility = () => {}) {
  if (action === 'up') {
    await prepareUp()
    ensureUtility(run)
    run('vagrant.exe', ['up', '--provider', 'vmware_desktop'])
    return
  }
  if (action !== 'cycle') {
    run('vagrant.exe', action === 'destroy' ? ['destroy', '--force'] : [action])
    return
  }
  await prepareUp()
  ensureUtility(run)
  const status = run('vagrant.exe', ['status', '--machine-readable'], { capture: true })
  const states = status
    .split(/\r?\n/)
    .filter((line) => line.split(',')[2] === 'state')
    .map((line) => line.split(',')[3])
  if (states.length !== 1 || states[0] !== 'not_created') {
    throw new Error(
      'vm:cycle requires no existing VM. Use vm:halt or vm:destroy explicitly for an existing VM.'
    )
  }
  const failures = []
  try {
    run('vagrant.exe', ['up', '--provider', 'vmware_desktop'])
  } catch (error) {
    failures.push(error)
  } finally {
    // Attempt both cleanup operations even if up or graceful shutdown failed.
    for (const args of [['halt'], ['destroy', '--force']]) {
      try {
        run('vagrant.exe', args)
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length)
    throw new AggregateError(failures, failures.map((error) => error.message).join('; '))
}

const GUEST_ARTIFACT = 'C:/ls101-lab/results/acceptance-artifacts.zip'
const GUEST_STATUS = 'C:/ls101-lab/results/status.txt'
const GUEST_PROGRESS = 'C:/ls101-lab/results/progress.txt'
const GUEST_LOG = 'C:/ls101-lab/results/acceptance.log'
const GUEST_DESKTOP_SCRIPT = 'C:/ls101-lab/enable-desktop-session.ps1'
const ACCEPTANCE_TASK = 'ls101-acceptance'
// 0x800704DD ERROR_NO_TOKEN, reported when an interactive task starts without a user session.
const TASK_LOGON_UNAVAILABLE = 2147943645
// Task Scheduler informational results: still running and has not run yet.
const TASK_RUNNING = 267009
const TASK_NOT_RUN = 267011
const GUEST_STATE_PREFIX = 'LS101STATE|'
const ACCEPTANCE_TIMEOUT_MS = 60 * 60 * 1000
const ACCEPTANCE_POLL_MS = 15 * 1000
const SESSION_TIMEOUT_MS = 5 * 60 * 1000
const SESSION_POLL_MS = 5 * 1000
const GUEST_ARTIFACT_CHUNK = 512 * 1024
const GUEST_ARTIFACT_LIMIT = 512 * 1024 * 1024

// Sends a PowerShell script to the guest. `-EncodedCommand` takes the script as base64 of its
// UTF-16LE bytes, which is the only form that survives the trip intact: the text passes through
// Node, `vagrant winrm`, cmd.exe and WinRM XML, and plain quoting would be re-escaped or expanded
// at each layer. Only scripts without credentials may be encoded; a base64 blob decodes to plain
// text, so the automatic logon password travels as an uploaded file instead (see below).
export function guestCommand(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return `powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}`
}

// PowerShell literals need backslashes; the constants above use forward slashes for readability.
export function guestPath(file) {
  return file.replaceAll('/', '\\')
}

// The application only resolves its startup promise after the renderer DOM is ready and the main
// window is shown, and Electron cannot show a window in the session-0 context of a WinRM command.
// Acceptance therefore enables console logon for the disposable VM and runs the suite through an
// interactive scheduled task.
//
// Registry contract used by Windows console logon:
//   AutoAdminLogon=1     log on automatically at boot instead of waiting at the logon screen
//   DefaultUserName      the account WinRM also uses, so files stay readable by both
//   DefaultDomainName    the local machine, because `vagrant` is a local account
//   DefaultPassword      the generated GuestPassword, stored in the disposable VM only
//   AutoLogonCount       removed before setting AutoAdminLogon: a leftover count from the
//                        unattended installation stops automatic logon after that many runs.
// The password is validated against the same character set that validateConfig enforces, so it can
// never break out of the single-quoted PowerShell literal below.
export function desktopSessionScript(password) {
  if (!/^[A-Za-z\d!#._-]{12,64}$/.test(password)) {
    throw new Error('GuestPassword cannot be embedded in the desktop session script')
  }
  return `$ErrorActionPreference = 'Stop'
$winlogon = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'
Remove-ItemProperty -Path $winlogon -Name AutoLogonCount -ErrorAction SilentlyContinue
Set-ItemProperty -Path $winlogon -Name AutoAdminLogon -Value '1' -Type String
Set-ItemProperty -Path $winlogon -Name DefaultUserName -Value 'vagrant' -Type String
Set-ItemProperty -Path $winlogon -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String
Set-ItemProperty -Path $winlogon -Name DefaultPassword -Value '${password}' -Type String
# Keep the disposable desktop free of the Server Manager launch window. This is cosmetic, so it
# must never abort the logon configuration above.
try {
  $serverManager = 'HKLM:\\SOFTWARE\\Microsoft\\ServerManager'
  if (-not (Test-Path -LiteralPath $serverManager)) { New-Item -Path $serverManager | Out-Null }
  Set-ItemProperty -Path $serverManager -Name DoNotOpenServerManagerAtLogon -Value 1 -Type DWord
} catch {
  Write-Output "Server Manager suppression skipped: $_"
}
Write-Output 'Automatic console logon enabled for the disposable acceptance VM.'
`
}

// qwinsta prints SESSIONNAME, USERNAME, ID, STATE, TYPE. Only a session with a user name before the
// numeric ID hosts a desktop; a bare console or the services session has no user and cannot. The
// check deliberately ignores the localized state word and the header row.
export function hasInteractiveSession(output) {
  return output.split(/\r?\n/).some((line) => {
    const fields = line.trim().split(/\s+/)
    return fields.length >= 4 && !/^\d+$/.test(fields[1]) && /^\d+$/.test(fields[2])
  })
}

// Registers the acceptance run as a scheduled task instead of running it through WinRM, because
// only an interactive logon session has a desktop that Electron can show a window on:
//   -LogonType Interactive  runs in the console session of the logged-on user; it needs no stored
//                           password, which is why no credential is sent to the guest here
//   -RunLevel Highest       the guest script installs dependencies and starts Electron
//   ExecutionTimeLimit      bounds a hung suite; the host has its own timeout as well
//   -Force                  re-registers a leftover task from an earlier attempt in the same VM
// Clearing the status file before the start makes a stale marker from an earlier run harmless.
export function acceptanceTaskScript() {
  return [
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\\ls101-lab\\run-acceptance.ps1'`,
    `$principal = New-ScheduledTaskPrincipal -UserId 'vagrant' -LogonType Interactive -RunLevel Highest`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)`,
    `Register-ScheduledTask -TaskName '${ACCEPTANCE_TASK}' -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
    `Remove-Item -LiteralPath '${guestPath(GUEST_STATUS)}' -Force -ErrorAction SilentlyContinue`,
    `Start-ScheduledTask -TaskName '${ACCEPTANCE_TASK}'`
  ].join('\n')
}

function readGuestOutput(run, script, options = {}) {
  return run('vagrant.exe', ['winrm', '--command', guestCommand(script)], {
    capture: true,
    ...options
  }).trim()
}

// One WinRM round trip reports everything the waiting loop needs, so a poll does not print or store
// an encoded command and the user still sees progress. Output is a single marked line:
//   LS101STATE|<status>|<phase>|<state>|<result>|<last run>|<log tail>
//   status    '' while running, then the completion marker written by the guest script
//   phase     newest progress.txt line, e.g. `12:01:02 yarn install`
//   state     scheduled task state, `missing` when registration failed
//   result    task LastTaskResult, interpreted by waitForAcceptanceStatus
//   last run  task LastRunTime, empty when it never started
//   tail      newest acceptance.log line, which shows the real build/test progress
// The guest text is sanitised because `|` is the field separator and WinRM rejects nothing else.
export function guestStateScript() {
  const log = guestPath(GUEST_LOG)
  const progress = guestPath(GUEST_PROGRESS)
  const status = guestPath(GUEST_STATUS)
  return [
    `$statusPath = '${status}'`,
    `$progressPath = '${progress}'`,
    `$logPath = '${log}'`,
    `$status = if (Test-Path -LiteralPath $statusPath) { (Get-Content -LiteralPath $statusPath -Raw).Trim() } else { '' }`,
    `$phase = if (Test-Path -LiteralPath $progressPath) { Get-Content -LiteralPath $progressPath -Tail 1 } else { '' }`,
    `$tail = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Tail 1 } else { '' }`,
    `$task = Get-ScheduledTask -TaskName '${ACCEPTANCE_TASK}' -ErrorAction SilentlyContinue`,
    `if ($task) { $info = $task | Get-ScheduledTaskInfo; $taskText = "$($task.State)|$($info.LastTaskResult)|$($info.LastRunTime)" } else { $taskText = 'missing|0|' }`,
    `$clean = { param($value) ($value -replace '\\|', '/') -replace '\\s+', ' ' }`,
    `Write-Output ('${GUEST_STATE_PREFIX}' + $status + '|' + (& $clean $phase) + '|' + $taskText + '|' + (& $clean $tail))`
  ].join('\n')
}

export function parseGuestState(output) {
  // WinRM can prepend warnings, so the marked line is picked out instead of trusting line one.
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(GUEST_STATE_PREFIX))
  if (!line) return { status: '', phase: '', state: '', result: Number.NaN, lastRun: '', tail: '' }
  const [status = '', phase = '', state = '', result = '', lastRun = '', tail = ''] = line
    .slice(GUEST_STATE_PREFIX.length)
    .split('|')
  return { status, phase, state, result: Number(result), lastRun, tail }
}

export async function waitForInteractiveSession(
  run,
  {
    timeoutMs = SESSION_TIMEOUT_MS,
    intervalMs = SESSION_POLL_MS,
    delay = sleep,
    now = Date.now
  } = {}
) {
  const deadline = now() + timeoutMs
  for (;;) {
    const sessions = readGuestOutput(run, 'qwinsta 2>&1 | Out-String')
    if (hasInteractiveSession(sessions)) return sessions
    if (now() >= deadline) return null
    await delay(intervalMs)
  }
}

export async function waitForAcceptanceStatus(
  run,
  {
    timeoutMs = ACCEPTANCE_TIMEOUT_MS,
    intervalMs = ACCEPTANCE_POLL_MS,
    delay = sleep,
    now = Date.now,
    log = console.log
  } = {}
) {
  const startedAt = now()
  const deadline = startedAt + timeoutMs
  let previous = ''
  for (;;) {
    const state = parseGuestState(readGuestOutput(run, guestStateScript(), { quiet: true }))
    if (state.status === 'passed' || state.status === 'failed') return state.status
    // Only print when the phase or the newest log line changed, so a long build reports progress
    // instead of repeating an identical line (and never an encoded command) every interval.
    const minutes = Math.round((now() - startedAt) / 60000)
    const task = state.state === 'Running' || state.state === 'Queued' ? '' : ` task=${state.state}`
    const summary = `${state.phase || 'waiting for the guest task'}${task}${state.tail ? ` | ${state.tail}` : ''}`
    if (summary !== previous) {
      log(`acceptance (${minutes} min): ${summary}`)
      previous = summary
    }
    if (state.state === 'missing') {
      throw new Error('Acceptance task is missing; it was not registered on the guest')
    }
    // 0x800704DD: an interactive task cannot start without a logged-on user, which is how a failed
    // automatic logon surfaces. It is reported separately because the fix is the VM, not the suite.
    if (state.result === TASK_LOGON_UNAVAILABLE) {
      throw new Error(
        `Acceptance task could not start (result ${state.result}, last run ${state.lastRun || 'never'}); the interactive desktop session is unavailable`
      )
    }
    // 267009 means "still running" and 267011 "has not run yet"; every other non-zero result means
    // the task finished without the guest script publishing a status file, so waiting is pointless.
    if (
      Number.isFinite(state.result) &&
      state.result !== 0 &&
      state.result !== TASK_RUNNING &&
      state.result !== TASK_NOT_RUN
    ) {
      throw new Error(
        `Acceptance task ended without publishing a status (result ${state.result}, last run ${state.lastRun || 'never'}, phase ${state.phase || 'unknown'})`
      )
    }
    if (now() >= deadline) {
      throw new Error(
        `Acceptance did not finish within ${Math.round(timeoutMs / 60000)} minutes (phase ${state.phase || 'unknown'}, task ${state.state || 'unknown'})`
      )
    }
    await delay(intervalMs)
  }
}

// Credential handling: the generated GuestPassword is written to a host temp file outside the
// repository, uploaded once, applied, and then deleted on both sides. It is deliberately never
// passed as a command argument (the runner logs every argument and stores it in the report) and
// never encoded into a `guestCommand` payload, which would decode back to plain text.
async function enableDesktopSession(config, run) {
  const script = path.join(tmpdir(), `ls101-autologon-${randomUUID()}.ps1`)
  await writeFile(script, desktopSessionScript(config.GuestPassword), { mode: 0o600 })
  try {
    run('vagrant.exe', ['upload', script, GUEST_DESKTOP_SCRIPT])
    run('vagrant.exe', [
      'winrm',
      '--command',
      `powershell -NoProfile -ExecutionPolicy Bypass -File ${GUEST_DESKTOP_SCRIPT}`
    ])
    run('vagrant.exe', [
      'winrm',
      '--command',
      `powershell -NoProfile -Command "Remove-Item -LiteralPath '${GUEST_DESKTOP_SCRIPT}' -Force"`
    ])
  } finally {
    await unlink(script).catch(() => undefined)
  }
  // Logon settings only apply at boot, so the VM restarts once before the suite runs. The uploaded
  // source archive and guest script live on disk and survive the reboot.
  run('vagrant.exe', ['reload'])
}

// A missing artifact is normal (a run can fail before producing one), so the probe is guarded with
// Test-Path and never writes a PowerShell error to stderr for the host to print.
function guestFileSize(run, guestPathValue) {
  try {
    const size = readGuestOutput(
      run,
      `$path = '${guestPath(guestPathValue)}'\nif (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).Length }`
    )
    const value = Number.parseInt(size, 10)
    return Number.isInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

// Downloads a guest file over WinRM as base64 chunks. `vagrant upload` is one-way, so the
// acceptance artifacts travel back through the WinRM channel in bounded commands. Bytes are kept
// as bytes: `Get-Content` would guess an encoding, and PowerShell 5.1 used to write UTF-16LE.
export async function collectGuestArtifact(run, guestPath, localPath, { zip = true } = {}) {
  const size = guestFileSize(run, guestPath)
  if (size === 0) return null
  if (size > GUEST_ARTIFACT_LIMIT)
    throw new Error(`Guest artifact is unexpectedly large (${size} bytes)`)
  // Each chunk is read at an explicit offset and returned as base64, keeping every WinRM response
  // small; the guest never sends the whole file in one message.
  const chunks = []
  for (let offset = 0; offset < size; offset += GUEST_ARTIFACT_CHUNK) {
    const length = Math.min(GUEST_ARTIFACT_CHUNK, size - offset)
    const script = [
      `$stream = [IO.File]::OpenRead('${guestPath}')`,
      'try {',
      `  $stream.Position = ${offset}`,
      `  $buffer = New-Object byte[] ${length}`,
      `  $read = $stream.Read($buffer, 0, ${length})`,
      '} finally {',
      '  $stream.Dispose()',
      '}',
      '[Convert]::ToBase64String($buffer, 0, $read)'
    ].join('\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const output = run(
      'vagrant.exe',
      ['winrm', '--command', `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`],
      { capture: true }
    )
    // WinRM may wrap or decorate the output, so anything outside the base64 alphabet is dropped.
    const base64 = output.replace(/[^A-Za-z0-9+/=]/g, '')
    chunks.push(Buffer.from(base64, 'base64'))
  }
  const data = Buffer.concat(chunks)
  if (data.length !== size)
    throw new Error(`Guest artifact is truncated (${data.length} of ${size} bytes)`)
  // `PK` is the ZIP signature: it proves the guest compressed a real archive and that the chunked
  // transfer did not silently corrupt or truncate it. Plain text files skip this check.
  if (zip && (data[0] !== 0x50 || data[1] !== 0x4b))
    throw new Error('Guest artifact is not a ZIP archive')
  await writeFile(localPath, data)
  return localPath
}

// Decodes guest text that may have been written by different PowerShell versions: UTF-8 with BOM,
// UTF-16LE with BOM, UTF-16LE without BOM (Windows PowerShell's old Tee-Object default) or plain
// UTF-8. Without this the log showed up as NUL-separated letters.
export function decodeGuestText(data) {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe)
    return data.subarray(2).toString('utf16le')
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf)
    return data.subarray(3).toString('utf8')
  if (data.length >= 2 && data[1] === 0x00) return data.toString('utf16le')
  return data.toString('utf8')
}

async function acceptance(root, config, run, report) {
  await verifyBox(root)
  ensureProvider(run)
  ensureVmwareUtility(run)
  const status = run('vagrant.exe', ['status', '--machine-readable'], { capture: true })
  const states = status.split(/\r?\n/).filter((line) => line.split(',')[2] === 'state').map((line) => line.split(',')[3])
  if (states.length !== 1 || states[0] !== 'not_created') throw new Error('vm:acceptance requires no existing VM; use vm:destroy first.')
  const runId = `${Date.now()}-${randomUUID()}`
  const localRun = path.join(root, '.local', 'results', runId)
  const projectRoot = path.resolve(root, '..', '..')
  await mkdir(localRun, { recursive: true })
  const archive = path.join(localRun, 'source.zip')
  const guestScript = path.join(root, 'guest', 'run-acceptance.ps1')
  report.runId = runId
  report.state = 'running'
  let started = false
  try {
    run('vagrant.exe', ['up', '--provider', 'vmware_desktop'])
    started = true
    // Get all files to archive: tracked + unignored untracked
    const filesToArchive = run('git.exe', ['-c', 'core.quotePath=off', 'ls-files', '-co', '--exclude-standard'], {
      capture: true,
      cwd: projectRoot
    }).split(/\r?\n/).filter(Boolean)

    if (filesToArchive.length === 0) {
      throw new Error('No files to archive')
    }

    // Create a file list for PowerShell
    const fileListPath = path.join(localRun, 'files.txt')
    await writeFile(fileListPath, filesToArchive.join('\n'), 'utf8')

    // This step runs PowerShell on the host instead of the guest, so it has no runner log line and
    // reports its own summary: the encoded payload below would be unreadable in the console.
    console.log(
      `Compressing ${filesToArchive.length} tracked and untracked file(s) into ${path.basename(archive)} with Compress-Archive`
    )

    // Create archive using PowerShell's Compress-Archive
    const compressScript = `
$ErrorActionPreference = 'Stop'
$projectRoot = $env:LS101_PROJECT_ROOT
$archive = $env:LS101_ARCHIVE
$fileList = $env:LS101_FILE_LIST
$files = Get-Content $fileList -Encoding UTF8
$tempDir = Join-Path $env:TEMP ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
  foreach ($file in $files) {
    $source = Join-Path $projectRoot $file
    $dest = Join-Path $tempDir $file
    $destDir = Split-Path $dest -Parent
    if (-not (Test-Path $destDir)) {
      New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $dest -Force
  }
  Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $archive -Force
} finally {
  Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
`.trim()

    const compressResult = spawnSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(compressScript, 'utf16le').toString('base64')
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LS101_PROJECT_ROOT: projectRoot,
          LS101_ARCHIVE: archive,
          LS101_FILE_LIST: fileListPath
        },
        shell: false,
        stdio: ['ignore', 'inherit', 'inherit']
      }
    )

    if (compressResult.error || compressResult.status !== 0) {
      throw new Error(`PowerShell compression failed (${compressResult.error?.code ?? compressResult.signal ?? compressResult.status})`)
    }

    // Verify the archive was created
    if (!(await exists(archive))) {
      throw new Error('Archive was not created')
    }

    run('vagrant.exe', ['upload', archive, 'C:/ls101-lab/source.zip'])
    run('vagrant.exe', ['upload', guestScript, 'C:/ls101-lab/run-acceptance.ps1'])
    let guestError = null
    try {
      await enableDesktopSession(config, run)
      const sessions = await waitForInteractiveSession(run)
      if (!sessions) {
        throw new Error(
          'The disposable VM did not reach an interactive desktop session; automatic console logon is not working'
        )
      }
      report.guestSessions = sessions.split(/\r?\n/).filter(Boolean)
      // The desktop session decides whether Electron can show its window, so record what the guest
      // reported instead of only storing it in the report.
      console.log(
        `Guest desktop sessions:\n${report.guestSessions.map((line) => `  ${line}`).join('\n')}`
      )
      run('vagrant.exe', ['winrm', '--command', guestCommand(acceptanceTaskScript())])
      const result = await waitForAcceptanceStatus(run)
      if (result !== 'passed') throw new Error('Guest acceptance run failed; see acceptance.log')
    } catch (error) {
      guestError = error
    }
    // The log and the phase file are pulled as bytes and decoded here, so a run always leaves a
    // readable log next to the report even when the guest wrote it with a different encoding.
    for (const [guestFile, name, zip] of [
      [GUEST_LOG, 'acceptance.log', false],
      [GUEST_PROGRESS, 'progress.txt', false]
    ]) {
      try {
        const target = await collectGuestArtifact(run, guestFile, path.join(localRun, name), {
          zip
        })
        if (target) await writeFile(target, decodeGuestText(await readFile(target)), 'utf8')
      } catch (error) {
        console.warn(`Guest ${name} is unavailable: ${error.message}`)
      }
    }
    try {
      const artifact = await collectGuestArtifact(
        run,
        GUEST_ARTIFACT,
        path.join(localRun, 'acceptance-artifacts.zip')
      )
      if (artifact) {
        report.artifact = artifact
        console.log(`Saved guest acceptance artifacts to ${artifact}`)
      }
    } catch (error) {
      report.artifactError = error.message
      console.warn(`Guest acceptance artifacts could not be exported: ${error.message}`)
    }
    if (guestError) throw guestError
    report.state = 'passed'
    run('vagrant.exe', ['halt'])
    run('vagrant.exe', ['destroy', '--force'])
    report.destroyed = true
  } catch (error) {
    report.state = /interactive|prompt|parameter|input/i.test(error.message) ? 'manual-required' : 'failed'
    report.preserved = started
    throw error
  }
}

async function initializeConfig(root) {
  const config = JSON.parse(await readFile(path.join(root, 'config.example.json'), 'utf8'))
  config.GuestPassword = `Aa1!${randomBytes(18).toString('hex')}`
  await writeFile(path.join(root, 'config.local.json'), JSON.stringify(config, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600
  })
  console.log('Created config.local.json with official ISO sources and a random test password.')
}

export async function setup(root, run, operations = {}) {
  const local = path.join(root, '.local')
  const box = path.join(local, 'boxes', boxFile)
  const guest = path.join(local, 'generated', 'guest.json')
  const checksum = `${box}.sha256`
  if ((await exists(box)) && (await exists(guest)) && (await exists(checksum))) {
    await verifyBox(root)
    console.log(
      'Existing base box verified and reused. Run yarn vm:up or yarn vm:cycle next. Configuration changes require an explicit rebuild.'
    )
    return
  }
  for (const file of [box, guest, checksum, path.join(local, 'build', 'windows-server-2022')]) {
    if (await exists(file))
      throw new Error(
        'Incomplete base-box build exists. Inspect and archive its output before retrying vm:setup; nothing was overwritten.'
      )
  }
  const configFile = path.join(root, 'config.local.json')
  if (!(await exists(configFile))) await initializeConfig(root)
  const config = validateConfig(JSON.parse(await readFile(configFile, 'utf8')))
  await (operations.prepare ?? prepare)(root, config, run)
  await (operations.buildBox ?? buildBox)(root, config, run, false)
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const action = parseAction(args)
  if (action === 'help') {
    console.log(help)
    return
  }
  const root = dependencies.root ?? labRoot
  if (action === 'init') {
    await initializeConfig(root)
    return
  }
  if (
    (dependencies.platform ?? process.platform) !== 'win32' ||
    (dependencies.arch ?? process.arch) !== 'x64'
  ) {
    throw new Error(
      'VM operations require a Windows x64 host (not WSL). No tools were downloaded or started. init/help and JS unit tests are portable.'
    )
  }
  const env = await initializeEnvironment(root)
  const local = path.join(root, '.local')
  return withLock(local, async () => {
    const report = { action, startedAt: new Date().toISOString(), steps: [], success: false }
    const reportPath = path.join(
      local,
      'results',
      `${Date.now()}-${action.replaceAll(':', '-')}-${randomUUID()}.json`
    )
    const run = createRunner(root, env, report, dependencies.spawn)
    try {
      if (action === 'setup') {
        await setup(root, run)
      } else if (['prepare', 'box:validate', 'box:build'].includes(action)) {
        const config = validateConfig(
          JSON.parse(await readFile(path.join(root, 'config.local.json'), 'utf8'))
        )
        if (action === 'prepare') await prepare(root, config, run)
        else await buildBox(root, config, run, action === 'box:validate')
      } else if (action === 'acceptance') {
        const config = validateConfig(
          JSON.parse(await readFile(path.join(root, 'config.local.json'), 'utf8'))
        )
        await acceptance(root, config, run, report)
      } else {
        await lifecycle(action, run, async () => {
          await verifyBox(root)
          ensureProvider(run)
        }, ensureVmwareUtility)
      }
      report.success = true
    } catch (error) {
      report.error = error.message
      throw error
    } finally {
      report.finishedAt = new Date().toISOString()
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
      console.log(`Host result: ${reportPath}`)
      if (report.success) {
        console.log(`SUCCESS: ${action} completed successfully.`)
        if (action === 'up') console.log('The VM is running. Use yarn vm:status to inspect it.')
        if (action === 'box:build' || action === 'setup')
          console.log('The Windows base box is ready. Use yarn vm:up to start it.')
      }
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
