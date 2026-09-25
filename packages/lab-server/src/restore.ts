import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { SCHEMA_VERSION } from './database'
import { DatabaseSync } from 'node:sqlite'
import { path7za } from '7zip-bin'
import type { BackupManifest } from './backups'
import { directoryPaths, lockDirectory } from './directory-lock'
import {
  durableWrite,
  ensureSpace,
  syncDirectory,
  verifiedFile,
  type FaultPoint
} from './durable-files'
import { LabError, requireCondition } from './errors'
import { LabService } from './service'
import { validateRuntimeConfig } from './runtime-config'

const REQUIRED = [
  'service.sqlite',
  'identity/key.pem',
  'identity/certificate.pem',
  'identity/server-id',
  'identity/idempotency.key'
]
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const ARCHIVE_PATH = new RegExp(
  `^(archives/(exams/${UUID}\\.lsexam|submissions/${UUID}\\.lssubmission)|test-data/${UUID}\\.lssubmission)$`
)
const MAX_MANIFEST = 16 * 1024 ** 2
const MAX_RESTORE = 128 * 1024 ** 3

export interface RestoreOptions {
  root: string
  archive: string
  password: string
  releaseVersion: string
  fault?: FaultPoint
}
interface RestoreJournal {
  format: 'ls101-restore'
  id: string
  releaseVersion: string
  serverId: string
}

async function exists(filename: string): Promise<boolean> {
  try {
    const info = await lstat(filename)
    requireCondition(!info.isSymbolicLink(), 'STORAGE_UNAVAILABLE')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

// Extract only a manifest-selected entry to stdout; the engine never writes archive paths.
async function extractEntry(
  archive: string,
  password: string,
  entry: string,
  limit: number,
  consume: (chunk: Buffer) => Promise<void>
): Promise<void> {
  requireCondition(!/[\r\n\0]/.test(password), 'INVALID_REQUEST')
  const child = spawn(path7za, ['x', '-so', '-bd', '-spd', '-y', resolve(archive), entry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  const closed = new Promise<void>((done, fail) => {
    child.once('error', () => fail(new LabError('STORAGE_UNAVAILABLE')))
    child.once('close', (code) => (code === 0 ? done() : fail(new LabError('INVALID_REQUEST'))))
  })
  void closed.catch(() => undefined)
  const timeout = setTimeout(() => child.kill(), 30 * 60000)
  child.stderr.resume()
  child.stdin.on('error', () => undefined)
  child.stdin.end(`${password}\n${password}\n`)
  let bytes = 0
  try {
    for await (const chunk of child.stdout) {
      bytes += chunk.length
      requireCondition(bytes <= limit, 'PAYLOAD_TOO_LARGE')
      await consume(chunk)
    }
    await closed
  } finally {
    clearTimeout(timeout)
    child.kill()
    await closed.catch(() => undefined)
  }
}

function validateManifest(value: unknown, version: string): BackupManifest {
  const manifest = value as BackupManifest
  requireCondition(
    manifest?.format === 'ls101-service-backup' &&
      manifest.schemaVersion === 1 &&
      manifest.releaseVersion === version &&
      typeof manifest.serverId === 'string' &&
      new RegExp(`^${UUID}$`).test(manifest.serverId) &&
      typeof manifest.snapshotAt === 'string' &&
      Number.isFinite(Date.parse(manifest.snapshotAt)) &&
      Array.isArray(manifest.files) &&
      manifest.files.length <= 100000,
    'INVALID_REQUEST'
  )
  const paths = new Set<string>()
  let total = 0
  for (const file of manifest.files) {
    requireCondition(
      file &&
        typeof file.path === 'string' &&
        (REQUIRED.includes(file.path) ||
          ['license.json', 'service-runtime.json'].includes(file.path) ||
          ARCHIVE_PATH.test(file.path)) &&
        !paths.has(file.path) &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes > 0 &&
        typeof file.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(file.sha256),
      'INVALID_REQUEST'
    )
    paths.add(file.path)
    total += file.bytes
    requireCondition(total <= MAX_RESTORE, 'PAYLOAD_TOO_LARGE')
  }
  requireCondition(
    REQUIRED.every((path) => paths.has(path)),
    'INVALID_REQUEST'
  )
  return manifest
}

async function verifyService(root: string, version: string, serverId: string): Promise<void> {
  if (await exists(join(root, 'service-runtime.json'))) {
    validateRuntimeConfig(JSON.parse(await readFile(join(root, 'service-runtime.json'), 'utf8')))
  }
  if (await exists(join(root, 'license.json'))) {
    const license = JSON.parse(await readFile(join(root, 'license.json'), 'utf8'))
    requireCondition(
      license?.schemaVersion === 1 &&
        typeof license.invitationCodeHash === 'string' &&
        /^[a-f0-9]{64}$/i.test(license.invitationCodeHash) &&
        typeof license.activatedAt === 'string' &&
        Number.isFinite(Date.parse(license.activatedAt)),
      'INVALID_REQUEST'
    )
  }
  const service = await LabService.open({
    root,
    releaseVersion: version,
    isLicenseActive: () => false
  })
  try {
    requireCondition(
      service.identity.serverId === serverId && service.data().mode === 'maintenance',
      'STORAGE_UNAVAILABLE'
    )
  } finally {
    await service.db.close()
  }
}

async function completeSwitch(
  root: string,
  journal: RestoreJournal,
  fault?: FaultPoint
): Promise<string> {
  const paths = directoryPaths(root)
  const staging = `${paths.prefix}.restore-${journal.id}`
  const previous = `${paths.prefix}.previous-${journal.id}`
  if (await exists(staging)) {
    await verifyService(staging, journal.releaseVersion, journal.serverId)
    if (await exists(paths.target)) {
      requireCondition(!(await exists(previous)), 'STORAGE_UNAVAILABLE')
      await rename(paths.target, previous)
      await syncDirectory(paths.parent)
      await fault?.('restore-original-moved')
    }
    requireCondition(await exists(previous), 'STORAGE_UNAVAILABLE')
    await rename(staging, paths.target)
    await syncDirectory(paths.parent)
    await fault?.('restore-installed')
  } else {
    requireCondition(
      (await exists(previous)) && (await exists(paths.target)),
      'STORAGE_UNAVAILABLE'
    )
  }
  await rm(paths.journal)
  await syncDirectory(paths.parent)
  return previous
}

export async function recoverOfflineRestore(root: string, releaseVersion: string): Promise<string> {
  const runtimeLock = await lockDirectory(`${root}.runtime`)
  let lock: Awaited<ReturnType<typeof lockDirectory>> | undefined
  try {
    lock = await lockDirectory(root)
    const paths = directoryPaths(root)
    const bytes = await readFile(paths.journal)
    requireCondition(bytes.length <= 4096, 'INVALID_REQUEST')
    const journal = JSON.parse(bytes.toString('utf8')) as RestoreJournal
    requireCondition(
      journal.format === 'ls101-restore' &&
        new RegExp(`^${UUID}$`).test(journal.id) &&
        new RegExp(`^${UUID}$`).test(journal.serverId) &&
        journal.releaseVersion === releaseVersion,
      'INVALID_REQUEST'
    )
    return await completeSwitch(root, journal)
  } finally {
    lock?.close()
    runtimeLock.close()
  }
}

export async function restoreOffline(
  options: RestoreOptions
): Promise<{ previousDirectory: string; serverId: string }> {
  requireCondition(
    typeof options.password === 'string' &&
      options.password.length >= 1 &&
      options.password.length <= 1024 &&
      !/[\r\n\0]/.test(options.password),
    'INVALID_REQUEST'
  )
  const paths = directoryPaths(options.root)
  const runtimeLock = await lockDirectory(`${options.root}.runtime`)
  let lock: Awaited<ReturnType<typeof lockDirectory>> | undefined
  const id = randomUUID()
  const staging = `${paths.prefix}.restore-${id}`
  let journalWritten = false
  try {
    lock = await lockDirectory(options.root)
    requireCondition(
      (await exists(paths.target)) && !(await exists(paths.journal)),
      'STORAGE_UNAVAILABLE'
    )
    const chunks: Buffer[] = []
    await extractEntry(
      options.archive,
      options.password,
      'manifest.json',
      MAX_MANIFEST,
      async (chunk) => {
        chunks.push(chunk)
      }
    )
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new LabError('INVALID_REQUEST')
    }
    const manifest = validateManifest(parsed, options.releaseVersion)
    await ensureSpace(
      paths.parent,
      manifest.files.reduce((sum, file) => sum + file.bytes, 0)
    )
    await mkdir(staging, { mode: 0o700 })
    for (const file of manifest.files) {
      const filename = join(staging, file.path)
      await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
      const handle = await open(filename, 'wx', 0o600)
      try {
        await extractEntry(
          options.archive,
          options.password,
          file.path,
          file.bytes,
          async (chunk) => {
            await handle.writeFile(chunk)
          }
        )
        await handle.sync()
      } finally {
        await handle.close()
      }
      await verifiedFile(filename, file.bytes, file.sha256)
      await syncDirectory(dirname(filename))
    }
    const database = new DatabaseSync(join(staging, 'service.sqlite'))
    try {
      requireCondition(
        database.prepare('PRAGMA user_version').get()?.user_version === SCHEMA_VERSION &&
          database.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok' &&
          database.prepare('PRAGMA foreign_key_check').all().length === 0,
        'STORAGE_UNAVAILABLE'
      )
      database.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE;')
      const row = database.prepare('SELECT data FROM service WHERE singleton=1').get()
      requireCondition(row && typeof row.data === 'string', 'STORAGE_UNAVAILABLE')
      const data = JSON.parse(row.data as string)
      data.mode = 'maintenance'
      data.modeRevision++
      database.prepare('UPDATE service SET data=? WHERE singleton=1').run(JSON.stringify(data))
      // GC paths belong to the old directory, and excluded garbage is not restored.
      database.exec(
        "DELETE FROM teacher_sessions; DELETE FROM backups; DELETE FROM file_gc; DELETE FROM idempotency WHERE method='POST' AND route='/teacher/backups';"
      )
      await options.fault?.('restore-indexes-cleared')
      database.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE);')
    } finally {
      database.close()
    }
    await verifyService(staging, options.releaseVersion, manifest.serverId)
    await syncDirectory(staging)
    await options.fault?.('restore-verified')
    await durableWrite(
      paths.journal,
      JSON.stringify({
        format: 'ls101-restore',
        id,
        releaseVersion: options.releaseVersion,
        serverId: manifest.serverId
      } satisfies RestoreJournal)
    )
    journalWritten = true
    await options.fault?.('restore-switch-recorded')
    const previousDirectory = await completeSwitch(
      options.root,
      {
        format: 'ls101-restore',
        id,
        releaseVersion: options.releaseVersion,
        serverId: manifest.serverId
      },
      options.fault
    )
    return { previousDirectory, serverId: manifest.serverId }
  } finally {
    try {
      if (!journalWritten) await rm(staging, { recursive: true, force: true })
    } finally {
      lock?.close()
      runtimeLock.close()
    }
  }
}
