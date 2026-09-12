/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
  yarn vm --help        Show this help

Default ISO URLs download automatically and record first-download SHA-256 values.
For custom/local ISOs, set the URL/path and a reviewed SHA-256 in config.local.json.
Host requirements: VMware Workstation, Vagrant, Vagrant VMware Utility.
Only the disposable Vagrant VM is destroyed. The base box and build output are retained.
cycle verifies VM lifecycle/WinRM readiness, not application or desktop tests.`

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
    PACKER_LOG_PATH: path.join(local, 'logs', 'packer.log')
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

export function createRunner(root, env, report, spawn = spawnSync) {
  return (command, args, { capture = false, extraEnv = {} } = {}) => {
    const step = { command: path.basename(command), args, startedAt: new Date().toISOString() }
    report.steps.push(step)
    console.log(`Running ${step.command} ${args.join(' ')}`)
    const result = spawn(command, args, {
      cwd: root,
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
      throw new Error(
        `${step.command} ${args[0] ?? ''} failed (${result.error?.code ?? result.signal ?? result.status})`
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

export async function lifecycle(action, run, prepareUp) {
  if (action === 'up') {
    await prepareUp()
    run('vagrant.exe', ['up', '--provider', 'vmware_desktop'])
    return
  }
  if (action !== 'cycle') {
    run('vagrant.exe', action === 'destroy' ? ['destroy', '--force'] : [action])
    return
  }
  await prepareUp()
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
      } else {
        await lifecycle(action, run, async () => {
          await verifyBox(root)
          ensureProvider(run)
        })
      }
      report.success = true
    } catch (error) {
      report.error = error.message
      throw error
    } finally {
      report.finishedAt = new Date().toISOString()
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
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
