import { DatabaseSync } from 'node:sqlite'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { WriteGate } from './write-gate'
import { LabError } from './errors'
import { directoryPaths, lockDirectory } from './directory-lock'

const SCHEMA_VERSION = 1
const SCHEMA = `
CREATE TABLE service (singleton INTEGER PRIMARY KEY CHECK(singleton=1), data TEXT NOT NULL);
CREATE TABLE security (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE teacher_sessions (hash TEXT PRIMARY KEY, revision INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE devices (id TEXT PRIMARY KEY, installation_id TEXT NOT NULL UNIQUE, number TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
CREATE TABLE device_credentials (id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), hash TEXT NOT NULL, revoked_at INTEGER);
CREATE UNIQUE INDEX active_device_credential ON device_credentials(device_id) WHERE revoked_at IS NULL;
CREATE TABLE heartbeats (credential_id TEXT PRIMARY KEY REFERENCES device_credentials(id), generation INTEGER NOT NULL, runtime_id TEXT NOT NULL, sequence INTEGER NOT NULL, accepted_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE enrollments (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, closed_at INTEGER, data TEXT NOT NULL, signed_file TEXT);
CREATE UNIQUE INDEX open_enrollment ON enrollments((1)) WHERE closed_at IS NULL;
CREATE TABLE exams (id TEXT PRIMARY KEY, package_id TEXT NOT NULL, digest TEXT NOT NULL, archive_id TEXT NOT NULL, deleted_at INTEGER, data TEXT NOT NULL);
CREATE UNIQUE INDEX active_exam_package ON exams(package_id) WHERE deleted_at IS NULL;
CREATE TABLE practice_grants (id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), credential_id TEXT NOT NULL REFERENCES device_credentials(id), exam_id TEXT NOT NULL REFERENCES exams(id), data TEXT NOT NULL);
CREATE TABLE uploads (id TEXT PRIMARY KEY, kind TEXT NOT NULL, resource_id TEXT NOT NULL, owner TEXT NOT NULL, digest TEXT NOT NULL, archive_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(kind, resource_id));
CREATE TABLE submissions (id TEXT PRIMARY KEY REFERENCES practice_grants(id), device_id TEXT NOT NULL REFERENCES devices(id), digest TEXT NOT NULL, archive_id TEXT NOT NULL, receipt_id TEXT NOT NULL UNIQUE, received_at INTEGER NOT NULL, deleted_at INTEGER, data TEXT NOT NULL);
CREATE TABLE tasks (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, device_id TEXT NOT NULL REFERENCES devices(id), credential_id TEXT NOT NULL REFERENCES device_credentials(id), state TEXT NOT NULL, expires_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE task_leases (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), device_id TEXT NOT NULL REFERENCES devices(id), runtime_id TEXT NOT NULL, expires_at INTEGER NOT NULL, ended_at INTEGER);
CREATE UNIQUE INDEX active_device_lease ON task_leases(device_id) WHERE ended_at IS NULL;
CREATE TABLE task_results (task_id TEXT NOT NULL REFERENCES tasks(id), lease_id TEXT NOT NULL REFERENCES task_leases(id), digest TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(task_id, lease_id));
CREATE TABLE test_runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE test_confirmations (run_id TEXT NOT NULL REFERENCES test_runs(id), device_id TEXT NOT NULL REFERENCES devices(id), data TEXT NOT NULL, PRIMARY KEY(run_id, device_id));
CREATE TABLE cleanup_plans (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE cleanup_selections (plan_id TEXT NOT NULL REFERENCES cleanup_plans(id), device_id TEXT NOT NULL REFERENCES devices(id), data TEXT NOT NULL, PRIMARY KEY(plan_id, device_id));
CREATE TABLE test_submissions (task_id TEXT PRIMARY KEY REFERENCES tasks(id), digest TEXT NOT NULL, archive_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE idempotency (subject TEXT NOT NULL, method TEXT NOT NULL, route TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL, expires_at INTEGER, PRIMARY KEY(subject,method,route,key));
CREATE TABLE file_gc (path TEXT PRIMARY KEY, bytes INTEGER NOT NULL, reason TEXT NOT NULL);
CREATE TABLE backups (id TEXT PRIMARY KEY, state TEXT NOT NULL, barrier_state TEXT NOT NULL, data TEXT NOT NULL);
CREATE UNIQUE INDEX active_backup ON backups((1)) WHERE state IN ('pending','running');
CREATE TABLE logs (id TEXT PRIMARY KEY, time INTEGER NOT NULL, level TEXT NOT NULL, request_id TEXT, data TEXT NOT NULL);
PRAGMA user_version=1;
`

type SQLValue = string | number | null | Uint8Array

export class LabDatabase {
  readonly gate = new WriteGate()
  private available = true
  private constructor(
    readonly root: string,
    readonly sql: DatabaseSync,
    private readonly directoryLock: DatabaseSync
  ) {}

  static async open(root: string, initialize = false): Promise<LabDatabase> {
    const directoryLock = await lockDirectory(root)
    let db: DatabaseSync | undefined
    try {
      const interruptedRestore = await stat(directoryPaths(root).journal).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
        }
      )
      if (interruptedRestore) throw new LabError('STORAGE_UNAVAILABLE')
      await mkdir(root, { recursive: true, mode: 0o700 })
      const filename = join(root, 'service.sqlite')
      const exists = await stat(filename).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
        }
      )
      if (!exists && !initialize) throw new LabError('STORAGE_UNAVAILABLE')
      db = new DatabaseSync(filename)
      db.exec(
        'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;'
      )
      const version = db.prepare('PRAGMA user_version').get()?.user_version
      if (!exists) {
        db.exec('BEGIN IMMEDIATE')
        try {
          db.exec(SCHEMA)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      } else if (version !== SCHEMA_VERSION) throw new LabError('STORAGE_UNAVAILABLE')
      return new LabDatabase(root, db, directoryLock)
    } catch (error) {
      db?.close()
      directoryLock.close()
      throw error
    }
  }

  get<Row>(query: string, ...values: SQLValue[]): Row | undefined {
    this.assertAvailable()
    return this.sql.prepare(query).get(...values) as Row | undefined
  }

  all<Row>(query: string, ...values: SQLValue[]): Row[] {
    this.assertAvailable()
    return this.sql.prepare(query).all(...values) as Row[]
  }

  run(query: string, ...values: SQLValue[]): void {
    this.assertAvailable()
    this.sql.prepare(query).run(...values)
  }

  private assertAvailable(): void {
    if (!this.available) throw new LabError('STORAGE_UNAVAILABLE')
  }

  transaction<T>(operation: () => T, owner?: string | (() => void)): T {
    this.assertAvailable()
    const release = owner ? undefined : this.gate.enter()
    if (typeof owner === 'string' && this.gate.backupId !== owner)
      throw new Error('Invalid backup transaction owner')
    if (typeof owner === 'function' && !this.gate.hasPermit(owner))
      throw new Error('Invalid write admission')
    try {
      this.sql.exec('BEGIN IMMEDIATE')
      try {
        const result = operation()
        if (result instanceof Promise)
          throw new Error('Async work cannot hold a SQLite transaction')
        try {
          this.sql.exec('COMMIT')
        } catch (error) {
          this.available = false
          throw error
        }
        return result
      } catch (error) {
        try {
          this.sql.exec('ROLLBACK')
        } catch {
          /* Commit outcome requires recovery. */
        }
        throw error
      }
    } finally {
      release?.()
    }
  }

  async close(): Promise<void> {
    this.sql.close()
    this.directoryLock.close()
  }
}
