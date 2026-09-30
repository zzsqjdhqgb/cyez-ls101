/*
 * N7 submission lifecycle commands (docs/lab-vm-acceptance-design.md, M2): start grant, task lease,
 * upload, receipt, teacher download and delete.
 *
 * The chain these commands have to make reachable from a phase script that never imports TypeScript
 * is: claim → upload → receipt → upload the *same bytes* again → original receipt → download → delete
 * → the receipt survives the deletion. Two properties decide whether that is actually testable, and
 * both are handled here rather than in the VM script:
 *
 * 1. `fflate` stamps the current DOS time into every zip entry, so re-encoding the same submission
 *    package produces *different* bytes. A rebuilt archive would be rejected with CONTENT_CONFLICT
 *    and the idempotency case would never run. `submission-upload` therefore keeps the archive it
 *    built (default name keyed by submissionId) and uploads that file unchanged on the next run.
 * 2. Rejections the case expects are observations. Every command reports the HTTP status and the
 *    error envelope from the service instead of throwing; only an unreadable file, an unreachable
 *    service or a broken contract shape is a driver failure.
 *
 * The receipt query is reported exactly as the service answers it: after a deletion the original
 * receipt still comes back with `status: deleted`, and a submission that never existed answers 404,
 * which is data for the case rather than an error.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  collectSubmissionPackageFiles,
  decodeExamPackage,
  decodeSubmissionPackage,
  encodeSubmissionPackage
} from '@ls101/exam-package'
import type { ExamPackage, SubmissionPackage } from '@ls101/core-types'
import type { Schema } from '@ls101/lab-contracts'
import {
  errorOf,
  fail,
  isRecord,
  openTeacher,
  option,
  readState,
  required,
  sha256Hex,
  writeState,
  type CommandHandler,
  type Session
} from '../context'
import {
  byteOption,
  fileExists,
  hashFile,
  studentSession,
  transportError,
  type CommandOutcome
} from './exam'

// Small, but a real recording: the VM scales it up with `--recording-bytes` so the archive upload is
// genuinely large without putting a large fixture in the repository.
export const DEFAULT_RECORDING_BYTES = 512

export interface TaskClaimReport extends CommandOutcome {
  connectionId: string | null
  submissionId: string | null
  examId: string
  packageId: string | null
  candidate: Schema<'Candidate'>
  startedAt: string
  grantedAt: string | null
  startBefore: string | null
  modeRevision: number | null
  grantState: 'granted' | 'rejected'
  examDigestMatch: boolean
  out: string | null
}

export interface TaskLeaseReport extends CommandOutcome {
  connectionId: string | null
  taskId: string
  action: 'claim' | 'renew'
  leaseState: 'granted' | 'rejected'
  lease: Schema<'TaskLease'> | null
  leaseFile: string | null
}

export interface SubmissionUploadReport extends CommandOutcome {
  connectionId: string | null
  submissionId: string
  examId: string
  packageId: string | null
  candidate: Schema<'Candidate'>
  archiveFile: string
  archiveBytes: number
  archiveSha256: string
  transportSha256: string | null
  digestsMatch: boolean
  reused: boolean
  examSource: 'file' | 'service' | null
  submittedAt: string | null
  uploadReceiptState: 'received' | 'deleted' | null
  uploadReceipt: Schema<'Receipt'> | null
  receiptState: 'received' | 'deleted' | 'not-received' | 'receiving' | null
  receipt: Schema<'Receipt'> | null
  deletedAt: string | null
  out: string
}

export interface SubmissionReceiptReport extends CommandOutcome {
  connectionId: string | null
  submissionId: string
  receiptState: 'received' | 'deleted' | 'not-received' | 'receiving' | null
  receipt: Schema<'Receipt'> | null
  deletedAt: string | null
  retryAfterSeconds: number | null
}

export interface SubmissionDownloadReport extends CommandOutcome {
  connectionId: string | null
  submissionId: string
  out: string | null
  bytes: number
  sha256: string | null
  transportSha256: string | null
  digestsMatch: boolean
  decoded: {
    submissionId: string
    packageId: string
    candidate: Schema<'Candidate'>
    submittedAt: string
  } | null
  decodeError: string | null
}

export interface SubmissionDeleteReport extends CommandOutcome {
  connectionId: string | null
  submissionId: string
  deleted: boolean
}

export interface BuildSubmissionArchiveOptions {
  file: string
  exam: ExamPackage
  examResources?: Readonly<Record<string, Uint8Array>>
  submissionId: string
  candidate: Schema<'Candidate'>
  startedAt: string
  submittedAt?: string
  recordingBytes?: number
}

export interface BuildSubmissionArchiveResult {
  file: string
  bytes: number
  sha256: string
  submission: SubmissionPackage
  recordingBytes: number
}

// Builds the submission a candidate would have produced: the exam's own submission template, one
// recording per capture the exam plans, and the candidate the start grant was issued for.
export async function buildSubmissionArchive(
  options: BuildSubmissionArchiveOptions
): Promise<BuildSubmissionArchiveResult> {
  const recordingBytes = options.recordingBytes ?? DEFAULT_RECORDING_BYTES
  const recordings: Record<string, Uint8Array> = {}
  const manifest: SubmissionPackage['resources'] = {}
  const audios: SubmissionPackage['answers']['audios'] = []
  options.exam.answerCapturePlan.audios.forEach((capture, index) => {
    const key = `recording${index}`
    const filename = `answer-${capture.recordIndex}.wav`
    recordings[key] = randomBytes(recordingBytes)
    manifest[key] = { filename, packagePath: `recordings/${filename}`, mediaType: 'audio/wav' }
    audios.push({ resourceKey: key, durationMs: Math.max(1, Math.round(recordingBytes / 32)) })
  })
  const submission: SubmissionPackage = {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId: options.submissionId,
      examPackageId: options.exam.packageId,
      examTitle: options.exam.examData.title,
      candidate: options.candidate,
      startedAt: options.startedAt,
      submittedAt: options.submittedAt ?? afterStart(options.startedAt)
    },
    answers: { strings: options.exam.answerCapturePlan.strings.map(() => null), audios },
    schemaUses: options.exam.submissionTemplate.schemaUses,
    resources: manifest
  }
  const files = collectSubmissionPackageFiles(submission, options.examResources ?? {}, recordings)
  const archive = await encodeSubmissionPackage(submission, files)
  await mkdir(dirname(options.file), { recursive: true })
  await writeFile(options.file, archive)
  return {
    file: options.file,
    bytes: archive.byteLength,
    sha256: sha256Hex(archive),
    submission,
    recordingBytes
  }
}

// A case may have advanced the injected clock past the client's wall clock, so the submission time is
// taken as one second after the start whenever "now" is not already later than that.
function afterStart(startedAt: string): string {
  const parsed = Date.parse(startedAt)
  const floor = Number.isFinite(parsed) ? parsed + 1000 : 0
  return new Date(Math.max(Date.now(), floor)).toISOString()
}

function receiptView(body: Schema<'ReceiptQuery'>): {
  receiptState: 'received' | 'deleted' | 'not-received' | 'receiving'
  receipt: Schema<'Receipt'> | null
  deletedAt: string | null
  retryAfterSeconds: number | null
} {
  if (body.status === 'received')
    return {
      receiptState: 'received',
      receipt: body.receipt,
      deletedAt: null,
      retryAfterSeconds: null
    }
  if (body.status === 'deleted')
    return {
      receiptState: 'deleted',
      receipt: body.receipt,
      deletedAt: body.deletedAt,
      retryAfterSeconds: null
    }
  return {
    receiptState: body.status,
    receipt: null,
    deletedAt: null,
    retryAfterSeconds: body.status === 'receiving' ? body.retryAfterSeconds : null
  }
}

async function readOptionalState(file: string): Promise<Record<string, unknown> | undefined> {
  return (await fileExists(file)) ? await readState(file) : undefined
}

// The grant file is the only thing that carries the candidate and the submissionId from the claiming
// process to the uploading one, so a malformed one is a driver-level failure: a wrong archive would
// otherwise be attributed to the service.
async function readGrant(file: string): Promise<{
  submissionId: string
  examId: string
  packageId: string | null
  candidate: Schema<'Candidate'>
  startedAt: string
}> {
  const value = await readState(file)
  const candidate = value.candidate
  if (
    typeof value.submissionId !== 'string' ||
    typeof value.examId !== 'string' ||
    typeof value.startedAt !== 'string' ||
    !isRecord(candidate) ||
    typeof candidate.candidateId !== 'string' ||
    typeof candidate.displayName !== 'string'
  )
    fail(`${file} is not a practice grant written by task-claim`)
  return {
    submissionId: value.submissionId,
    examId: value.examId,
    packageId: typeof value.packageId === 'string' ? value.packageId : null,
    candidate: { candidateId: candidate.candidateId, displayName: candidate.displayName },
    startedAt: value.startedAt
  }
}

// Without a file the submission is built from the archive the service serves, which is the student
// product's own path. `--exam-file` lets the VM reuse the download `exam-fetch` already made instead
// of transferring a large exam a second time; it changes where the bytes come from, not what is
// uploaded.
async function readPublishedExam(
  session: Session,
  examId: string,
  examFile: string | undefined
): Promise<
  | {
      ok: true
      exam: ExamPackage
      resources: Record<string, Uint8Array>
      source: 'file' | 'service'
    }
  | { ok: false; outcome: CommandOutcome }
> {
  if (examFile) {
    const decoded = await decodeExamPackage(await readFile(examFile))
    return { ok: true, exam: decoded.exam, resources: decoded.resources, source: 'file' }
  }
  const response = await session.transport.request(
    session.connectionId,
    'getStudentExamsExamIdArchive',
    { path: { examId } }
  )
  if (response.status >= 400 || !response.archive) return { ok: false, outcome: errorOf(response) }
  const bytes = await readFile(
    session.transport.file(response.archive.handle, session.connectionId)
  )
  const decoded = await decodeExamPackage(bytes)
  return { ok: true, exam: decoded.exam, resources: decoded.resources, source: 'service' }
}

/*
 * The submission PUT streams the archive, so a connection that dies mid-transfer is observed here
 * rather than as an HTTP status. It is reported like a rejection (`status: 0` plus the socket error)
 * because the case has to record it; see the defect note in the spec.
 */
async function putSubmission(
  session: Session,
  submissionId: string,
  archive: { handle: string; sha256: string; bytes: number }
): Promise<
  | { ok: true; status: number; body: Schema<'CompletedReceipt'> }
  | { ok: false; outcome: CommandOutcome }
> {
  try {
    const response = await session.transport.request(
      session.connectionId,
      'putStudentSubmissionsSubmissionId',
      { path: { submissionId }, archive }
    )
    if (response.status >= 400) return { ok: false, outcome: errorOf(response) }
    return { ok: true, status: response.status, body: response.body as Schema<'CompletedReceipt'> }
  } catch (error) {
    const outcome = transportError(error)
    if (!outcome) throw error
    return { ok: false, outcome }
  }
}

export const taskClaim: CommandHandler = async (args) => {
  const examId = required(args, '--exam-id')
  const archiveSha256 = required(args, '--archive-sha256')
  const out = option(args, '--out')
  const candidate: Schema<'Candidate'> = {
    candidateId: option(args, '--candidate-number') ?? '0001',
    displayName: option(args, '--candidate-name') ?? '验收考生'
  }
  // Re-claiming through the same state file reuses the submissionId: the service treats a repeated
  // PUT for one id as the same grant, and a new random id every run would make the re-upload case
  // impossible to reach.
  const previous = out ? await readOptionalState(out) : undefined
  const submissionId =
    typeof previous?.submissionId === 'string' ? previous.submissionId : randomUUID()
  const session = await studentSession(args)
  try {
    // The exam list is what a student has locally, so the listed digest and packageId are reported
    // next to the grant: a phase that passes the wrong `--archive-sha256` can then see the claim
    // rejected with CONTENT_CONFLICT and the reason in the same log line.
    const listing = await session.transport.request(session.connectionId, 'getStudentExams', {})
    const exam =
      listing.status >= 400
        ? null
        : ((listing.body as { items: Schema<'Exam'>[] }).items.find(
            (item) => item.examId === examId
          ) ?? null)
    const packageId = exam?.packageId ?? null
    const examDigestMatch = exam ? exam.archiveSha256 === archiveSha256 : false
    const startedAt = new Date().toISOString()
    const claim = await session.transport.request(
      session.connectionId,
      'putStudentPracticesSubmissionId',
      { path: { submissionId }, body: { examId, archiveSha256, candidate } }
    )
    if (claim.status >= 400)
      return {
        ...errorOf(claim),
        connectionId: session.connectionId,
        submissionId,
        examId,
        packageId,
        candidate,
        startedAt,
        grantedAt: null,
        startBefore: null,
        modeRevision: null,
        grantState: 'rejected',
        examDigestMatch,
        out: null
      } satisfies TaskClaimReport
    const grant = claim.body as Schema<'PracticeGrant'>
    if (out)
      await writeState(out, {
        submissionId,
        examId,
        packageId,
        archiveSha256,
        candidate,
        startedAt,
        grantedAt: grant.grantedAt,
        startBefore: grant.startBefore,
        modeRevision: grant.modeRevision
      })
    return {
      status: claim.status,
      code: null,
      message: null,
      connectionId: session.connectionId,
      submissionId,
      examId,
      packageId,
      candidate,
      startedAt,
      grantedAt: grant.grantedAt,
      startBefore: grant.startBefore,
      modeRevision: grant.modeRevision,
      grantState: 'granted',
      examDigestMatch,
      out: out ?? null
    } satisfies TaskClaimReport
  } finally {
    await session.close()
  }
}

export const taskLease: CommandHandler = async (args) => {
  const taskId = required(args, '--task-id')
  const state = await readState(required(args, '--state'))
  const runtimeId =
    option(args, '--runtime-id') ??
    (typeof state.runtimeId === 'string' ? state.runtimeId : undefined)
  if (!runtimeId)
    fail('--runtime-id is required when the device state does not carry a heartbeat runtimeId')
  const leaseFile = option(args, '--lease-file')
  const previous = leaseFile ? await readOptionalState(leaseFile) : undefined
  const leaseId = typeof previous?.leaseId === 'string' ? previous.leaseId : undefined
  const action: TaskLeaseReport['action'] = leaseId ? 'renew' : 'claim'
  const session = await studentSession(args)
  try {
    const response =
      // The task routes name the path parameter `id`; `taskId` only appears on the test-submission
      // routes, which are a different operation family.
      leaseId === undefined
        ? await session.transport.request(session.connectionId, 'postStudentTasksIdClaim', {
            path: { id: taskId },
            body: { runtimeId }
          })
        : await session.transport.request(session.connectionId, 'putStudentTasksIdLease', {
            path: { id: taskId },
            body: { runtimeId, leaseId }
          })
    if (response.status >= 400)
      return {
        ...errorOf(response),
        connectionId: session.connectionId,
        taskId,
        action,
        leaseState: 'rejected',
        lease: null,
        leaseFile: leaseFile ?? null
      } satisfies TaskLeaseReport
    const lease = response.body as Schema<'TaskLease'>
    // The lease file is what lets a later process renew the same lease instead of claiming a second
    // one, which the service refuses for a device that already holds an active lease.
    if (leaseFile)
      await writeState(leaseFile, {
        taskId,
        leaseId: lease.leaseId,
        runtimeId,
        leaseExpiresAt: lease.leaseExpiresAt,
        serverTime: lease.serverTime
      })
    return {
      status: response.status,
      code: null,
      message: null,
      connectionId: session.connectionId,
      taskId,
      action,
      leaseState: 'granted',
      lease,
      leaseFile: leaseFile ?? null
    } satisfies TaskLeaseReport
  } finally {
    await session.close()
  }
}

export const submissionUpload: CommandHandler = async (args) => {
  const grant = await readGrant(required(args, '--grant'))
  const out = required(args, '--out')
  const recordingBytes = byteOption(args, '--recording-bytes', DEFAULT_RECORDING_BYTES)
  // An archive already on disk is uploaded unchanged: re-encoding would produce different bytes and
  // the service would answer CONTENT_CONFLICT instead of the original receipt. The default name is
  // keyed by submissionId, so an archive left over from another submission is never picked up.
  const archiveFile =
    option(args, '--submission-file') ??
    join(dirname(out), `submission-${grant.submissionId}.lssubmission`)
  const reused = await fileExists(archiveFile)
  const session = await studentSession(args)
  const base = {
    connectionId: session.connectionId,
    submissionId: grant.submissionId,
    examId: grant.examId,
    candidate: grant.candidate,
    archiveFile,
    reused,
    out
  }
  try {
    let packageId = grant.packageId
    let examSource: 'file' | 'service' | null = null
    let submittedAt: string | null = null
    let archiveBytes: number
    let archiveSha256: string
    if (reused) {
      archiveBytes = (await stat(archiveFile)).size
      archiveSha256 = await hashFile(archiveFile)
    } else {
      const lookup = await readPublishedExam(session, grant.examId, option(args, '--exam-file'))
      if (!lookup.ok)
        return {
          ...lookup.outcome,
          ...base,
          packageId,
          archiveBytes: 0,
          archiveSha256: '',
          transportSha256: null,
          digestsMatch: false,
          examSource: null,
          submittedAt: null,
          uploadReceiptState: null,
          uploadReceipt: null,
          receiptState: null,
          receipt: null,
          deletedAt: null
        } satisfies SubmissionUploadReport
      packageId = lookup.exam.packageId
      examSource = lookup.source
      const built = await buildSubmissionArchive({
        file: archiveFile,
        exam: lookup.exam,
        examResources: lookup.resources,
        submissionId: grant.submissionId,
        candidate: grant.candidate,
        startedAt: grant.startedAt,
        recordingBytes
      })
      archiveBytes = built.bytes
      archiveSha256 = built.sha256
      submittedAt = built.submission.meta.submittedAt
    }
    // The transport hashes the file itself before sending it; comparing that digest with the one the
    // driver computed makes the value in the request header checkable evidence rather than a claim.
    const handle = await session.transport.registerArchive(session.connectionId, archiveFile)
    const outcome = {
      ...base,
      packageId,
      archiveBytes,
      archiveSha256,
      transportSha256: handle.sha256,
      digestsMatch: handle.sha256 === archiveSha256,
      examSource,
      submittedAt
    }
    const put = await putSubmission(session, grant.submissionId, handle)
    if (!put.ok)
      return {
        ...put.outcome,
        ...outcome,
        uploadReceiptState: null,
        uploadReceipt: null,
        receiptState: null,
        receipt: null,
        deletedAt: null
      } satisfies SubmissionUploadReport
    const uploaded = put.body
    // The explicit receipt query is the operation the case is about: after a deletion it still
    // answers with the original receipt, and this is where a phase sees that.
    const queried = await session.transport.request(
      session.connectionId,
      'getStudentSubmissionsSubmissionIdReceipt',
      { path: { submissionId: grant.submissionId } }
    )
    const view =
      queried.status >= 400
        ? { receiptState: null, receipt: null, deletedAt: null, retryAfterSeconds: null }
        : receiptView(queried.body as Schema<'ReceiptQuery'>)
    const value = {
      status: put.status,
      code: null,
      message: null,
      ...outcome,
      uploadReceiptState: uploaded.status,
      uploadReceipt: uploaded.receipt,
      ...view
    } satisfies SubmissionUploadReport
    await writeState(out, {
      submissionId: grant.submissionId,
      examId: grant.examId,
      packageId,
      candidate: grant.candidate,
      archiveFile,
      archiveBytes,
      archiveSha256,
      submittedAt,
      uploadStatus: put.status,
      receiptState: view.receiptState,
      receipt: view.receipt,
      deletedAt: view.deletedAt
    })
    return value
  } finally {
    await session.close()
  }
}

export const submissionReceipt: CommandHandler = async (args) => {
  const submissionId = required(args, '--submission-id')
  const session = await studentSession(args)
  try {
    const response = await session.transport.request(
      session.connectionId,
      'getStudentSubmissionsSubmissionIdReceipt',
      { path: { submissionId } }
    )
    if (response.status >= 400)
      return {
        ...errorOf(response),
        connectionId: session.connectionId,
        submissionId,
        receiptState: null,
        receipt: null,
        deletedAt: null,
        retryAfterSeconds: null
      } satisfies SubmissionReceiptReport
    return {
      status: response.status,
      code: null,
      message: null,
      connectionId: session.connectionId,
      submissionId,
      ...receiptView(response.body as Schema<'ReceiptQuery'>)
    } satisfies SubmissionReceiptReport
  } finally {
    await session.close()
  }
}

export const submissionDownload: CommandHandler = async (args) => {
  const submissionId = required(args, '--submission-id')
  const out = required(args, '--out')
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  try {
    const response = await session.transport.request(
      session.connectionId,
      'getTeacherSubmissionsIdArchive',
      { path: { id: submissionId } }
    )
    if (response.status >= 400 || !response.archive)
      return {
        ...errorOf(response),
        connectionId: session.connectionId,
        submissionId,
        out: null,
        bytes: 0,
        sha256: null,
        transportSha256: null,
        digestsMatch: false,
        decoded: null,
        decodeError: null
      } satisfies SubmissionDownloadReport
    await mkdir(dirname(out), { recursive: true })
    await copyFile(session.transport.file(response.archive.handle, session.connectionId), out)
    const bytes = await readFile(out)
    const sha256 = sha256Hex(bytes)
    let decoded: SubmissionDownloadReport['decoded'] = null
    let decodeError: string | null = null
    try {
      const archive = await decodeSubmissionPackage(bytes)
      decoded = {
        submissionId: archive.submission.meta.submissionId,
        packageId: archive.submission.meta.examPackageId,
        candidate: archive.submission.meta.candidate,
        submittedAt: archive.submission.meta.submittedAt
      }
    } catch (error) {
      decodeError = (error as Error).message
    }
    return {
      status: response.status,
      code: null,
      message: null,
      connectionId: session.connectionId,
      submissionId,
      out,
      bytes: bytes.byteLength,
      sha256,
      transportSha256: response.archive.sha256,
      digestsMatch: sha256 === response.archive.sha256,
      decoded,
      decodeError
    } satisfies SubmissionDownloadReport
  } finally {
    await session.close()
  }
}

export const submissionDelete: CommandHandler = async (args) => {
  const submissionId = required(args, '--submission-id')
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  try {
    const response = await session.transport.request(
      session.connectionId,
      'deleteTeacherSubmissionsId',
      { path: { id: submissionId } }
    )
    if (response.status >= 400)
      return {
        ...errorOf(response),
        connectionId: session.connectionId,
        submissionId,
        deleted: false
      } satisfies SubmissionDeleteReport
    return {
      status: response.status,
      code: null,
      message: null,
      connectionId: session.connectionId,
      submissionId,
      deleted: true
    } satisfies SubmissionDeleteReport
  } finally {
    await session.close()
  }
}
