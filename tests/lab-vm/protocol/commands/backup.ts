/*
 * Backup creation for the lab protocol driver (docs/lab-vm-acceptance-design.md, milestone M4).
 *
 * The upgrade path has a durable precondition rather than only a mode: `prepare-upgrade` refuses unless
 * the service holds a `ready` backup whose snapshot is younger than 24 hours and whose archive is still
 * on disk (packages/lab-server/src/runtime.ts). M4 therefore cannot reach the real product upgrade
 * without a real backup, and a real backup cannot be faked from outside the service: the encryption is
 * the service's own, the index row is what `prepare-upgrade` reads, and the archive is verified against
 * the digest recorded at publication time.
 *
 * So this command does exactly what the teacher's backup button does — `postTeacherBackups` with an
 * idempotency key — and then polls `getTeacherBackupsId` until the job leaves `pending`/`running`. The
 * archive password arrives through a file like every other secret and is never printed.
 *
 * The command reports observations only; `guest/lab-acceptance.mjs` decides what they mean. A backup the
 * service refuses is reported with its code rather than thrown, because the refusal shapes (wrong mode,
 * an active lease) are themselves worth seeing.
 *
 * backup
 *   --url <url> --fingerprint <sha256:…> --version <v> (--password-file <p> | --local-proof-file <p>)
 *   --backup-password-file <p> [--timeout-ms <n>] [--interval-ms <n>]
 *     Reports { status, code, message, id, backupStatus, snapshotAt, archiveBytes, archiveSha256,
 *     readable, releaseVersion, waitingMs, attempts }. `readable` mirrors the three fields
 *     `prepare-upgrade` requires, so a backup that exists but could not be used is visible as such.
 */
import { randomUUID } from 'node:crypto'
import {
  errorOf,
  fail,
  isRecord,
  numberOption,
  openTeacher,
  option,
  secret,
  type CommandHandler,
  type Session
} from '../context'

const DEFAULT_TIMEOUT_MS = 180000
const DEFAULT_INTERVAL_MS = 1000

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

interface BackupView {
  id: string | null
  backupStatus: string | null
  snapshotAt: string | null
  archiveBytes: number | null
  archiveSha256: string | null
  releaseVersion: string | null
  error: string | null
}

// Every field is read by name and validated by type: the report is evidence, so a missing field has to
// show up as `null` rather than as a crash inside the driver.
function backupView(body: unknown): BackupView {
  const value = isRecord(body) ? body : {}
  return {
    id: typeof value.id === 'string' ? value.id : null,
    backupStatus: typeof value.status === 'string' ? value.status : null,
    snapshotAt: typeof value.snapshotAt === 'string' ? value.snapshotAt : null,
    archiveBytes: typeof value.archiveBytes === 'number' ? value.archiveBytes : null,
    archiveSha256: typeof value.archiveSha256 === 'string' ? value.archiveSha256 : null,
    releaseVersion: typeof value.releaseVersion === 'string' ? value.releaseVersion : null,
    // `DiagnosticError` is a fixed shape; keeping it verbatim beats reducing it to a code the guest
    // would then have to map back.
    error: isRecord(value.error) ? JSON.stringify(value.error) : null
  }
}

async function readBackup(session: Session, id: string): Promise<BackupView> {
  const result = await session.transport.request(session.connectionId, 'getTeacherBackupsId', {
    path: { id }
  })
  return backupView(result.body)
}

export const backup: CommandHandler = async (args) => {
  const passwordFile = option(args, '--backup-password-file')
  if (!passwordFile) fail('backup requires --backup-password-file')
  const password = await secret(passwordFile)
  const timeoutMs = numberOption(args, '--timeout-ms', DEFAULT_TIMEOUT_MS)
  const intervalMs = numberOption(args, '--interval-ms', DEFAULT_INTERVAL_MS)
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  try {
    const startedAt = Date.now()
    const created = await session.transport.request(session.connectionId, 'postTeacherBackups', {
      body: { encryptionPassword: password },
      idempotencyKey: randomUUID()
    })
    const failure = errorOf(created)
    const refused = {
      status: created.status,
      code: failure.code,
      message: failure.message,
      id: null,
      backupStatus: null,
      snapshotAt: null,
      archiveBytes: null,
      archiveSha256: null,
      readable: false,
      releaseVersion: null,
      error: null,
      waitingMs: 0,
      attempts: 0
    }
    if (created.status >= 400) return refused
    const id = backupView(created.body).id
    if (!id) fail('the service accepted the backup but returned no id')

    let attempts = 0
    let observed = backupView(created.body)
    while (observed.backupStatus !== 'ready' && observed.backupStatus !== 'failed') {
      if (Date.now() - startedAt >= timeoutMs)
        fail(
          `backup ${id} stayed ${observed.backupStatus ?? 'unreported'} for ${timeoutMs} ms instead of reaching ready or failed`
        )
      if (attempts > 0) await delay(intervalMs)
      attempts += 1
      observed = await readBackup(session, id)
    }
    return {
      status: created.status,
      code: null,
      message: null,
      id,
      backupStatus: observed.backupStatus,
      snapshotAt: observed.snapshotAt,
      archiveBytes: observed.archiveBytes,
      archiveSha256: observed.archiveSha256,
      // These are exactly the three values `prepare-upgrade` insists on, so a backup that exists but
      // could not be used for an upgrade is visible here instead of as an unexplained refusal later.
      readable: Boolean(observed.snapshotAt && observed.archiveSha256 && observed.archiveBytes),
      releaseVersion: observed.releaseVersion,
      error: observed.error,
      waitingMs: Date.now() - startedAt,
      attempts
    }
  } finally {
    await session.close()
  }
}
