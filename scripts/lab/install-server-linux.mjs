import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  symlink,
  writeFile
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const source = import.meta.dirname
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
for (const name of ['server.cjs', 'runtime/node', 'ls101-lab.service'])
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
  await mkdir(destination, { mode: 0o755 })
  for (const file of manifest.files) {
    const target = join(destination, file.path)
    await mkdir(dirname(target), { recursive: true, mode: 0o755 })
    await copyFile(join(source, file.path), target, constants.COPYFILE_EXCL)
    await chmod(target, file.path === 'runtime/node' || file.path.endsWith('/7za') ? 0o755 : 0o644)
  }
  await writeFile(join(destination, 'runtime-manifest.json'), bytes, { flag: 'wx', mode: 0o644 })
  const next = join(installation, `current-${identifier}`)
  await symlink(destination, next)
  await copyFile(join(destination, 'ls101-lab.service'), '/etc/systemd/system/ls101-lab.service')
  await rename(next, join(installation, 'current'))
  execFileSync('systemctl', ['daemon-reload'], { stdio: ['ignore', 'pipe', 'pipe'] })
  process.stdout.write('Service installed and stopped. Autostart is unchanged.\n')
}
