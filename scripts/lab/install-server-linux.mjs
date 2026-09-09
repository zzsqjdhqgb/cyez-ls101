import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  symlink,
  writeFile
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const source = import.meta.dirname
// This installer runs as native JavaScript in the bundled Node runtime.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function syncPath(path) {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
const mode = process.argv[2]
if (!['--verify', '--install'].includes(mode) || process.argv.length !== 3)
  throw new Error('Use --verify or --install')
if (process.platform !== 'linux') throw new Error('Linux installation required')
const bytes = await readFile(join(source, 'runtime-manifest.json'))
const manifest = JSON.parse(bytes.toString('utf8'))
if (
  manifest.format !== 'ls101-service-runtime' ||
  manifest.platform !== process.platform ||
  manifest.arch !== process.arch ||
  manifest.nodeVersion !== '24.20.0' ||
  !/^[0-9A-Za-z.+-]+$/.test(manifest.releaseVersion)
)
  throw new Error('Incompatible service runtime')
if (!Array.isArray(manifest.files) || manifest.files.length > 32)
  throw new Error('Invalid runtime manifest')
const seen = new Set()
for (const file of manifest.files) {
  if (
    typeof file.path !== 'string' ||
    !/^[A-Za-z0-9_./-]+$/.test(file.path) ||
    file.path.startsWith('/') ||
    file.path.split('/').some((part) => part === '..' || part === '.') ||
    seen.has(file.path)
  )
    throw new Error('Invalid runtime file path')
  seen.add(file.path)
  const path = resolve(source, file.path)
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes)
    throw new Error('Invalid runtime file')
  if (
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex') !== file.sha256
  )
    throw new Error('Runtime digest mismatch')
}
for (const name of ['server.cjs', 'manager.cjs', 'runtime/node', 'ls101-lab.service'])
  if (!seen.has(name)) throw new Error('Incomplete service runtime')
await access(join(source, 'runtime/node'), constants.X_OK)
if (
  execFileSync(join(source, 'runtime/node'), ['--version'], { encoding: 'utf8' }).trim() !==
  'v24.20.0'
)
  throw new Error('Incorrect packaged Node version')
if (mode === '--verify') {
  process.stdout.write('Service runtime verified.\n')
} else {
  if (process.getuid() !== 0) throw new Error('Install as a system administrator')
  // The new bundle supplies its target version; the installed teacher need not know it.
  execFileSync(join(source, 'runtime/node'), [join(source, 'manager.cjs'), '--prepare-install'], {
    timeout: 35 * 60000,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (
    await lstat('/var/lib/ls101-lab/data/service.sqlite').then(
      () => true,
      (error) => {
        if (error.code !== 'ENOENT') throw error
        return false
      }
    )
  ) {
    const ready = JSON.parse(await readFile('/var/lib/ls101-lab/data/upgrade-ready.json', 'utf8'))
    if (
      ready.targetVersion !== manifest.releaseVersion ||
      !Number.isFinite(Date.parse(ready.preparedAt)) ||
      Date.parse(ready.preparedAt) < Date.now() - 86400000
    )
      throw new Error('Prepare the upgrade with a current backup before installation')
  }
  let state
  try {
    state = execFileSync('systemctl', ['is-active', 'ls101-lab.service'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  } catch (error) {
    if (![3, 4].includes(error.status)) throw new Error('System service manager is unavailable')
    state = String(error.stdout).trim()
  }
  if (!['inactive', 'failed', 'unknown'].includes(state))
    throw new Error('Stop the service before installation or upgrade')
  execFileSync(
    'systemd-sysusers',
    ['--inline', 'u ls101-lab - "LS101 Lab service" /var/lib/ls101-lab'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const installation = '/opt/ls101-lab'
  const releases = join(installation, 'releases')
  const identifier = `${manifest.releaseVersion}-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`
  const destination = join(releases, identifier)
  await mkdir(releases, { recursive: true, mode: 0o755 })
  // Each install gets an immutable version directory; existing program and data are retained.
  const existing = await lstat(destination).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (existing) {
    if (
      !existing.isDirectory() ||
      existing.isSymbolicLink() ||
      !(await readFile(join(destination, 'runtime-manifest.json'))).equals(bytes)
    )
      throw new Error('Existing release is incomplete or different')
    for (const file of manifest.files) {
      const info = await lstat(join(destination, file.path))
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        createHash('sha256')
          .update(await readFile(join(destination, file.path)))
          .digest('hex') !== file.sha256
      )
        throw new Error('Existing release integrity mismatch')
    }
  } else {
    await mkdir(destination, { mode: 0o755 })
    for (const file of manifest.files) {
      const target = join(destination, file.path)
      await mkdir(dirname(target), { recursive: true, mode: 0o755 })
      await copyFile(join(source, file.path), target, constants.COPYFILE_EXCL)
      await chmod(
        target,
        file.path === 'runtime/node' || file.path.endsWith('/7za') ? 0o755 : 0o644
      )
    }
    await writeFile(join(destination, 'runtime-manifest.json'), bytes, { flag: 'wx', mode: 0o644 })
  }
  const directories = new Set([destination])
  for (const file of manifest.files) {
    await syncPath(join(destination, file.path))
    let parent = dirname(join(destination, file.path))
    while (parent !== destination) {
      directories.add(parent)
      parent = dirname(parent)
    }
  }
  await syncPath(join(destination, 'runtime-manifest.json'))
  for (const directory of [...directories].sort((a, b) => b.length - a.length))
    await syncPath(directory)
  await syncPath(releases)
  await syncPath(installation)
  await syncPath(dirname(installation))
  const next = join(installation, `current-${randomUUID()}`)
  await symlink(destination, next)
  const unit = `/etc/systemd/system/ls101-lab-${randomUUID()}.service`
  await copyFile(join(destination, 'ls101-lab.service'), unit, constants.COPYFILE_EXCL)
  await syncPath(unit)
  await rename(unit, '/etc/systemd/system/ls101-lab.service')
  await syncPath('/etc/systemd/system')
  await rename(next, join(installation, 'current'))
  await syncPath(installation)
  execFileSync('systemctl', ['daemon-reload'], { stdio: ['ignore', 'pipe', 'pipe'] })
  process.stdout.write('Service installed and stopped. Autostart is unchanged.\n')
}
