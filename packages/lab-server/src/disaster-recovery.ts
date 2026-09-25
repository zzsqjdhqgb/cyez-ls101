import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import {
  chown,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  rmdir,
  stat,
  unlink
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { directoryPaths, lockDirectory } from './directory-lock'
import { digestFile, durableWrite, syncDirectory } from './durable-files'
import { serviceRegistration } from './local-status'

export interface RecoveryPaths {
  root: string
  program: string
  source: string
  unit?: string
}
export interface RecoveryExport {
  directory: string
  manifestSha256: string
  files: number
  bytes: number
}
interface Entry {
  path: string
  kind: 'directory' | 'file'
  bytes?: number
  sha256?: string
}
interface Manifest {
  format: 'ls101-raw-recovery'
  source: string
  createdAt: string
  entries: Entry[]
}
const failure = (code: string): Error => Object.assign(new Error(code), { code })
const check = (condition: unknown, code = 'LOCAL_RECOVERY_INVALID'): void => {
  if (!condition) throw failure(code)
}

export function installedRecoveryPaths(): RecoveryPaths {
  // Intentionally independent of installation.json, runtime manifests and service.sqlite.
  return process.platform === 'win32'
    ? {
        root: join(process.env.ProgramData || 'C:\\ProgramData', 'LS101Lab', 'data'),
        program: join(process.env.ProgramFiles || 'C:\\Program Files', 'LS101LabService'),
        source: __dirname
      }
    : { root: '/var/lib/ls101-lab/data', program: '/opt/ls101-lab', source: __dirname }
}

function inside(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child))
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return false
    }
  )
}

async function command(file: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 30000, maxBuffer: 65536 },
      (error, stdout) => {
        if (error) reject(failure('LOCAL_RECOVERY_OS_FAILED'))
        else resolve(stdout.trim())
      }
    )
  })
}

function lockFiles(root: string): Set<string> {
  return new Set(
    [root, `${root}.runtime`, `${root}.emergency`].flatMap((path) => {
      const file = basename(directoryPaths(path).lock)
      return [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]
    })
  )
}

async function inventory(root: string, excluded = new Set<string>()): Promise<Entry[]> {
  const entries: Entry[] = []
  if (!(await exists(root))) return entries
  check((await lstat(root)).isDirectory() && !(await lstat(root)).isSymbolicLink())
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name
      if (excluded.has(path)) continue
      const filename = join(directory, name)
      const info = await lstat(filename)
      // A stopped Linux daemon may leave its local socket behind. It contains no stored data.
      if (info.isSocket() && path === 'data/control.sock') continue
      check(!info.isSymbolicLink(), 'LOCAL_RECOVERY_UNSAFE_PATH')
      if (info.isDirectory()) {
        entries.push({ path, kind: 'directory' })
        await visit(filename, path)
      } else {
        check(info.isFile(), 'LOCAL_RECOVERY_UNSAFE_PATH')
        entries.push({ path, kind: 'file', bytes: info.size, sha256: await digestFile(filename) })
      }
    }
  }
  await visit(root, '')
  return entries
}

async function stopped(): Promise<void> {
  const status = await serviceRegistration()
  check(!status.installed || status.stopped, 'LOCAL_RECOVERY_SERVICE_RUNNING')
}

async function locked<T>(paths: RecoveryPaths, work: () => Promise<T>): Promise<T> {
  await stopped()
  const locks: Awaited<ReturnType<typeof lockDirectory>>[] = []
  try {
    for (const root of [`${paths.root}.emergency`, `${paths.root}.runtime`, paths.root]) {
      locks.push(await lockDirectory(root))
      if (process.platform === 'linux') {
        const owner = await stat(dirname(paths.root))
        await chown(directoryPaths(root).lock, owner.uid, owner.gid)
      }
    }
    await stopped()
    return await work()
  } finally {
    for (const lock of locks.reverse()) lock.close()
  }
}

async function validateDestination(paths: RecoveryPaths, directory: string): Promise<string> {
  check(typeof directory === 'string' && isAbsolute(directory))
  const target = await realpath(directory)
  check(!(await lstat(directory)).isSymbolicLink(), 'LOCAL_RECOVERY_UNSAFE_PATH')
  const data = await realpath(dirname(paths.root))
  const program = await realpath(paths.program).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return resolve(paths.program)
  })
  check(
    !inside(data, target) &&
      !inside(target, data) &&
      !inside(program, target) &&
      !inside(target, program),
    'LOCAL_RECOVERY_UNSAFE_PATH'
  )
  return target
}

export async function exportRawData(paths: RecoveryPaths, input: unknown): Promise<RecoveryExport> {
  const value = input as { directory?: string; owner?: { uid: number; gid: number } }
  check(value && typeof value.directory === 'string')
  return locked(paths, async () => {
    const directory = await validateDestination(paths, value.directory!)
    check((await readdir(directory)).length === 0)
    const source = dirname(paths.root)
    const entries = await inventory(source, lockFiles(paths.root))
    const payload = join(directory, 'original')
    await mkdir(payload, { mode: 0o700 })
    for (const entry of entries) {
      const target = join(payload, entry.path)
      if (entry.kind === 'directory') await mkdir(target, { mode: 0o700 })
      else {
        await copyFile(join(source, entry.path), target, constants.COPYFILE_EXCL)
        const handle = await open(target, 'r+')
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
    }
    check(
      JSON.stringify(await inventory(payload)) === JSON.stringify(entries),
      'LOCAL_RECOVERY_EXPORT_CHANGED'
    )
    check(
      JSON.stringify(await inventory(source, lockFiles(paths.root))) === JSON.stringify(entries),
      'LOCAL_RECOVERY_SOURCE_CHANGED'
    )
    for (const entry of [...entries].reverse())
      if (entry.kind === 'directory') await syncDirectory(join(payload, entry.path))
    await syncDirectory(payload)
    const manifest: Manifest = {
      format: 'ls101-raw-recovery',
      source: resolve(source),
      createdAt: new Date().toISOString(),
      entries
    }
    const text = JSON.stringify(manifest)
    await durableWrite(join(directory, 'manifest.json'), text)
    // Files are created by the elevated helper. Hand the copy back to the initiating user.
    if (process.platform === 'linux') {
      check(
        value.owner &&
          Number.isSafeInteger(value.owner.uid) &&
          value.owner.uid >= 0 &&
          Number.isSafeInteger(value.owner.gid) &&
          value.owner.gid >= 0
      )
      for (const filename of [
        directory,
        payload,
        join(directory, 'manifest.json'),
        ...entries.map((entry) => join(payload, entry.path))
      ])
        await chown(filename, value.owner!.uid, value.owner!.gid)
    }
    return {
      directory,
      manifestSha256: createHash('sha256').update(text).digest('hex'),
      files: entries.filter((entry) => entry.kind === 'file').length,
      bytes: entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)
    }
  })
}

export async function purgeExportedService(paths: RecoveryPaths, receipt: unknown): Promise<void> {
  const value = receipt as RecoveryExport
  check(value && typeof value.directory === 'string' && /^[a-f0-9]{64}$/.test(value.manifestSha256))
  const source = dirname(paths.root)
  await locked(paths, async () => {
    const directory = await validateDestination(paths, value.directory)
    const text = await readFile(join(directory, 'manifest.json'), 'utf8')
    check(
      createHash('sha256').update(text).digest('hex') === value.manifestSha256,
      'LOCAL_RECOVERY_EXPORT_CHANGED'
    )
    const manifest = JSON.parse(text) as Manifest
    check(manifest.format === 'ls101-raw-recovery' && manifest.source === resolve(source))
    const exported = await inventory(join(directory, 'original'))
    check(
      JSON.stringify(exported) === JSON.stringify(manifest.entries),
      'LOCAL_RECOVERY_EXPORT_CHANGED'
    )
    const current = await inventory(source, lockFiles(paths.root))
    const original = new Map(exported.map((entry) => [entry.path, JSON.stringify(entry)]))
    // A retry after partial deletion may see a subset, but never accept changed/new files.
    check(
      current.every((entry) => original.get(entry.path) === JSON.stringify(entry)),
      'LOCAL_RECOVERY_SOURCE_CHANGED'
    )
    check(
      !inside(paths.program, paths.source) && !inside(paths.program, process.execPath),
      'LOCAL_RECOVERY_UNSAFE_PATH'
    )
    if (await exists(paths.program))
      check(!(await lstat(paths.program)).isSymbolicLink(), 'LOCAL_RECOVERY_UNSAFE_PATH')
    const registration = await serviceRegistration()
    if (registration.installed) {
      check(registration.stopped, 'LOCAL_RECOVERY_SERVICE_RUNNING')
      if (process.platform === 'win32') {
        const raw = await command('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$ErrorActionPreference = "Stop"; Get-CimInstance Win32_Service -Filter "Name=\'LS101Lab\'" | Select-Object PathName | ConvertTo-Json -Compress'
        ])
        const executable = String(JSON.parse(raw)?.PathName ?? '')
          .trim()
          .replace(/^"(.*)"$/, '$1')
        check(
          isAbsolute(executable) &&
            inside(paths.program, executable) &&
            basename(executable).toLowerCase() === 'ls101lab.exe',
          'LOCAL_SERVICE_IDENTITY_MISMATCH'
        )
        await command('sc.exe', ['config', 'LS101Lab', 'start=', 'disabled'])
        await command('sc.exe', ['delete', 'LS101Lab'])
      } else {
        const unit = paths.unit ?? '/etc/systemd/system/ls101-lab.service'
        const registered = await command('systemctl', [
          'show',
          'ls101-lab.service',
          '--property=FragmentPath',
          '--value'
        ])
        check(registered === unit, 'LOCAL_SERVICE_IDENTITY_MISMATCH')
        await command('systemctl', ['disable', 'ls101-lab.service'])
        await rm(paths.unit ?? '/etc/systemd/system/ls101-lab.service', { force: true })
        await syncDirectory(dirname(paths.unit ?? '/etc/systemd/system/ls101-lab.service'))
        await command('systemctl', ['daemon-reload'])
      }
      check(!(await serviceRegistration()).installed, 'LOCAL_RECOVERY_OS_FAILED')
    }
    await rm(paths.program, { recursive: true, force: true })
    // Delete only verified entries. A newly appearing file prevents directory removal.
    for (const entry of [...current].reverse()) {
      const filename = join(source, entry.path)
      if (entry.kind === 'file') await unlink(filename)
      else {
        if (entry.path === 'data') {
          const socket = join(filename, 'control.sock')
          if (await exists(socket)) {
            check((await lstat(socket)).isSocket(), 'LOCAL_RECOVERY_SOURCE_CHANGED')
            await unlink(socket)
          }
        }
        await rmdir(filename)
      }
    }
    await syncDirectory(source)
  })
  // SQLite lock handles must be closed before removing their files on Windows.
  for (const name of lockFiles(paths.root)) await rm(join(source, name), { force: true })
  await rmdir(source)
  await syncDirectory(dirname(source))
}
