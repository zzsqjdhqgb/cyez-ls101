/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
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
  'cycle',
  'acceptance',
  'lab-acceptance',
  'lab-diagnose',
  'lab-execute',
  'lab-probe'
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
  yarn vm:acceptance    Run Windows smoke and product documentation tests in a fresh disposable VM
  yarn vm:lab           Install the packaged lab products in a fresh disposable VM and test them
  yarn vm:diag          Inspect a preserved lab VM without touching it (files, parse errors, task)
  yarn vm:execute       Run the phase script once in a preserved lab VM and capture its output
  yarn vm:probe         Run one named diagnostic script in a preserved lab VM (service-install,
                        service-verify, installer-uninstall) and print its output
  yarn vm --help        Show this help

Default ISO URLs download automatically and record first-download SHA-256 values.
For custom/local ISOs, set the URL/path and a reviewed SHA-256 in config.local.json.
Host requirements: VMware Workstation, Vagrant, Vagrant VMware Utility.
Only the disposable Vagrant VM is destroyed. The base box and build output are retained.
cycle verifies VM lifecycle/WinRM readiness, not application or desktop tests.
acceptance uploads the current source tree, enables automatic console logon, installs
dependencies in the lightweight product-docs setup mode, packages the application once, runs
the smoke suite and then yarn test:product-docs through an interactive scheduled task,
exports the guest log, the phase timeline and the preview artifacts, and destroys the VM only
after a successful run. Bulk files travel over HTTP to the guest file server on the guest's own
NAT address; WinRM only carries control commands and the two small bootstrap files.
lab-acceptance builds the teacher and student installers on this host (it refuses to run unless the
host Node version is exactly 24.20.0, which scripts/lab/build-server.mjs requires), installs the
teacher package in the guest, and asserts what only a real machine can show: SCM registration and the
virtual service account, ProgramData ACLs enforced against a real standard user, session-0 hosting, the
named-pipe control channel, real activation and initialization, the 0.0.0.0 listener, and the firewall
gate measured from this host. The guest installs packaged artifacts instead of building the source tree,
so it needs neither Yarn nor node_modules.`

export function parseAction(args) {
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) return 'help'
  // `lab-probe` takes one more argument, the name of the diagnostic to run; every other action stays a
  // single word so an accidental extra argument is still an error rather than being ignored.
  if (args[0] === 'lab-probe' && args.length === 2) return 'lab-probe'
  if (args.length !== 1 || !actions.includes(args[0])) throw new Error(help)
  return args[0]
}

// The probe name for `lab-probe`, validated against the fixed list so an unknown one fails before any
// VM work happens.
export function parseProbe(args) {
  if (args[0] !== 'lab-probe') return null
  if (args.length !== 2 || !labProbeNames().includes(args[1]))
    throw new Error(
      `yarn vm:probe needs exactly one probe name (${labProbeNames().join(', ')}); got ${JSON.stringify(args.slice(1))}`
    )
  return args[1]
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
  // The lock creates its own directory. `open(file, 'wx')` fails with ENOENT when the parent is missing,
  // which is not the EEXIST this helper is about, so every caller used to have to remember to create
  // `.local` first — and one call site stopped doing it after a reordering, which broke a fresh checkout
  // (a GitHub runner, or a clone that has only run `yarn vm:init`) before any work had begun.
  await mkdir(local, { recursive: true })
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
    const output = run(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script
      ],
      { capture: true }
    )
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
const GUEST_FILESERVER_SCRIPT = 'C:/ls101-lab/fileserver.mjs'
const GUEST_FILESERVER_LOG = 'C:/ls101-lab/results/fileserver.log'
const GUEST_UPLOAD_DIR = 'C:/ls101-lab/transfers'
const GUEST_RESULTS_DIR = 'C:/ls101-lab/results'
// The acceptance script arrives over HTTP like every other bulk input, so the scheduled task reads
// it from the upload directory instead of the lab root it used to be uploaded to.
const ACCEPTANCE_SCRIPT_NAME = 'run-acceptance.ps1'
const GUEST_ACCEPTANCE_SCRIPT = `${GUEST_UPLOAD_DIR}/${ACCEPTANCE_SCRIPT_NAME}`
const GUEST_FILESERVER_PORT = 8765
// The file server is reached on the guest's own NAT address instead of a forwarded host port:
// a forwarded port collided with unrelated host software, and the direct path also skips the NAT
// user-mode hop. The host may connect outbound to the vmnet subnet without any host firewall rule.
const FILESERVER_TASK = 'ls101-files'
const FILESERVER_RULE = 'LS101-Lab-FileServer'
const ACCEPTANCE_TASK = 'ls101-acceptance'
// A stalled transfer aborts the run instead of hanging until the acceptance timeout.
const FILE_SERVER_TIMEOUT_MS = 10 * 60 * 1000
const FILE_SERVER_READY_TIMEOUT_MS = 60 * 1000
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

// --- Lab acceptance (docs/lab-vm-acceptance-design.md, milestone M1) -------------------------
// The guest installs packaged artifacts instead of building the source tree, so the lab run needs
// neither Yarn nor node_modules in the VM: the host compiles, the guest only installs and asserts.
const LAB_NODE_VERSION = '24.20.0'
const LAB_WINSW_FILE = 'externals/lab/windows/WinSW.NET461.exe'
// Pinned by scripts/lab/download-service-assets.mjs and copied into the service runtime manifest.
const LAB_WINSW_SHA256 = 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f'
const LAB_TASK = 'ls101-lab-acceptance'
// A separate task name so the one-shot diagnostic never clobbers the real run's registration.
const LAB_EXECUTE_TASK = 'ls101-lab-execute'
// Milestone M4's diagnostics: a named script the operator can re-run in a preserved VM. The service
// installer is the first entry because its failure output lives *inside the installer* — the NSIS hook
// discards both streams and only raises a dialog — so the only way to read the stage and message is to
// run the same script from the package's own resources.
const LAB_PROBE_TASK = 'ls101-lab-probe'
// Uploads land in the guest file server's own upload directory, so the lab files use it too and no
// extra move command is needed inside the VM.
const LAB_GUEST_DIR = 'C:/ls101-lab/transfers'
// The phase run is Node, so its orchestration and comparisons are covered by `yarn vm:test` in the
// container. PowerShell is uploaded only as lab-probes.ps1, which collects structured data and decides
// nothing.
const LAB_GUEST_SCRIPT = `${LAB_GUEST_DIR}/lab-acceptance.mjs`
const LAB_GUEST_HARNESS = `${LAB_GUEST_DIR}/lab-harness.mjs`
const LAB_GUEST_PROBES = `${LAB_GUEST_DIR}/lab-probes.ps1`
const LAB_GUEST_LAUNCHER = `${LAB_GUEST_DIR}/start-lab-acceptance.ps1`
const LAB_GUEST_CONFIG = `${LAB_GUEST_DIR}/lab-config.json`
// The invitation code is a credential, so it is NOT uploaded to the plain-HTTP file server that
// carries bulk files: it travels through the encrypted WinRM channel, outside the lab directory that
// the guest script deletes, and is removed as soon as the service has consumed it.
const LAB_GUEST_INVITATION = 'C:/ls101-lab/invitation.txt'
const LAB_GUEST_RESULTS_DIR = 'C:/ls101-lab/results'
const LAB_GUEST_LOG = `${LAB_GUEST_RESULTS_DIR}/lab-acceptance.log`
const LAB_GUEST_STATUS = `${LAB_GUEST_RESULTS_DIR}/lab-status.txt`
const LAB_GUEST_PROGRESS = `${LAB_GUEST_RESULTS_DIR}/lab-progress.txt`
const LAB_GUEST_RESULTS = `${LAB_GUEST_RESULTS_DIR}/lab-results.json`
// The probe reaches the guest as these three files rather than as a command line, for the reason
// `labProbeTaskScript` documents: a base64 UTF-16 payload does not fit in the 8191 characters Windows
// allows, and the failure mode is an unexplained ENAMETOOLONG.
const LAB_PROBE_BASE64 = `${LAB_GUEST_DIR}/lab-probe.b64`
const LAB_PROBE_FILE = `${LAB_GUEST_DIR}/lab-probe.ps1`
const LAB_PROBE_LAUNCHER = `${LAB_GUEST_DIR}/run-lab-probe.ps1`
// The launcher keeps its own copy of everything it did and everything the probe said. The task's redirected
// stream has come back empty for two probes while the same mechanism works elsewhere, so the next failure
// has to explain itself from a file rather than from the absence of output.
const LAB_PROBE_CAPTURE = `${LAB_GUEST_DIR}/lab-probe-capture.txt`
// Where a `yarn vm:probe` run keeps its captured output. Declared here rather than beside the other
// probe constants because it is built from the results directory.
const LAB_PROBE_OUTPUT = `${LAB_GUEST_RESULTS_DIR}/lab-probe-output.txt`
// Written before the phase script reads anything else, so a start-up failure always explains itself.
const LAB_GUEST_STARTUP = `${LAB_GUEST_RESULTS_DIR}/lab-startup.txt`
// Captured output of the phase script. A scheduled task discards the output of the process it starts,
// so without this the reason a run died before its first statement never reaches the host.
const LAB_GUEST_TASK_OUTPUT = `${LAB_GUEST_RESULTS_DIR}/lab-task-output.txt`
const LAB_GUEST_ARTIFACT = `${LAB_GUEST_RESULTS_DIR}/lab-artifacts.zip`
const LAB_ACCEPTANCE_TIMEOUT_MS = 60 * 60 * 1000
const LAB_ACCEPTANCE_POLL_MS = 15 * 1000
// The default HTTPS port from docs/lab-service-runtime.md. Using a non-default port here would test
// the same code path while proving less about the documented deployment, so the documented value wins.
const LAB_HTTPS_PORT = 8443

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
// only an interactive logon session has a desktop that Electron can show a window on://   -LogonType Interactive  runs in the console session of the logged-on user; it needs no stored
//                           password, which is why no credential is sent to the guest here
//   -RunLevel Highest       the guest script installs dependencies and starts Electron
//   ExecutionTimeLimit      bounds a hung suite; the host has its own timeout as well
//   -Force                  re-registers a leftover task from an earlier attempt in the same VM
// Clearing the status file before the start makes a stale marker from an earlier run harmless.
export function acceptanceTaskScript() {
  return [
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoLogo -NoProfile -ExecutionPolicy Bypass -File ${guestPath(GUEST_ACCEPTANCE_SCRIPT)}'`,
    `$principal = New-ScheduledTaskPrincipal -UserId 'vagrant' -LogonType Interactive -RunLevel Highest`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)`,
    `Register-ScheduledTask -TaskName '${ACCEPTANCE_TASK}' -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
    `Remove-Item -LiteralPath '${guestPath(GUEST_STATUS)}' -Force -ErrorAction SilentlyContinue`,
    `Start-ScheduledTask -TaskName '${ACCEPTANCE_TASK}'`
  ].join('\n')
}

// Starts the guest file server: one firewall rule, then a scheduled task that keeps the server
// alive outside the WinRM shell. The rule is needed because the host connects in as an ordinary
// inbound client on the virtual subnet; `bootstrap.ps1` already marks this network as private.
// Nothing is added on the host, which is the point of serving from the guest instead.
export function filesServerTaskScript(config) {
  const node = `${guestPath('C:/ls101-lab/tools')}\\node-v${config.NodeVersion}-win-x64\\node.exe`
  const argument = [
    guestPath(GUEST_FILESERVER_SCRIPT),
    '--port',
    GUEST_FILESERVER_PORT,
    '--uploads',
    guestPath(GUEST_UPLOAD_DIR),
    '--results',
    guestPath(GUEST_RESULTS_DIR),
    '--log',
    guestPath(GUEST_FILESERVER_LOG)
  ].join(' ')
  return [
    `$rule = Get-NetFirewallRule -Name '${FILESERVER_RULE}' -ErrorAction SilentlyContinue`,
    `if (-not $rule) { New-NetFirewallRule -Name '${FILESERVER_RULE}' -DisplayName 'LS101 Lab file server' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${GUEST_FILESERVER_PORT} -RemoteAddress LocalSubnet | Out-Null }`,
    `$action = New-ScheduledTaskAction -Execute '${node}' -Argument '${argument}' -WorkingDirectory '${guestPath('C:/ls101-lab')}'`,
    `$principal = New-ScheduledTaskPrincipal -UserId 'vagrant' -LogonType Interactive -RunLevel Highest`,
    `Register-ScheduledTask -TaskName '${FILESERVER_TASK}' -Action $action -Principal $principal -Force | Out-Null`,
    `Start-ScheduledTask -TaskName '${FILESERVER_TASK}'`
  ].join('\n')
}

// HTTP client for the guest file server. `node:http` is used instead of `fetch` on purpose: it
// streams file bodies natively and ignores HTTP_PROXY-style environment variables, which matters
// because this repository configures proxies for other tooling.
async function fileServerRequest(method, url, { body, timeoutMs = FILE_SERVER_TIMEOUT_MS } = {}) {
  const target = new URL(url)
  const request = http.request({
    hostname: target.hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method
  })
  const responsePromise = new Promise((resolve, reject) => {
    request.on('response', resolve)
    request.on('error', reject)
  })
  // When the upload fails first, nobody awaits the response promise; keep it from surfacing as an
  // unhandled rejection on top of the real error.
  responsePromise.catch(() => undefined)
  // Socket inactivity timeout: it only fires when no bytes move, so slow but live transfers run on.
  request.setTimeout(timeoutMs, () =>
    request.destroy(new Error(`file server request timed out after ${timeoutMs} ms`))
  )
  let bodyError = null
  if (body) {
    try {
      await pipeline(body, request)
    } catch (error) {
      // A server that rejects the request (bad name, too large) answers and closes the socket
      // while the body is still streaming. The status code is the useful error, so the body
      // failure is kept only as a fallback for when no response arrives at all.
      bodyError = error
    }
  } else {
    request.end()
  }
  const response = await responsePromise.catch((error) => {
    throw bodyError ?? error
  })
  if (bodyError && response.statusCode >= 200 && response.statusCode < 300) throw bodyError
  return response
}

async function readResponseText(response) {
  const chunks = []
  for await (const chunk of response) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// The guest address on the VMware NAT subnet: the adapter that owns the default gateway. The IP
// is read after the automatic-logon reload, because the address can change across a reboot.
export function guestAddressScript() {
  return [
    `$configuration = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } | Select-Object -First 1`,
    `if ($configuration) { $configuration.IPv4Address.IPAddress }`
  ].join('\n')
}

export function parseGuestAddress(output) {
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(entry))
  return line ?? null
}

export async function guestFileServerUrl(run) {
  const address = parseGuestAddress(readGuestOutput(run, guestAddressScript(), { quiet: true }))
  if (!address) throw new Error('The guest did not report an IPv4 address for the file server')
  return `http://${address}:${GUEST_FILESERVER_PORT}`
}

export async function waitForGuestFileServer({
  baseUrl,
  timeoutMs = FILE_SERVER_READY_TIMEOUT_MS,
  intervalMs = 2000,
  delay = sleep,
  now = Date.now
} = {}) {
  if (!baseUrl) throw new Error('waitForGuestFileServer requires the guest file server URL')
  const deadline = now() + timeoutMs
  let lastError = 'no response'
  for (;;) {
    try {
      const response = await fileServerRequest('GET', `${baseUrl}/health`, { timeoutMs: 5000 })
      await readResponseText(response)
      if (response.statusCode === 200) return true
      lastError = `HTTP ${response.statusCode}`
    } catch (error) {
      lastError = error.message
    }
    if (now() >= deadline) throw new Error(`Guest file server is not reachable: ${lastError}`)
    await delay(intervalMs)
  }
}

// Uploads a local file. The server answers with the number of bytes it stored, which is compared
// with the local size: that is the integrity check the chunked WinRM path had to do itself.
export async function putGuestFile(localPath, name, { baseUrl } = {}) {
  if (!baseUrl) throw new Error('putGuestFile requires the guest file server URL')
  const response = await fileServerRequest('PUT', `${baseUrl}/files/${encodeURIComponent(name)}`, {
    body: createReadStream(localPath)
  })
  const body = await readResponseText(response)
  if (response.statusCode !== 201) {
    throw new Error(`Guest file server rejected ${name}: HTTP ${response.statusCode} ${body}`)
  }
  const stored = Number.parseInt(body, 10)
  const localSize = (await stat(localPath)).size
  if (Number.isFinite(stored) && stored !== localSize) {
    throw new Error(`Guest file server stored ${stored} of ${localSize} bytes for ${name}`)
  }
  return localSize
}

// Downloads a file, returning null when the guest does not have it. Content-length is verified and
// the ZIP signature is checked for archives, so a truncated or corrupted transfer never lands.
export async function getGuestFile(
  name,
  localPath,
  { baseUrl, kind = 'results', zip = false } = {}
) {
  if (!baseUrl) throw new Error('getGuestFile requires the guest file server URL')
  const response = await fileServerRequest('GET', `${baseUrl}/${kind}/${encodeURIComponent(name)}`)
  if (response.statusCode !== 200) {
    response.resume()
    return null
  }
  const expected = Number.parseInt(response.headers['content-length'] ?? '', 10)
  const temporary = `${localPath}.part-${randomUUID()}`
  try {
    await pipeline(response, createWriteStream(temporary))
    const actual = (await stat(temporary)).size
    if (Number.isFinite(expected) && expected !== actual) {
      throw new Error(`${name} arrived truncated (${actual} of ${expected} bytes)`)
    }
    if (zip) {
      const handle = await open(temporary, 'r')
      const signature = Buffer.alloc(2)
      try {
        await handle.read(signature, 0, 2, 0)
      } finally {
        await handle.close()
      }
      if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
        throw new Error(`${name} is not a ZIP archive`)
      }
    }
    await rename(temporary, localPath)
    return localPath
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

// Collects one guest file for the run directory: HTTP first, and the chunked WinRM reader as a
// fallback so a guest file server that died mid-run still leaves the evidence on the host.
async function collectGuestEvidence(run, { baseUrl, name, guestFile, localPath, zip = false }) {
  if (baseUrl) {
    try {
      const viaHttp = await getGuestFile(name, localPath, { baseUrl, zip })
      if (viaHttp) return { path: viaHttp, transport: 'http' }
    } catch (error) {
      console.warn(`Guest file server transfer for ${name} failed (${error.message}); using WinRM`)
    }
  }
  const viaWinrm = await collectGuestArtifact(run, guestFile, localPath, { zip })
  return viaWinrm ? { path: viaWinrm, transport: 'winrm' } : null
}

export function readGuestOutput(run, script, options = {}) {
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
export function guestStateScript({
  log = GUEST_LOG,
  progress = GUEST_PROGRESS,
  status = GUEST_STATUS,
  task = ACCEPTANCE_TASK
} = {}) {
  const logPath = guestPath(log)
  const progressPath = guestPath(progress)
  const statusPath = guestPath(status)
  return [
    `$statusPath = '${statusPath}'`,
    `$progressPath = '${progressPath}'`,
    `$logPath = '${logPath}'`,
    `$status = if (Test-Path -LiteralPath $statusPath) { (Get-Content -LiteralPath $statusPath -Raw).Trim() } else { '' }`,
    `$phase = if (Test-Path -LiteralPath $progressPath) { Get-Content -LiteralPath $progressPath -Tail 1 } else { '' }`,
    `$tail = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Tail 1 } else { '' }`,
    `$task = Get-ScheduledTask -TaskName '${task}' -ErrorAction SilentlyContinue`,
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
    log = console.log,
    label = 'acceptance',
    stateScript = guestStateScript
  } = {}
) {
  const startedAt = now()
  const deadline = startedAt + timeoutMs
  const title = label.charAt(0).toUpperCase() + label.slice(1)
  let previous = ''
  for (;;) {
    const state = parseGuestState(readGuestOutput(run, stateScript(), { quiet: true }))
    if (state.status === 'passed' || state.status === 'failed') return state.status
    // Only print when the phase or the newest log line changed, so a long build reports progress
    // instead of repeating an identical line (and never an encoded command) every interval.
    const minutes = Math.round((now() - startedAt) / 60000)
    const task = state.state === 'Running' || state.state === 'Queued' ? '' : ` task=${state.state}`
    const summary = `${state.phase || 'waiting for the guest task'}${task}${state.tail ? ` | ${state.tail}` : ''}`
    if (summary !== previous) {
      log(`${label} (${minutes} min): ${summary}`)
      previous = summary
    }
    if (state.state === 'missing') {
      throw new Error(`${title} task is missing; it was not registered on the guest`)
    }
    // 0x800704DD: an interactive task cannot start without a logged-on user, which is how a failed
    // automatic logon surfaces. It is reported separately because the fix is the VM, not the suite.
    if (state.result === TASK_LOGON_UNAVAILABLE) {
      throw new Error(
        `${title} task could not start (result ${state.result}, last run ${state.lastRun || 'never'}); the interactive desktop session is unavailable`
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
        `${title} task ended without publishing a status (result ${state.result}, last run ${state.lastRun || 'never'}, phase ${state.phase || 'unknown'})`
      )
    }
    if (now() >= deadline) {
      throw new Error(
        `${title} did not finish within ${Math.round(timeoutMs / 60000)} minutes (phase ${state.phase || 'unknown'}, task ${state.state || 'unknown'})`
      )
    }
    await delay(intervalMs)
  }
}

// Credential handling: the generated GuestPassword is written to a host temp file outside the
// repository, uploaded once, applied, and then deleted on both sides. It is deliberately never
// passed as a command argument (the runner logs every argument and stores it in the report) and
// never encoded into a `guestCommand` payload, which would decode back to plain text.
export async function enableDesktopSession(config, run) {
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
  const states = status
    .split(/\r?\n/)
    .filter((line) => line.split(',')[2] === 'state')
    .map((line) => line.split(',')[3])
  if (states.length !== 1 || states[0] !== 'not_created')
    throw new Error('vm:acceptance requires no existing VM; use vm:destroy first.')
  const runId = `${Date.now()}-${randomUUID()}`
  const localRun = path.join(root, '.local', 'results', runId)
  const projectRoot = path.resolve(root, '..', '..')
  await mkdir(localRun, { recursive: true })
  const archive = path.join(localRun, 'source.zip')
  const guestScript = path.join(root, 'guest', 'run-acceptance.ps1')
  const fileserverScript = path.join(root, 'guest', 'fileserver.mjs')
  report.runId = runId
  report.state = 'running'
  let started = false
  try {
    run('vagrant.exe', ['up', '--provider', 'vmware_desktop'])
    started = true
    // Get all files to archive: tracked + unignored untracked
    const filesToArchive = run(
      'git.exe',
      ['-c', 'core.quotePath=off', 'ls-files', '-co', '--exclude-standard'],
      {
        capture: true,
        cwd: projectRoot
      }
    )
      .split(/\r?\n/)
      .filter(Boolean)

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
      throw new Error(
        `PowerShell compression failed (${compressResult.error?.code ?? compressResult.signal ?? compressResult.status})`
      )
    }

    // Verify the archive was created
    if (!(await exists(archive))) {
      throw new Error('Archive was not created')
    }

    // Only two small files still travel through WinRM: the file server itself (it cannot arrive
    // over a server that is not running yet) and the automatic logon script. Its credential stays
    // on the encrypted WinRM channel instead of the plain HTTP one.
    run('vagrant.exe', ['upload', fileserverScript, GUEST_FILESERVER_SCRIPT])
    let guestError = null
    // Filled in once the guest reports its address; the evidence collection below needs it to know
    // whether the HTTP path is even available.
    let baseUrl = null
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
      run('vagrant.exe', ['winrm', '--command', guestCommand(filesServerTaskScript(config))])
      baseUrl = await guestFileServerUrl(run)
      // A host HTTP proxy would swallow a manual probe: `curl.exe` and `Invoke-WebRequest` honour
      // http_proxy and answer 502 for this private address, so the hint prints the bypass. The
      // transfer itself uses node:http, which ignores proxy variables and therefore never hits it.
      console.log(`Guest file server: ${baseUrl}`)
      console.log(`  live log: curl.exe --noproxy "*" ${baseUrl}/results/acceptance.log`)
      await waitForGuestFileServer({ baseUrl })
      // The snapshot and the guest script go over HTTP: 58 MB used to cost about a minute through
      // `vagrant upload`, while the virtual link itself is far faster than the WinRM chunking.
      const uploaded = await putGuestFile(archive, 'source.zip', { baseUrl })
      await putGuestFile(guestScript, ACCEPTANCE_SCRIPT_NAME, { baseUrl })
      // Recorded because these transfers do not appear as runner steps: they are plain HTTP.
      report.transfers = {
        transport: 'guest-http',
        baseUrl,
        snapshotBytes: uploaded
      }
      console.log(
        `Uploaded ${Math.round(uploaded / (1024 * 1024))} MiB snapshot through the guest file server`
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
      [GUEST_PROGRESS, 'progress.txt', false],
      // The file server's own log explains a transfer failure, and the WinRM fallback still
      // reaches it when the server is what broke.
      [GUEST_FILESERVER_LOG, 'fileserver.log', false]
    ]) {
      try {
        const evidence = await collectGuestEvidence(run, {
          baseUrl,
          name,
          guestFile,
          localPath: path.join(localRun, name),
          zip
        })
        if (evidence) {
          await writeFile(evidence.path, decodeGuestText(await readFile(evidence.path)), 'utf8')
        }
      } catch (error) {
        console.warn(`Guest ${name} is unavailable: ${error.message}`)
      }
    }
    try {
      const evidence = await collectGuestEvidence(run, {
        baseUrl,
        name: 'acceptance-artifacts.zip',
        guestFile: GUEST_ARTIFACT,
        localPath: path.join(localRun, 'acceptance-artifacts.zip'),
        zip: true
      })
      if (evidence) {
        report.artifact = evidence.path
        console.log(`Saved guest acceptance artifacts to ${evidence.path} (${evidence.transport})`)
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
    report.state = /interactive|prompt|parameter|input/i.test(error.message)
      ? 'manual-required'
      : 'failed'
    report.preserved = started
    throw error
  }
}

// --- Lab acceptance: install the packaged products and assert what only a real machine shows ----

// The invitation code is a credential and there is no test-only activation bypass in the product, so
// it has to be supplied. It is validated here, before any VM work, and never written to a report.
export function validateLabConfig(config) {
  const code = config.InvitationCode
  if (typeof code !== 'string' || !code.trim() || code.length > 256 || /[\r\n\0]/.test(code)) {
    throw new Error(
      'config.local.json needs a non-empty InvitationCode (at most 256 characters, no CR/LF/NUL) so the service can be activated for real; the product has no test activation path'
    )
  }
  return code.trim()
}

// All three checks are prerequisites of `yarn lab:package:teacher`, which refuses anything but Node
// 24.20.0 and silently produces a service without WinSW if the asset is wrong. Failing here keeps the
// message next to the cause instead of surfacing it minutes later as a packaging error.
export function labPreflight({ platform, arch, nodeVersion, winswSha256 }) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error('lab-acceptance packages Windows x64 artifacts and requires a Windows x64 host')
  }
  if (nodeVersion !== LAB_NODE_VERSION) {
    throw new Error(
      `scripts/lab/build-server.mjs refuses to package the service unless Node is exactly ${LAB_NODE_VERSION}; this host runs ${nodeVersion}. Install Node ${LAB_NODE_VERSION} x64 and retry; there is no workaround.`
    )
  }
  if (winswSha256 !== LAB_WINSW_SHA256) {
    throw new Error(
      `${LAB_WINSW_FILE} is missing or does not match its pinned SHA-256. Run yarn setup (or node scripts/lab/download-service-assets.mjs) to prepare it; the build never downloads assets.`
    )
  }
}

export function labInstallerName(role, version) {
  return `ls101-lab-${role}-${version}-win-x64.exe`
}

// Mirrors what the guest script expects to find. `node` is the runtime the base box already ships for
// the guest file server, so the drivers run without installing anything else in the VM.
// `hostTime` is captured here, a couple of minutes before the guest task starts, and lets the guest
// detect a VM clock that is so far off that the TLS certificate window, the enrollment window and the
// licence window would all fail for reasons that have nothing to do with the product.
// The runtime the base box already ships for the guest file server, so the phase run needs no install.
// Shared by the guest configuration and the task action so the two can never disagree.
export function labGuestNodePath(nodeVersion) {
  return guestPath(`C:/ls101-lab/tools/node-v${nodeVersion}-win-x64/node.exe`)
}

export function labGuestConfig(config, { version, nodeVersion, port = LAB_HTTPS_PORT, hostTime }) {
  return {
    installer: guestPath(`${LAB_GUEST_DIR}/${labInstallerName('teacher', version)}`),
    // Milestone M4 uninstalls the client through the real NSIS uninstaller, so the package stays in
    // the transfer directory for the whole run instead of only during the first install. The student
    // installer travels the same way: the guest asserts it arrived, which is the only check that the
    // second half of the deliverable was built for this run.
    studentInstaller: guestPath(`${LAB_GUEST_DIR}/${labInstallerName('student', version)}`),
    driver: guestPath(`${LAB_GUEST_DIR}/manager-driver.mjs`),
    protocolDriver: guestPath(`${LAB_GUEST_DIR}/protocol-driver.mjs`),
    harness: guestPath(LAB_GUEST_HARNESS),
    probes: guestPath(LAB_GUEST_PROBES),
    invitationFile: guestPath(LAB_GUEST_INVITATION),
    releaseVersion: version,
    port,
    hostTime,
    node: labGuestNodePath(nodeVersion),
    serviceName: 'LS101Lab',
    serviceAccount: 'NT SERVICE\\LS101Lab',
    programDir: 'C:\\Program Files\\LS101LabService',
    // The installer creates and hardens the data *parent*; the `data` child is created by the service
    // on first start (startServiceRuntime does mkdir(root, {recursive:true})). Asserting the child
    // exists right after installation tests something the product never promised.
    dataRoot: 'C:\\ProgramData\\LS101Lab',
    dataDir: 'C:\\ProgramData\\LS101Lab\\data',
    resultsDir: guestPath(LAB_GUEST_RESULTS_DIR)
  }
}

export function labAcceptanceTaskScript(config) {
  return [
    // The launcher starts the phase run as a child with every stream redirected, so a failure that stops
    // the run from starting still leaves evidence instead of an unexplained non-zero task result.
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoLogo -NoProfile -ExecutionPolicy Bypass -File ${guestPath(LAB_GUEST_LAUNCHER)} -Node ${labGuestNodePath(config.NodeVersion)} -Script ${guestPath(LAB_GUEST_SCRIPT)} -Config ${guestPath(LAB_GUEST_CONFIG)} -ResultsDir ${guestPath(LAB_GUEST_RESULTS_DIR)} -Output ${guestPath(LAB_GUEST_TASK_OUTPUT)}'`,
    `$principal = New-ScheduledTaskPrincipal -UserId 'vagrant' -LogonType Interactive -RunLevel Highest`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)`,
    `Register-ScheduledTask -TaskName '${LAB_TASK}' -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
    `Remove-Item -LiteralPath '${guestPath(LAB_GUEST_STATUS)}' -Force -ErrorAction SilentlyContinue`,
    `Start-ScheduledTask -TaskName '${LAB_TASK}'`
  ].join('\n')
}

export function labGuestStateScript() {
  return guestStateScript({
    log: LAB_GUEST_LOG,
    progress: LAB_GUEST_PROGRESS,
    status: LAB_GUEST_STATUS,
    task: LAB_TASK
  })
}

// Milestone M2, case N13 and the remote half of N2. The protocol driver is the bundle the guest ran;
// what changes is where it runs from: this host, over the real VM network, with the guest firewall now
// open. Only a separate machine can prove that path, and only a non-loopback source can prove that the
// service grants no local exemption to whoever asks. Both commands receive the public fingerprint and
// deliberately no password: the host has to be refused, and refused before anything is sent when the
// pin does not match what answers on the port.
export function hostPeerDriverCommands({ address, fingerprint, version, port = LAB_HTTPS_PORT }) {
  const url = `https://${address}:${port}/`
  return [
    ['pin', ['pin', '--url', url, '--fingerprint', fingerprint, '--version', version]],
    ['login', ['login', '--url', url, '--fingerprint', fingerprint, '--version', version]]
  ]
}

// Reads the identity the guest published, so the host checks the fingerprint it was told rather than
// trusting whatever answers on the port.
export function hostPeerTarget(results) {
  const value = results?.['initialize-service']?.value
  if (!value || typeof value.fingerprint !== 'string' || !Number.isInteger(value.port)) return null
  return { fingerprint: value.fingerprint, port: value.port, serverId: value.serverId }
}

// The installer deliberately opens no firewall port, so opening it is a deployment step that has to be
// performed and then measured. RemoteAddress stays LocalSubnet, matching the documented guidance.
export function labFirewallScript(port = LAB_HTTPS_PORT) {
  return [
    `$rule = Get-NetFirewallRule -Name 'LS101-Lab-Service' -ErrorAction SilentlyContinue`,
    `if (-not $rule) { New-NetFirewallRule -Name 'LS101-Lab-Service' -DisplayName 'LS101 Lab service' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -RemoteAddress LocalSubnet | Out-Null }`,
    `Write-Output 'LS101 firewall rule present'`
  ].join('\n')
}

// The host is an ordinary inbound client on the virtual subnet, so this measures the guest listener
// and its firewall rather than a loopback shortcut. node:net ignores proxy environment variables.
export function probeGuestPort(address, port, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: address, port })
    let settled = false
    const done = (reachable) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(reachable)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

async function labAcceptance(root, config, run, report) {
  const invitationCode = validateLabConfig(config)
  const projectRoot = path.resolve(root, '..', '..')
  const metadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const version = metadata.version
  const winswPath = path.join(projectRoot, LAB_WINSW_FILE)
  labPreflight({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    winswSha256: (await exists(winswPath)) ? await sha256(winswPath) : ''
  })
  await verifyBox(root)
  ensureProvider(run)
  ensureVmwareUtility(run)
  const status = run('vagrant.exe', ['status', '--machine-readable'], { capture: true })
  const states = status
    .split(/\r?\n/)
    .filter((line) => line.split(',')[2] === 'state')
    .map((line) => line.split(',')[3])
  if (states.length !== 1 || states[0] !== 'not_created')
    throw new Error('vm:lab-acceptance requires no existing VM; use vm:destroy first.')
  const runId = `${Date.now()}-${randomUUID()}`
  const localRun = path.join(root, '.local', 'results', runId)
  await mkdir(localRun, { recursive: true })
  report.runId = runId
  report.state = 'running'
  report.lab = { releaseVersion: version, hostNodeVersion: process.versions.node }
  let started = false
  try {
    // Compile on the host. The guest has neither Node 24.20.0 nor a build toolchain, and the point of
    // this run is to install what a user installs rather than to rebuild the product in the VM.
    for (const role of ['teacher', 'student']) {
      run(
        process.execPath,
        [path.join(projectRoot, 'scripts', 'lab', 'package-desktop.mjs'), role],
        {
          cwd: projectRoot
        }
      )
    }
    const artifacts = {}
    for (const role of ['teacher', 'student']) {
      const name = labInstallerName(role, version)
      const file = path.join(projectRoot, 'dist', `lab-${role}`, name)
      if (!(await exists(file))) throw new Error(`Packaging did not produce ${name}`)
      artifacts[role] = { name, bytes: (await stat(file)).size, sha256: await sha256(file) }
    }
    report.artifacts = artifacts
    console.log(
      `Packaged lab installers: teacher ${Math.round(artifacts.teacher.bytes / (1024 * 1024))} MiB, student ${Math.round(artifacts.student.bytes / (1024 * 1024))} MiB`
    )
    // The guest driver is test tooling, so it is bundled with the repository's own Vite rather than
    // installed in the VM; the control-channel protocol is inlined from packages/lab-server.
    run(process.execPath, [path.join(projectRoot, 'scripts', 'lab', 'build-test-driver.mjs')], {
      cwd: projectRoot
    })
    const driver = path.join(projectRoot, 'out', 'lab-vm', 'manager-driver.mjs')
    const protocolDriver = path.join(projectRoot, 'out', 'lab-vm', 'protocol-driver.mjs')
    for (const [bundle, name] of [
      [driver, 'manager-driver.mjs'],
      [protocolDriver, 'protocol-driver.mjs']
    ]) {
      if (!(await exists(bundle))) throw new Error(`Bundling did not produce out/lab-vm/${name}`)
    }
    run('vagrant.exe', ['up', '--provider', 'vmware_desktop'])
    started = true
    run('vagrant.exe', [
      'upload',
      path.join(root, 'guest', 'fileserver.mjs'),
      GUEST_FILESERVER_SCRIPT
    ])
    let baseUrl = null
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
      console.log(
        `Guest desktop sessions:\n${report.guestSessions.map((line) => `  ${line}`).join('\n')}`
      )
      run('vagrant.exe', ['winrm', '--command', guestCommand(filesServerTaskScript(config))])
      baseUrl = await guestFileServerUrl(run)
      console.log(`Guest file server: ${baseUrl}`)
      console.log(`  live log: curl.exe --noproxy "*" ${baseUrl}/results/lab-acceptance.log`)
      await waitForGuestFileServer({ baseUrl })
      await putGuestFile(
        path.join(projectRoot, 'dist', 'lab-teacher', labInstallerName('teacher', version)),
        labInstallerName('teacher', version),
        { baseUrl }
      )
      await putGuestFile(
        path.join(projectRoot, 'dist', 'lab-student', labInstallerName('student', version)),
        labInstallerName('student', version),
        { baseUrl }
      )
      // The phase run itself: a Node orchestrator, the helpers it imports, and the PowerShell probes it
      // shells out to for structured data. All are flat files in the upload directory so the relative
      // import between the first two resolves in the guest.
      for (const name of [
        'lab-acceptance.mjs',
        'lab-harness.mjs',
        'lab-probes.ps1',
        'start-lab-acceptance.ps1'
      ]) {
        await putGuestFile(path.join(root, 'guest', name), name, { baseUrl })
      }
      await putGuestFile(driver, 'manager-driver.mjs', { baseUrl })
      await putGuestFile(protocolDriver, 'protocol-driver.mjs', { baseUrl })
      const configFile = path.join(localRun, 'lab-config.json')
      await writeFile(
        configFile,
        `${JSON.stringify(
          labGuestConfig(config, {
            version,
            nodeVersion: config.NodeVersion,
            hostTime: new Date().toISOString()
          }),
          null,
          2
        )}\n`
      )
      await putGuestFile(configFile, 'lab-config.json', { baseUrl })
      // The invitation code is a credential: it travels through the encrypted WinRM channel rather
      // than the plain-HTTP file server that carries the installers, and the guest deletes it once the
      // service has consumed it. `vagrant upload` is the only place it touches the guest filesystem.
      const invitationFile = path.join(tmpdir(), `ls101-invitation-${randomUUID()}.txt`)
      await writeFile(invitationFile, invitationCode, { mode: 0o600 })
      try {
        run('vagrant.exe', ['upload', invitationFile, LAB_GUEST_INVITATION])
      } finally {
        await unlink(invitationFile).catch(() => undefined)
      }
      report.transfers = { transport: 'guest-http', baseUrl }
      run('vagrant.exe', ['winrm', '--command', guestCommand(labAcceptanceTaskScript(config))])
      const outcome = await waitForAcceptanceStatus(run, {
        timeoutMs: LAB_ACCEPTANCE_TIMEOUT_MS,
        intervalMs: LAB_ACCEPTANCE_POLL_MS,
        label: 'lab acceptance',
        stateScript: labGuestStateScript
      })
      if (outcome !== 'passed')
        throw new Error('Guest lab acceptance run failed; see lab-acceptance.log')
      // The guest asserted that no firewall rule exists. Only the host can prove the gate is real:
      // probe first (must fail), open the port the documented way, then probe again.
      const address = new URL(baseUrl).hostname
      const before = await probeGuestPort(address, LAB_HTTPS_PORT)
      if (before) {
        throw new Error(
          `Guest port ${LAB_HTTPS_PORT} answered from this host before any firewall rule existed; the gate cannot be measured`
        )
      }
      run('vagrant.exe', ['winrm', '--command', guestCommand(labFirewallScript())])
      let after = false
      for (let attempt = 0; attempt < 10 && !after; attempt += 1) {
        after = await probeGuestPort(address, LAB_HTTPS_PORT)
        if (!after) await sleep(2000)
      }
      report.firewall = {
        address,
        port: LAB_HTTPS_PORT,
        reachableBefore: before,
        reachableAfter: after
      }
      if (!after) {
        throw new Error(
          `Guest port ${LAB_HTTPS_PORT} is still unreachable from this host after the firewall rule was added`
        )
      }
      console.log(`Firewall gate verified from the host: closed before the rule, open after it`)
    } catch (error) {
      guestError = error
    }
    for (const [guestFile, name] of [
      // The captured task output is listed first: it is the only artefact that explains a run which
      // died before the phase script could write anything of its own.
      [LAB_GUEST_TASK_OUTPUT, 'lab-task-output.txt'],
      [LAB_GUEST_STARTUP, 'lab-startup.txt'],
      [LAB_GUEST_LOG, 'lab-acceptance.log'],
      [LAB_GUEST_PROGRESS, 'lab-progress.txt'],
      [LAB_GUEST_RESULTS, 'lab-results.json']
    ]) {
      try {
        const evidence = await collectGuestEvidence(run, {
          baseUrl,
          name,
          guestFile,
          localPath: path.join(localRun, name)
        })
        if (evidence)
          await writeFile(evidence.path, decodeGuestText(await readFile(evidence.path)), 'utf8')
      } catch (error) {
        console.warn(`Guest ${name} is unavailable: ${error.message}`)
      }
    }
    try {
      const evidence = await collectGuestEvidence(run, {
        baseUrl,
        name: 'lab-artifacts.zip',
        guestFile: LAB_GUEST_ARTIFACT,
        localPath: path.join(localRun, 'lab-artifacts.zip'),
        zip: true
      })
      if (evidence) {
        report.artifact = evidence.path
        console.log(`Saved guest lab artifacts to ${evidence.path} (${evidence.transport})`)
      }
    } catch (error) {
      report.artifactError = error.message
      console.warn(`Guest lab artifacts could not be exported: ${error.message}`)
    }
    // The VM is preserved on failure, and a stuck stop stays stuck: WinSW only applies <stoptimeout>
    // when it kills the service process itself, so the state is still there, but the VM is only kept for
    // this run. Collecting the diagnostic here removes the need to run vm:diag by hand afterwards.
    if (guestError) {
      try {
        const diagnostic = readGuestOutput(run, labDiagnoseScript(config))
        console.log(diagnostic)
        const diagnosticPath = path.join(localRun, 'lab-diagnose.txt')
        await writeFile(diagnosticPath, `${diagnostic}\n`, 'utf8')
        report.diagnostic = diagnosticPath
        console.log(`Saved the automatic diagnostic to ${diagnosticPath}`)
      } catch (error) {
        console.warn(`The automatic diagnostic could not be collected: ${error.message}`)
        // Recorded in the host report as well: a paper trail that only reaches the console is exactly
        // what makes a preserved VM look like it was never inspected.
        report.diagnosticError = error.message
      }
    }
    // N13: the same driver bundle, run from this host against the guest over the real link. It happens
    // after the firewall gate above, because the port is deliberately closed until the deployment step
    // opens it, and after the evidence was collected, because the fingerprint it must check is published
    // in the guest results.
    if (!guestError && report.firewall?.reachableAfter) {
      try {
        const results = JSON.parse(await readFile(path.join(localRun, 'lab-results.json'), 'utf8'))
        const target = hostPeerTarget(results)
        if (!target) throw new Error('the guest results do not publish a fingerprint and port')
        const peer = {}
        for (const [name, args] of hostPeerDriverCommands({
          address: new URL(baseUrl).hostname,
          fingerprint: target.fingerprint,
          version,
          port: target.port
        })) {
          const output = run(process.execPath, [protocolDriver, ...args], {
            capture: true,
            quiet: true
          }).trim()
          peer[name] = JSON.parse(output)
          console.log(`Host peer ${name}: ${output}`)
        }
        report.hostPeer = peer
        await writeFile(
          path.join(localRun, 'lab-host-peer.json'),
          `${JSON.stringify(peer, null, 2)}\n`,
          'utf8'
        )
      } catch (error) {
        // Host-side evidence is a check, not a gate: a failure here must not mask a guest failure, and
        // the guest failure is the one that needs the VM preserved.
        report.hostPeerError = error.message
        console.warn(`The host peer check failed: ${error.message}`)
      }
    }
    if (guestError) throw guestError
    report.state = 'passed'
    run('vagrant.exe', ['halt'])
    run('vagrant.exe', ['destroy', '--force'])
    report.destroyed = true
  } catch (error) {
    report.state = /interactive|prompt|parameter|input/i.test(error.message)
      ? 'manual-required'
      : 'failed'
    report.preserved = started
    throw error
  }
}

// A named, read-only-or-reinstall script that the operator runs deliberately in a preserved VM.
//
// The reason this exists: the NSIS installer's `customInstall` hook runs
// `resources\lab-server\install-windows.ps1` through `nsExec` and **discards both streams**, then raises a
// MessageBox and aborts. When that happens the guest phase has not started, so nothing in the run's own
// artefacts says *why* the service installation failed — the only copy of the stage and message is the
// one the dialog swallowed. Running the same script from the package's own resources reproduces it with
// its output intact.
//
// The scripts are built here rather than passed in: this runs elevated in a VM, so the command surface
// stays a fixed list of named operations a reviewer can read.
export function labProbeNames() {
  return [
    'service-install',
    'service-verify',
    'installer-uninstall',
    'manifest-digests',
    'registration',
    'guard-inputs'
  ]
}

export function labProbeScript(name, config) {
  if (!labProbeNames().includes(name))
    throw new Error(`Unknown lab probe '${name}'; expected one of ${labProbeNames().join(', ')}`)
  const applicationDirectory = `${guestPath('C:/Program Files')}\\ls101-lab-teacher`
  const serviceInstaller = `${applicationDirectory}\\resources\\lab-server\\install-windows.ps1`
  const uninstaller = `${applicationDirectory}\\Uninstall ls101-lab-teacher.exe`
  // The installer is always invoked as a *separate process* through `-File`, which is what the product
  // does (NSIS runs it with `nsExec` from a fresh PowerShell). Launching it in-process with
  // `& 'install-windows.ps1'` fails for a reason that has nothing to do with the installer: the script's
  // trap writes plain text with `[Console]::Error.WriteLine`, and the parent then tries to deserialize
  // its stderr as CLIXML and dies with "Data at the root level is invalid" — losing the very
  // `LS101_INSTALL_ERROR [stage]: message` line the probe exists to read.
  const shell64 =
    "$shell = Join-Path $env:WINDIR 'Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe'; if (-not (Test-Path -LiteralPath $shell)) { $shell = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe' }"
  const runInstaller = (extra = '') =>
    `${shell64}; & $shell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '${serviceInstaller}'${extra} 2>&1 | ForEach-Object { Write-Output ([string]$_) }; Write-Output ('exitCode=' + $LASTEXITCODE)`
  const commands = {
    // Re-runs the exact script the NSIS hook ran, with no `-Verify`: this is the reproduction, and it
    // is also what tells a stuck installer apart from a failure the guard refused on purpose.
    'service-install': [
      `Write-Output ('service installer present: ' + (Test-Path -LiteralPath '${serviceInstaller}'))`,
      runInstaller(),
      `Write-Output ('serviceState=' + (Get-Service -Name '${config.serviceName ?? 'LS101Lab'}' -ErrorAction SilentlyContinue).Status)`
    ],
    // The same script front-loaded with its own digest/permission checks, which report a named stage
    // instead of the installer hook's silence.
    'service-verify': [runInstaller(' -Verify')],
    // The client's uninstaller, for the case where M4's own discovery is what is in question. It is
    // listed as a probe mainly so the path is visible in the output.
    'installer-uninstall': [
      `Write-Output ('uninstaller present: ' + (Test-Path -LiteralPath '${uninstaller}'))`,
      `Write-Output ('arguments used: /S')`,
      `& '${uninstaller}' /S`,
      `Write-Output ('exitCode=' + $LASTEXITCODE)`
    ],
    // What `install-windows.ps1` calls `sameRuntime`: the digest of the manifest inside the application
    // being installed against the one in the release the service actually runs from. They are equal for
    // a genuine same-version reinstall, and unequal turns that install into an "upgrade" that demands a
    // preparation record — the state that raises the failure dialog.
    'manifest-digests': [
      `$program = Join-Path $env:ProgramFiles 'LS101LabService'`,
      `$record = Join-Path $program 'installation.json'`,
      `Write-Output ('installation record: ' + (Test-Path -LiteralPath $record))`,
      `if (Test-Path -LiteralPath $record) {`,
      `  $release = (Get-Content -LiteralPath $record -Raw | ConvertFrom-Json).release`,
      `  $installedManifest = Join-Path $program ('releases\\' + $release + '\\runtime-manifest.json')`,
      `  $packagedManifest = '${applicationDirectory}\\resources\\lab-server\\runtime-manifest.json'`,
      `  Write-Output ('release=' + $release)`,
      `  Write-Output ('installed manifest exists=' + (Test-Path -LiteralPath $installedManifest) + ' packaged manifest exists=' + (Test-Path -LiteralPath $packagedManifest))`,
      `  if ((Test-Path -LiteralPath $installedManifest) -and (Test-Path -LiteralPath $packagedManifest)) {`,
      `    $installedHash = (Get-FileHash -LiteralPath $installedManifest -Algorithm SHA256).Hash`,
      `    $packagedHash = (Get-FileHash -LiteralPath $packagedManifest -Algorithm SHA256).Hash`,
      `    Write-Output ('installed=' + $installedHash.ToLowerInvariant())`,
      `    Write-Output ('packaged =' + $packagedHash.ToLowerInvariant())`,
      `    Write-Output ('sameRuntime=' + ($installedHash -eq $packagedHash))`,
      `    $installedVersion = (Get-Content -LiteralPath $installedManifest -Raw | ConvertFrom-Json).releaseVersion`,
      `    $packagedVersion = (Get-Content -LiteralPath $packagedManifest -Raw | ConvertFrom-Json).releaseVersion`,
      `    Write-Output ('installedVersion=' + $installedVersion + ' packagedVersion=' + $packagedVersion)`,
      `  }`,
      `}`,
      `Write-Output ('upgrade-ready present=' + (Test-Path -LiteralPath 'C:\\ProgramData\\LS101Lab\\data\\upgrade-ready.json'))`
    ],
    // The exact values `install-windows.ps1` compares before it will replace a runtime. A refusal at that
    // guard is silent from the outside — the NSIS hook discards the script's output and, since the silent
    // fix, only the exit code survives — so the inputs have to be readable after the fact.
    'guard-inputs': [
      `$p = Join-Path $env:ProgramFiles 'LS101LabService'`,
      `$d = Join-Path $env:ProgramData 'LS101Lab'`,
      `Write-Output ('service=' + [string](Get-Service -Name '${config.serviceName ?? 'LS101Lab'}' -ErrorAction SilentlyContinue).Status + ' db=' + (Test-Path -LiteralPath (Join-Path $d 'data\\service.sqlite')))`,
      `$r = Join-Path $p 'installation.json'`,
      `if (Test-Path -LiteralPath $r) {`,
      `  $rel = (Get-Content -LiteralPath $r -Raw | ConvertFrom-Json).release`,
      `  $im = Join-Path $p ('releases\\' + $rel + '\\runtime-manifest.json')`,
      `  $pm = '${applicationDirectory}\\resources\\lab-server\\runtime-manifest.json'`,
      `  Write-Output ('record=' + $rel + ' installedManifest=' + (Test-Path -LiteralPath $im) + ' packagedManifest=' + (Test-Path -LiteralPath $pm))`,
      `  if ((Test-Path -LiteralPath $im) -and (Test-Path -LiteralPath $pm)) {`,
      `    $a = (Get-FileHash -LiteralPath $im -Algorithm SHA256).Hash.ToLowerInvariant()`,
      `    $b = (Get-FileHash -LiteralPath $pm -Algorithm SHA256).Hash.ToLowerInvariant()`,
      `    Write-Output ('sameRuntime=' + ($a -eq $b) + ' installedVersion=' + (Get-Content -LiteralPath $im -Raw | ConvertFrom-Json).releaseVersion + ' packagedVersion=' + (Get-Content -LiteralPath $pm -Raw | ConvertFrom-Json).releaseVersion)`,
      `  }`,
      `}`,
      `$u = Join-Path $d 'data\\upgrade-ready.json'`,
      `Write-Output ('upgradeReadyPresent=' + (Test-Path -LiteralPath $u))`,
      `if (Test-Path -LiteralPath $u) { Write-Output (Get-Content -LiteralPath $u -Raw) }`
    ],
    // Why the manager helper reports STORAGE_UNAVAILABLE. `local-status.ts` asks exactly one question to
    // decide whether the service is registered — this PowerShell command — and turns any failure or
    // unexpected shape into that code, with no detail. Reproducing it verbatim, plus the plain SCM views,
    // separates "the service is gone" from "the query itself is broken".
    registration: [
      `$program = Join-Path $env:ProgramFiles 'LS101LabService'`,
      `$name = '${config.serviceName ?? 'LS101Lab'}'`,
      `$shell = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'`,
      `Write-Output '--- what local-status.ts runs ---'`,
      `$query = '$ErrorActionPreference = "Stop"; Get-CimInstance Win32_Service -Filter "Name=''$name''" | Select-Object State, StartMode | ConvertTo-Json -Compress'`,
      `$result = & $shell -NoLogo -NoProfile -NonInteractive -Command $query 2>&1`,
      `Write-Output ('exitCode=' + $LASTEXITCODE)`,
      `foreach ($line in @($result)) { Write-Output ('  out: ' + [string]$line) }`,
      `Write-Output '--- the same question asked other ways ---'`,
      `Write-Output ('cimDirect=' + [string](Get-CimInstance Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue | Select-Object State, StartMode | ConvertTo-Json -Compress))`,
      `Write-Output ('getService=' + [string](Get-Service -Name $name -ErrorAction SilentlyContinue).Status)`,
      `& sc.exe query $name 2>&1 | ForEach-Object { Write-Output ('  sc: ' + [string]$_) }`,
      `Write-Output '--- what the helper stats first ---'`,
      `$record = Join-Path $program 'installation.json'`,
      `Write-Output ('recordPresent=' + (Test-Path -LiteralPath $record))`,
      `if (Test-Path -LiteralPath $record) {`,
      `  $release = (Get-Content -LiteralPath $record -Raw | ConvertFrom-Json).release`,
      `  $base = Join-Path $program ('releases\\' + $release)`,
      `  Write-Output ('record=' + $release)`,
      `  Write-Output ('releaseDir=' + (Test-Path -LiteralPath $base) + ' node=' + (Test-Path -LiteralPath (Join-Path $base 'runtime\\node.exe')) + ' manager=' + (Test-Path -LiteralPath (Join-Path $base 'manager.cjs')) + ' runtimeManifest=' + (Test-Path -LiteralPath (Join-Path $base 'runtime-manifest.json')))`,
      `}`
    ]
  }
  return [
    `$ErrorActionPreference = 'Continue'`,
    `Write-Output '=== lab probe: ${name} ==='`,
    `Write-Output ('time=' + (Get-Date).ToString('o') + ' identity=' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)`,
    `$ProgressPreference = 'SilentlyContinue'`,
    ...commands[name]
  ].join('\n')
}

// Runs one named probe as an interactive elevated task and returns its captured output. The wait polls
// the task instead of sleeping a fixed amount: an installer that hits the failure dialog never finishes,
// and a fixed sleep would report "still running" as if it were an answer.
//
// The probe is written to the guest as a file and executed from there, because a command line cannot
// carry it: Windows caps one at 8191 characters, the probe has to be base64 UTF-16 to survive the trip,
// and that expansion alone put the larger probes over the limit. `winrm --command` reports the overrun as
// a bare `ENAMETOOLONG` with no hint about which argument was too long, so the limit is also enforced
// here at build time — a probe that has outgrown the mechanism fails in the container, not in the VM.
export const LAB_PROBE_COMMAND_LIMIT = 8191

// Documentation belongs in this file, not in the file that travels: the probe's comments are for whoever
// reads `labProbeScript`, and every byte of them is re-encoded twice on the way to the guest. Only whole
// comment lines are dropped, so a `#` inside a string is left alone.
export function stripScriptComments(script) {
  return script
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

// A plain-ASCII decoder written to the guest beside the encoded probe. It has no payload of its own,
// which is what keeps the generated command line short and the quoting trivial.
export function labProbeLauncher() {
  // Deliberately tiny: it is embedded in every probe's generated script, and that script has to stay
  // inside the 8191-character command line Windows accepts.
  //
  // The probe file is written as ASCII with no BOM — every probe is ASCII by construction, and Windows
  // PowerShell 5.1 reads a BOM-less file as the current ANSI code page, which cannot mangle ASCII and
  // cannot half-read a BOM. The previous version wrote UTF-16 without saying so, and for two probes
  // `-File` then produced no output at all: the silent shape a mis-decoded script has.
  return [
    `$ErrorActionPreference = 'Continue'`,
    `$base64 = (Get-Content -LiteralPath '${guestPath(LAB_PROBE_BASE64)}' -Raw).Trim()`,
    `[IO.File]::WriteAllText('${guestPath(LAB_PROBE_FILE)}', [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($base64)), [Text.Encoding]::ASCII)`,
    `& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File '${guestPath(LAB_PROBE_FILE)}' *> '${guestPath(LAB_PROBE_CAPTURE)}'`,
    `exit $LASTEXITCODE`
  ].join('\n')
}

export function labProbeTaskScript(name, config, { timeoutSeconds = 300 } = {}) {
  const probeScript = stripScriptComments(labProbeScript(name, config))
  const encodedProbe = Buffer.from(probeScript, 'utf16le').toString('base64')
  const base64Chunks = encodedProbe.match(/.{1,4000}/g) ?? ['']
  const script = [
    `$ErrorActionPreference = 'Continue'`,
    `Remove-Item -LiteralPath '${guestPath(LAB_PROBE_OUTPUT)}' -Force -ErrorAction SilentlyContinue`,
    // The base64 is written as data, not as code: `Set-Content` reads it from the pipeline, so no amount
    // of it ends up inside a quoted string that has to be parsed.
    `$chunks = @(`,
    ...base64Chunks.map(
      (chunk, index) => `  '${chunk}'${index === base64Chunks.length - 1 ? '' : ','}`
    ),
    `)`,
    `Set-Content -LiteralPath '${guestPath(LAB_PROBE_BASE64)}' -Value ($chunks -join '') -NoNewline -Encoding ascii`,
    `Set-Content -LiteralPath '${guestPath(LAB_PROBE_LAUNCHER)}' -Value (@'`,
    labProbeLauncher(),
    `'@) -Encoding ascii`,
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "${guestPath(LAB_PROBE_LAUNCHER)}" *> "${guestPath(LAB_PROBE_OUTPUT)}"'`,
    `$principal = New-ScheduledTaskPrincipal -UserId 'vagrant' -LogonType Interactive -RunLevel Highest`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)`,
    `Register-ScheduledTask -TaskName '${LAB_PROBE_TASK}' -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
    `Start-ScheduledTask -TaskName '${LAB_PROBE_TASK}'`,
    `$deadline = (Get-Date).AddSeconds(${timeoutSeconds})`,
    `while ((Get-Date) -lt $deadline) {`,
    `  $task = Get-ScheduledTask -TaskName '${LAB_PROBE_TASK}' -ErrorAction SilentlyContinue`,
    `  if (-not $task -or $task.State -ne 'Running') { break }`,
    `  Start-Sleep -Seconds 3`,
    `}`,
    `$task = Get-ScheduledTask -TaskName '${LAB_PROBE_TASK}' -ErrorAction SilentlyContinue`,
    `if ($task) { $info = $task | Get-ScheduledTaskInfo; Write-Output ('taskState=' + $task.State + ' lastResult=' + $info.LastTaskResult) }`,
    `Write-Output '=== probe output ==='`,
    // The launcher redirects the probe's own streams into the capture file, so an empty task output is
    // the normal shape, not a failure: both files are printed and the reader picks whichever has content.
    `if (Test-Path -LiteralPath '${guestPath(LAB_PROBE_OUTPUT)}') { Get-Content -LiteralPath '${guestPath(LAB_PROBE_OUTPUT)}' } else { Write-Output '(empty; see the launcher capture)' }`,
    `Write-Output '=== launcher capture ==='`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_PROBE_CAPTURE)}') { Get-Content -LiteralPath '${guestPath(LAB_PROBE_CAPTURE)}' } else { Write-Output 'MISSING: the launcher wrote no capture' }`,
    `Write-Output '=== probe that ran (decoded) ==='`,
    `Write-Output ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(($chunks -join ''))))`
  ].join('\n')
  if (script.length >= LAB_PROBE_COMMAND_LIMIT)
    throw new Error(
      `The '${name}' probe serialises to ${script.length} characters, which exceeds the ${LAB_PROBE_COMMAND_LIMIT}-character command line Windows accepts; the run would fail with ENAMETOOLONG before the probe started. Shorten the probe or split it.`
    )
  return script
}

// Read-only inspection of a preserved lab VM. A failed run keeps its VM precisely so it can be
// examined, but the harness otherwise only knows what it managed to collect; this answers the
// questions that come first when a run dies early — are the uploaded files where the task expects
// them, does the phase script even parse, and what did the task actually return.
export function labDiagnoseScript(config) {
  return [
    `$ErrorActionPreference = 'Continue'`,
    `$script = '${guestPath(LAB_GUEST_SCRIPT)}'`,
    `$config = '${guestPath(LAB_GUEST_CONFIG)}'`,
    `Write-Output '=== uploaded files ==='`,
    `foreach ($p in @($script, '${guestPath(LAB_GUEST_HARNESS)}', '${guestPath(LAB_GUEST_PROBES)}', $config, '${guestPath(LAB_GUEST_LAUNCHER)}', '${guestPath(`${LAB_GUEST_DIR}/manager-driver.mjs`)}', '${guestPath(`${LAB_GUEST_DIR}/protocol-driver.mjs`)}', '${guestPath(LAB_GUEST_INVITATION)}', '${guestPath(LAB_GUEST_RESULTS_DIR)}')) {`,
    `  if (Test-Path -LiteralPath $p) { $i = Get-Item -LiteralPath $p; Write-Output ('OK   ' + $p + ' bytes=' + $i.Length) } else { Write-Output ('MISS ' + $p) }`,
    `}`,
    `Write-Output '=== results directory ==='`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_GUEST_RESULTS_DIR)}') { Get-ChildItem -LiteralPath '${guestPath(LAB_GUEST_RESULTS_DIR)}' -Force | ForEach-Object { Write-Output ('  ' + $_.Name + ' ' + $_.Length) } }`,
    `Write-Output '=== syntax ==='`,
    // Node checks its own modules and PowerShell parses the probes: both are real checks, unlike asking
    // the PowerShell parser about a file written in another language.
    `$node = '${labGuestNodePath(config.NodeVersion)}'`,
    `foreach ($module in @($script, '${guestPath(LAB_GUEST_HARNESS)}')) {`,
    `  if (Test-Path -LiteralPath $module) { $checked = & $node --check $module 2>&1; Write-Output ("node --check $module exit=$LASTEXITCODE"); if ($LASTEXITCODE -ne 0) { $checked | Select-Object -First 10 | ForEach-Object { Write-Output ('  ' + $_) } } }`,
    `}`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_GUEST_PROBES)}') {`,
    `  $errors = $null`,
    `  [System.Management.Automation.Language.Parser]::ParseFile('${guestPath(LAB_GUEST_PROBES)}', [ref]$null, [ref]$errors) | Out-Null`,
    `  Write-Output ('probeParseErrors=' + @($errors).Count)`,
    `  @($errors) | Select-Object -First 15 | ForEach-Object { Write-Output ('  LINE ' + $_.Extent.StartLineNumber + ': ' + $_.Message) }`,
    `}`,
    `Write-Output '=== scheduled task ==='`,
    `$task = Get-ScheduledTask -TaskName '${LAB_TASK}' -ErrorAction SilentlyContinue`,
    `if ($task) { $info = $task | Get-ScheduledTaskInfo; Write-Output ('state=' + $task.State + ' lastResult=' + $info.LastTaskResult + ' lastRun=' + $info.LastRunTime); Write-Output ('action=' + $task.Actions.Arguments) } else { Write-Output 'MISSING' }`,
    // Product state is read through the same probes the phase run uses, so the same question cannot be
    // answered two ways. A duplicated inline query had already drifted: it reported the service state
    // without the process id, which is exactly the field a stuck stop needs.
    `$probes = '${guestPath(LAB_GUEST_PROBES)}'`,
    `$hasProbes = Test-Path -LiteralPath $probes`,
    `$lab = if (Test-Path -LiteralPath $config) { Get-Content -LiteralPath $config -Raw | ConvertFrom-Json } else { $null }`,
    `$serviceName = if ($lab) { $lab.serviceName } else { 'LS101Lab' }`,
    `$dataRoot = if ($lab) { $lab.dataRoot } else { 'C:\\ProgramData\\LS101Lab' }`,
    `$port = if ($lab) { $lab.port } else { 8443 }`,
    // Resolved once into plain strings: the probe arguments below are interpolated into a command line,
    // and a sub-expression there would have to be quoted by hand.
    `$logRoot = Join-Path $dataRoot 'logs'`,
    `$serviceProgramDirectory = Join-Path $env:ProgramFiles 'LS101LabService'`,
    // The probe is invoked through an explicit command line, and that command line is *parsed* before it
    // runs. That last part is the whole point: `& $probes @Arguments` and `& $probes $CommandLine` both
    // failed here, and the second failure explained the first — the error named the entire string
    // (`Unknown probe: -Probe service -Name 'LS101Lab'`), so the call operator had passed all of it as a
    // single value for the probe's first parameter instead of binding the arguments by name. The probe
    // script itself is fine: `lab-acceptance.mjs` runs the same file through `powershell -File`, where
    // Windows parses the arguments.
    //
    // `Invoke-Expression` applies the normal command-line parse. The command line is a single-quoted path
    // to a file this harness wrote, plus values from `lab-config.json` — paths, a service name, a port —
    // so quoting is the whole of the escaping needed and nothing here is external input.
    `function Quoted([string]$Value) { return "'" + ($Value -replace "'", "''") + "'" }`,
    `function Show-Probe([string]$Label, [string]$CommandLine) {`,
    `  Write-Output ('=== ' + $Label + ' ===')`,
    `  if (-not $hasProbes) { Write-Output 'lab-probes.ps1 is not present on this VM'; return }`,
    // A probe that fails must not take the rest of the diagnostic with it. The probes set
    // `$ErrorActionPreference = 'Stop'` for themselves, and PowerShell keeps that preference in this
    // scope after `&` returns, so the next native call or cmdlet becomes a terminating error. That is
    // how the first M4 run's diagnostic exited 1 after printing almost nothing: the failure it was
    // collected to explain left no record. The preference is therefore reset inside the catch.
    `  try {`,
    `    Invoke-Expression ('& ' + (Quoted $probes) + ' ' + $CommandLine)`,
    `  } catch {`,
    `    $failure = $_.Exception.Message`,
    `    $ErrorActionPreference = 'Continue'`,
    `    Write-Output ('probe ' + $Label + ' failed: ' + $failure)`,
    `  }`,
    `}`,
    `Show-Probe 'service' ('-Probe service -Name ' + (Quoted $serviceName))`,
    `Show-Probe 'wrapper processes' "-Probe process -Name 'LS101Lab.exe'"`,
    `Show-Probe 'runtime process' "-Probe process -Name 'node.exe' -Match 'server.cjs'"`,
    `Show-Probe 'service program directory' ('-Probe path -Path ' + (Quoted $serviceProgramDirectory))`,
    `Show-Probe 'data directory' ('-Probe path -Path ' + (Quoted $dataRoot))`,
    `Show-Probe 'wrapper logs' ('-Probe wrapper-logs -Path ' + (Quoted $logRoot) + " -Tail '80'")`,
    `Show-Probe 'system events' "-Probe events -Minutes '30' -Match 'LS101'"`,
    `Show-Probe 'listener' ('-Probe listener -Port ' + (Quoted ([string]$port)))`,
    // The install directory is named after the executable, not the product, so it is discovered rather
    // than guessed: assuming the product name once produced a confidently wrong conclusion.
    `Show-Probe 'installed application' ('-Probe find-executable -Name ''ls101-lab-teacher.exe'' -Path ' + (Quoted $env:ProgramFiles))`,
    // The installer's own record of *why* a service installation failed. `teacher.nsh` writes it because
    // the NSIS hook discards the script's output and a silent run has no dialog to read: without it an
    // unattended failure is an exit code with no reason, which is what the M4 run of 2026-09-20 hit.
    `Write-Output '=== installer failure log ==='`,
    `$failureLogs = @(`,
    `  (Join-Path $env:ProgramFiles 'ls101-lab-teacher\\resources\\lab-server\\install-failure.log'),`,
    `  'C:\\ls101-lab\\transfers\\install-failure.log'`,
    `)`,
    `$found = $false`,
    `foreach ($candidate in $failureLogs) {`,
    `  if (Test-Path -LiteralPath $candidate) {`,
    `    $found = $true`,
    `    Write-Output ('--- ' + $candidate + ' (' + (Get-Item -LiteralPath $candidate).LastWriteTime.ToString('o') + ') ---')`,
    `    Get-Content -LiteralPath $candidate`,
    `  }`,
    `}`,
    `if (-not $found) { Write-Output 'no installer failure log was written' }`,
    // The captured output is the one artefact that explains a run which died before writing its own.
    `Write-Output '=== captured task output (tail) ==='`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_GUEST_TASK_OUTPUT)}') { Get-Content -LiteralPath '${guestPath(LAB_GUEST_TASK_OUTPUT)}' -Tail 40 } else { Write-Output 'MISSING' }`,
    `Write-Output '=== phase start-up record ==='`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_GUEST_STARTUP)}') { Get-Content -LiteralPath '${guestPath(LAB_GUEST_STARTUP)}' } else { Write-Output 'MISSING (the phase script never reached its first statement)' }`,
    `Write-Output '=== phase log (tail) ==='`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_GUEST_LOG)}') { Get-Content -LiteralPath '${guestPath(LAB_GUEST_LOG)}' -Tail 20 } else { Write-Output 'MISSING' }`
  ].join('\n')
}

async function labDiagnose(root, config, run, report) {
  ensureVmwareUtility(run)
  const status = run('vagrant.exe', ['status', '--machine-readable'], { capture: true })
  const states = status
    .split(/\r?\n/)
    .filter((line) => line.split(',')[2] === 'state')
    .map((line) => line.split(',')[3])
  if (states.length !== 1 || states[0] !== 'running') {
    throw new Error(
      `vm:diag needs the preserved VM to be running (found ${states[0] ?? 'no VM'}); start it with yarn vm:up`
    )
  }
  // The probes are re-uploaded, because the whole point of the diagnostic is to ask the *current*
  // questions: reading a preserved VM with the probe script from the failed run means every answer comes
  // from the version that was already wrong once. That is not hypothetical — two runs in a row reported
  // nine probes failing with `Unknown probe: -Probe` from a stale upload, which buried the very evidence
  // the diagnostic was collected for.
  run('vagrant.exe', ['upload', path.join(root, 'guest', 'lab-probes.ps1'), LAB_GUEST_PROBES])
  const output = readGuestOutput(run, labDiagnoseScript(config))
  console.log(output)
  report.diagnostic = output
  const localRun = path.join(root, '.local', 'results', `${Date.now()}-diagnose-${randomUUID()}`)
  await mkdir(localRun, { recursive: true })
  await writeFile(path.join(localRun, 'lab-diagnose.txt'), `${output}\n`, 'utf8')
  report.diagnosticPath = path.join(localRun, 'lab-diagnose.txt')
}

// Runs the phase script once in a preserved VM and captures both streams.
//
// A scheduled task discards the output of the process it starts, so a run that dies before writing any
// of its own files leaves nothing to explain it. This registers a second task with the same principal
// as the real run — an interactive session at the highest run level — so the execution environment is
// reproduced exactly, and the launcher redirects the child's stdout and stderr into a file. The probe
// waits a bounded time and returns, so it never holds the WinRM call open for the length of an install.
export function labExecuteScript(config, { waitSeconds = 25 } = {}) {
  return [
    `$ErrorActionPreference = 'Continue'`,
    `$out = '${guestPath(LAB_GUEST_TASK_OUTPUT)}'`,
    `Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue`,
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoLogo -NoProfile -ExecutionPolicy Bypass -File ${guestPath(LAB_GUEST_LAUNCHER)} -Node ${labGuestNodePath(config.NodeVersion)} -Script ${guestPath(LAB_GUEST_SCRIPT)} -Config ${guestPath(LAB_GUEST_CONFIG)} -ResultsDir ${guestPath(LAB_GUEST_RESULTS_DIR)} -Output ${guestPath(LAB_GUEST_TASK_OUTPUT)}'`,
    `$principal = New-ScheduledTaskPrincipal -UserId 'vagrant' -LogonType Interactive -RunLevel Highest`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)`,
    `Register-ScheduledTask -TaskName '${LAB_EXECUTE_TASK}' -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
    `Start-ScheduledTask -TaskName '${LAB_EXECUTE_TASK}'`,
    `Start-Sleep -Seconds ${waitSeconds}`,
    `$task = Get-ScheduledTask -TaskName '${LAB_EXECUTE_TASK}' -ErrorAction SilentlyContinue`,
    `if ($task) { $info = $task | Get-ScheduledTaskInfo; Write-Output ('taskState=' + $task.State + ' lastResult=' + $info.LastTaskResult + ' lastRun=' + $info.LastRunTime) }`,
    `Write-Output '=== captured output ==='`,
    `if (Test-Path -LiteralPath $out) { Get-Content -LiteralPath $out -Tail 80 } else { Write-Output 'MISSING' }`,
    `Write-Output '=== phase start-up record ==='`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_GUEST_STARTUP)}') { Get-Content -LiteralPath '${guestPath(LAB_GUEST_STARTUP)}' } else { Write-Output 'MISSING (the phase script never reached its first statement)' }`,
    `Write-Output '=== results directory ==='`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_GUEST_RESULTS_DIR)}') { Get-ChildItem -LiteralPath '${guestPath(LAB_GUEST_RESULTS_DIR)}' -Force | ForEach-Object { Write-Output ('  ' + $_.Name + ' ' + $_.Length) } }`,
    `Write-Output '=== phase progress (tail) ==='`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_GUEST_PROGRESS)}') { Get-Content -LiteralPath '${guestPath(LAB_GUEST_PROGRESS)}' -Tail 10 }`,
    `Write-Output '=== phase log (tail) ==='`,
    `if (Test-Path -LiteralPath '${guestPath(LAB_GUEST_LOG)}') { Get-Content -LiteralPath '${guestPath(LAB_GUEST_LOG)}' -Tail 20 }`
  ].join('\n')
}

async function labExecute(root, config, run, report) {
  ensureVmwareUtility(run)
  const status = run('vagrant.exe', ['status', '--machine-readable'], { capture: true })
  const states = status
    .split(/\r?\n/)
    .filter((line) => line.split(',')[2] === 'state')
    .map((line) => line.split(',')[3])
  if (states.length !== 1 || states[0] !== 'running') {
    throw new Error(
      `vm:execute needs the preserved VM to be running (found ${states[0] ?? 'no VM'}); start it with yarn vm:up`
    )
  }
  const projectRoot = path.resolve(root, '..', '..')
  const version = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).version
  const localRun = path.join(root, '.local', 'results', `${Date.now()}-execute-${randomUUID()}`)
  await mkdir(localRun, { recursive: true })
  // Re-upload everything the run reads, so this exercises the current sources rather than whatever the
  // failed run happened to leave in the guest. The encrypted WinRM channel carries them.
  for (const name of [
    'lab-acceptance.mjs',
    'lab-harness.mjs',
    'lab-probes.ps1',
    'start-lab-acceptance.ps1'
  ]) {
    run('vagrant.exe', ['upload', path.join(root, 'guest', name), `${LAB_GUEST_DIR}/${name}`])
  }
  const configFile = path.join(localRun, 'lab-config.json')
  await writeFile(
    configFile,
    `${JSON.stringify(
      labGuestConfig(config, {
        version,
        nodeVersion: config.NodeVersion,
        hostTime: new Date().toISOString()
      }),
      null,
      2
    )}\n`
  )
  run('vagrant.exe', ['upload', configFile, LAB_GUEST_CONFIG])
  for (const name of ['manager-driver.mjs', 'protocol-driver.mjs']) {
    const bundle = path.join(projectRoot, 'out', 'lab-vm', name)
    if (await exists(bundle)) run('vagrant.exe', ['upload', bundle, `${LAB_GUEST_DIR}/${name}`])
  }
  // The phase script deletes the invitation code once the service has consumed it, so a re-run needs a
  // fresh copy; without one the run still starts and only the activation step would fail.
  try {
    const invitationCode = validateLabConfig(config)
    const invitationFile = path.join(localRun, 'invitation.txt')
    await writeFile(invitationFile, invitationCode, { mode: 0o600 })
    try {
      run('vagrant.exe', ['upload', invitationFile, LAB_GUEST_INVITATION])
    } finally {
      await unlink(invitationFile).catch(() => undefined)
    }
  } catch (error) {
    console.warn(`Invitation code not uploaded: ${error.message}`)
  }
  const output = readGuestOutput(run, labExecuteScript())
  console.log(output)
  report.execution = output
  await writeFile(path.join(localRun, 'lab-execute.txt'), `${output}\n`, 'utf8')
  report.executionPath = path.join(localRun, 'lab-execute.txt')
}

// Runs one named probe in a preserved lab VM. This is deliberately narrow: the probe list is fixed in
// `labProbeNames()`, and each entry is a short script built by `labProbeScript`. Nothing is uploaded —
// a probe only reads the machine, re-runs the service installer from the installed package's own
// resources, or runs the installed uninstaller, so it cannot invalidate the evidence it was asked about.
async function labProbe(root, config, run, report, probe) {
  ensureVmwareUtility(run)
  const status = run('vagrant.exe', ['status', '--machine-readable'], { capture: true })
  const states = status
    .split(/\r?\n/)
    .filter((line) => line.split(',')[2] === 'state')
    .map((line) => line.split(',')[3])
  if (states.length !== 1 || states[0] !== 'running') {
    throw new Error(
      `vm:probe needs the preserved VM to be running (found ${states[0] ?? 'no VM'}); start it with yarn vm:up`
    )
  }
  const localRun = path.join(root, '.local', 'results', `${Date.now()}-probe-${randomUUID()}`)
  await mkdir(localRun, { recursive: true })
  const output = readGuestOutput(run, labProbeTaskScript(probe, config))
  console.log(output)
  report.probe = { name: probe, output }
  report.probePath = path.join(localRun, `lab-probe-${probe}.txt`)
  await writeFile(report.probePath, `${output}\n`, 'utf8')
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
      } else if (
        action === 'acceptance' ||
        action === 'lab-acceptance' ||
        action === 'lab-diagnose' ||
        action === 'lab-execute' ||
        action === 'lab-probe'
      ) {
        const config = validateConfig(
          JSON.parse(await readFile(path.join(root, 'config.local.json'), 'utf8'))
        )
        if (action === 'acceptance') await acceptance(root, config, run, report)
        else if (action === 'lab-diagnose') await labDiagnose(root, config, run, report)
        else if (action === 'lab-execute') await labExecute(root, config, run, report)
        else if (action === 'lab-probe') await labProbe(root, config, run, report, parseProbe(args))
        else await labAcceptance(root, config, run, report)
      } else {
        await lifecycle(
          action,
          run,
          async () => {
            await verifyBox(root)
            ensureProvider(run)
          },
          ensureVmwareUtility
        )
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
