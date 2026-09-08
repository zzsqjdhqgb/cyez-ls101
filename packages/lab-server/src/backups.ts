import { backup } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { path7za } from '7zip-bin'
import { chmod, copyFile, mkdir, open, rename, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Schema, RequestBody } from '@ls101/lab-contracts'
import type { LabService, Context, Result } from './service'
import { digestFile, durableWrite, syncDirectory, verifiedFile } from './durable-files'
import { LabError, requireCondition } from './errors'

interface BackupRow {
  id: string
  state: Schema<'Backup'>['status']
  barrier_state: 'reserved' | 'active' | 'released'
  data: string
}
export interface BackupManifest {
  format: 'ls101-service-backup'
  schemaVersion: 1
  releaseVersion: string
  serverId: string
  snapshotAt: string
  files: Array<{ path: string; sha256: string; bytes: number }>
}

export async function runArchiveEngine(
  engine: string,
  args: string[],
  password: string,
  signal?: AbortSignal
): Promise<void> {
  // Password bytes go only to the child pipe. Child output is deliberately not logged.
  if (password.includes('\n') || password.includes('\r') || password.includes('\0'))
    throw new Error('Backup password contains unsupported control characters')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(engine, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      signal
    })
    let failed = false
    const timeout = setTimeout(() => {
      failed = true
      child.kill()
      reject(new Error('Backup engine timed out'))
    }, 30 * 60000)
    child.stdout.resume()
    child.stderr.resume()
    child.stdin.on('error', () => undefined)
    child.once('error', () => {
      clearTimeout(timeout)
      failed = true
      reject(new Error('Backup engine could not start'))
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (!failed) code === 0 ? resolve() : reject(new Error('Backup archive verification failed'))
    })
    child.stdin.end(`${password}\n${password}\n`)
  })
}

export class BackupStore {
  private readonly jobs = new Map<string, Promise<void>>()
  readonly engine: string
  constructor(readonly service: LabService) {
    this.engine = path7za
  }

  get(id: string): Schema<'Backup'> {
    const row = this.service.db.get<BackupRow>('SELECT * FROM backups WHERE id=?', id)
    requireCondition(row, 'NOT_FOUND')
    return JSON.parse(row.data)
  }

  private save(value: Schema<'Backup'>, barrier: BackupRow['barrier_state']): void {
    this.service.db.run(
      'UPDATE backups SET state=?,barrier_state=?,data=? WHERE id=?',
      value.status,
      barrier,
      JSON.stringify(value),
      value.id
    )
  }

  private queueCleanup(id: string, published: boolean): void {
    for (const [path, reason] of [
      [join(this.service.options.root, 'backup-staging', id), 'backup-staging'],
      [join(this.service.options.root, 'backups', `${id}.part.7z`), 'backup-incomplete'],
      ...(published
        ? [[join(this.service.options.root, 'backups', `${id}.7z`), 'backup-incomplete']]
        : [])
    ])
      this.service.db.run('INSERT OR IGNORE INTO file_gc VALUES (?,?,?)', path, 0, reason)
  }

  create(context: Context): Result {
    const body = context.body as RequestBody<'postTeacherBackups'>
    requireCondition(
      typeof body.encryptionPassword === 'string' &&
        body.encryptionPassword.length >= 1 &&
        body.encryptionPassword.length <= 1024 &&
        !/[\r\n\0]/.test(body.encryptionPassword),
      'INVALID_REQUEST'
    )
    const digest = this.service.operationDigest(body, true)
    const replay = this.service.replay(context, digest)
    if (replay) return replay
    this.service.assertAuthorized(context)
    const blockers = this.conflicts()
    requireCondition(
      this.service.data().mode === 'maintenance',
      'RESOURCE_BUSY',
      this.service.mode()
    )
    requireCondition(blockers.length === 0, 'RESOURCE_BUSY', { blockers })
    const result = this.service.write(context, () => {
      const existing = this.service.replay(context, digest)
      if (existing) return existing
      requireCondition(
        this.service.data().mode === 'maintenance',
        'RESOURCE_BUSY',
        this.service.mode()
      )
      requireCondition(this.conflicts().length === 0, 'RESOURCE_BUSY', {
        blockers: this.conflicts()
      })
      const value: Schema<'Backup'> = {
        id: randomUUID(),
        status: 'pending',
        createdAt: this.service.timestamp(),
        snapshotAt: null,
        releaseVersion: this.service.options.releaseVersion,
        archiveBytes: null,
        archiveSha256: null,
        error: null
      }
      this.service.db.run(
        'INSERT INTO backups VALUES (?,?,?,?)',
        value.id,
        'pending',
        'reserved',
        JSON.stringify(value)
      )
      return this.service.remember(context, digest, { status: 202, body: value })
    })
    const id = (result.body as Schema<'Backup'>).id
    if (!this.jobs.has(id)) {
      const work = Promise.resolve()
        .then(() => this.run(id, body.encryptionPassword))
        .finally(() => this.jobs.delete(id))
      this.jobs.set(id, work)
      void work.catch(() => undefined)
    }
    return result
  }

  conflicts(): Schema<'Blocker'>[] {
    const activeBatches = new Set(
      this.service
        .taskRows()
        .filter((task) => ['running', 'cancel-requested'].includes(task.status))
        .map((task) => this.service.tasks.row(task.id).batch_id)
    )
    return this.service
      .blockers()
      .filter(
        (blocker) =>
          blocker.kind.startsWith('backup-') ||
          blocker.kind === 'active-task-lease' ||
          activeBatches.has(blocker.resourceId)
      )
  }

  async wait(): Promise<void> {
    await Promise.allSettled(this.jobs.values())
  }

  private async run(id: string, password: string): Promise<void> {
    const { db } = this.service
    const staging = join(this.service.options.root, 'backup-staging', id)
    const temporary = join(this.service.options.root, 'backups', `${id}.part.7z`)
    const target = join(this.service.options.root, 'backups', `${id}.7z`)
    let ownsGate = false
    try {
      await this.service.options.fault?.('backup-pending')
      const row = db.get<BackupRow>('SELECT * FROM backups WHERE id=?', id)
      if (!row || row.state !== 'pending') return
      const drained = db.gate.close(id)
      ownsGate = true
      for (const transfer of this.service.transfers.values())
        transfer.abort(new LabError('SERVICE_NOT_READY'))
      await this.service.options.fault?.('backup-admission-closed')
      await drained
      db.transaction(() => {
        requireCondition(this.service.data().mode === 'maintenance', 'RESOURCE_BUSY')
        requireCondition(
          this.conflicts().every((blocker) => blocker.resourceId === id),
          'RESOURCE_BUSY'
        )
        this.save({ ...this.get(id), status: 'running' }, 'active')
      }, id)
      await this.service.options.fault?.('backup-active')
      await mkdir(staging, { recursive: true, mode: 0o700 })
      const snapshotAt = this.service.timestamp()
      const database = join(staging, 'service.sqlite')
      await backup(db.sql, database)
      await syncFile(database)
      const files = [
        'service.sqlite',
        'identity/key.pem',
        'identity/certificate.pem',
        'identity/server-id',
        'identity/idempotency.key'
      ]
      for (const name of ['license.json', 'service-runtime.json']) {
        const present = await stat(join(this.service.options.root, name)).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false
            throw error
          }
        )
        if (present) files.push(name)
      }
      for (const kind of ['exams', 'submissions'] as const) {
        for (const archive of db.all<{ archive_id: string }>(
          `SELECT archive_id FROM ${kind} WHERE deleted_at IS NULL`
        )) {
          files.push(
            `archives/${kind}/${archive.archive_id}.${kind === 'exams' ? 'lsexam' : 'lssubmission'}`
          )
        }
      }
      // Test receipts are persisted too; include their immutable data in the snapshot.
      for (const archive of db.all<{ archive_id: string }>(
        'SELECT archive_id FROM test_submissions'
      ))
        files.push(`test-data/${archive.archive_id}.lssubmission`)
      const manifest: BackupManifest = {
        format: 'ls101-service-backup',
        schemaVersion: 1,
        releaseVersion: this.service.options.releaseVersion,
        serverId: this.service.identity.serverId,
        snapshotAt,
        files: []
      }
      for (const relative of files) {
        const destination = join(staging, relative)
        if (relative !== 'service.sqlite') {
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
          await copyFile(join(this.service.options.root, relative), destination)
          await chmod(destination, 0o600)
          await syncFile(destination)
          await syncDirectory(dirname(destination))
        }
        manifest.files.push({
          path: relative,
          sha256: await digestFile(destination),
          bytes: (await stat(destination)).size
        })
      }
      await durableWrite(join(staging, 'manifest.json'), JSON.stringify(manifest))
      await syncDirectory(staging)
      await this.service.options.fault?.('backup-staging-durable')
      db.transaction(() => this.save({ ...this.get(id), snapshotAt }, 'released'), id)
      db.gate.release(id)
      ownsGate = false
      await this.service.options.fault?.('backup-encrypting')
      await runArchiveEngine(
        this.engine,
        ['a', '-t7z', '-mhe=on', '-p', temporary, `${staging}/*`],
        password
      )
      await runArchiveEngine(this.engine, ['t', temporary], password)
      await syncFile(temporary)
      await rename(temporary, target)
      await syncDirectory(dirname(target))
      await this.service.options.fault?.('backup-file-published')
      const size = (await stat(target)).size,
        digest = await digestFile(target)
      db.transaction(() => {
        this.save(
          { ...this.get(id), status: 'ready', archiveBytes: size, archiveSha256: digest },
          'released'
        )
        this.queueCleanup(id, false)
      })
      await this.service.options.fault?.('backup-ready')
    } catch {
      const value = this.get(id)
      if (value.status !== 'ready')
        db.transaction(
          () => {
            this.save(
              {
                ...value,
                status: 'failed',
                error: {
                  code: 'BACKUP_FAILED',
                  message: 'Backup could not be completed.',
                  occurredAt: this.service.timestamp()
                }
              },
              'released'
            )
            this.queueCleanup(id, true)
          },
          ownsGate ? id : undefined
        )
      if (ownsGate) {
        db.gate.release(id)
        ownsGate = false
      }
    } finally {
      if (!ownsGate) {
        await this.service.archives.collectGarbage()
      }
    }
  }

  async recover(): Promise<void> {
    const unfinished = this.service.db.all<BackupRow>(
      'SELECT * FROM backups WHERE state IN (?,?)',
      'pending',
      'running'
    )
    this.service.db.transaction(() => {
      for (const row of unfinished) {
        this.save(
          {
            ...JSON.parse(row.data),
            status: 'failed',
            error: {
              code: 'BACKUP_INTERRUPTED',
              message: 'Service stopped before backup completed.',
              occurredAt: this.service.timestamp()
            }
          },
          'released'
        )
        this.queueCleanup(row.id, true)
      }
    })
    for (const row of this.service.db.all<BackupRow>(
      'SELECT * FROM backups WHERE state=?',
      'ready'
    )) {
      const value = JSON.parse(row.data) as Schema<'Backup'>
      await verifiedFile(
        join(this.service.options.root, 'backups', `${row.id}.7z`),
        value.archiveBytes!,
        value.archiveSha256!
      )
    }
  }
}

async function syncFile(filename: string): Promise<void> {
  const handle = await open(filename, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export function registerBackupHandlers(service: LabService, store: BackupStore): void {
  service.handlers.postTeacherBackups = (context) => store.create(context)
  service.handlers.getTeacherBackups = (context) => ({
    status: 200,
    body: service.page(
      context,
      service.db
        .all<{ id: string }>('SELECT id FROM backups ORDER BY rowid DESC')
        .map((row) => store.get(row.id)),
      (row) => row.id
    )
  })
  service.handlers.getTeacherBackupsId = (context) => ({
    status: 200,
    body: store.get(context.path.id)
  })
  service.handlers.getTeacherBackupsIdArchive = async (context) => {
    const value = store.get(context.path.id)
    requireCondition(value.status === 'ready', 'RESOURCE_BUSY')
    const file = join(service.options.root, 'backups', `${value.id}.7z`)
    await verifiedFile(file, value.archiveBytes!, value.archiveSha256!)
    return {
      status: 200,
      file,
      digest: value.archiveSha256!,
      filename: `${value.id}.7z`,
      contentType: 'application/x-7z-compressed'
    }
  }
}
