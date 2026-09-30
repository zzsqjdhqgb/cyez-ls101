/*
 * Practice admission for the lab protocol driver (docs/lab-vm-acceptance-design.md, N8).
 *
 * A practice start is admitted only in normal mode: `LabService.putStudentPracticesSubmissionId`
 * authorises with `normal = true`, so in maintenance the service answers 409 SERVICE_MAINTENANCE
 * before it looks at the exam, the archive or the candidate. A formal submission is refused the same
 * way, and also before the archive body is read, which is why `--submit` in maintenance observes an
 * admission rule rather than an archive verdict.
 *
 * The service has no answer-numbering counter, and `PracticeGrant` has no numbering field. The only
 * identity a practice has is the `submissionId` the client puts in the path — the same id the later
 * submission must carry and the receipt repeats. "Continuing the original numbering" is therefore a
 * statement about that id: a second start that reuses it returns the original grant untouched
 * (200 with the same `grantedAt`), while a fresh id creates a new grant. `numbering` in the report
 * says exactly that, including `field` and `serverCounter: false`, instead of inventing a field.
 *
 * The device state file is the same one `enroll-register --state-out` writes; this command reads the
 * credential from it and writes back only a `practice` record (0600, like the state itself), plus
 * nothing else. `--grant-out` writes the grant the service returned, which is the only durable proof
 * that a specific submissionId was admitted.
 *
 * practice
 *   --url --fingerprint --version --state <file> --exam-id <uuid> --archive-sha256 <digest>
 *   [--candidate-name <n>] [--candidate-number <n>] [--expect-rejected] [--grant-out <file>]
 *   [--continuation]
 *     Starts one practice for the device in <file>. `--candidate-number` is the candidate id
 *     (`Candidate.candidateId`, the 考生号) and `--candidate-name` is `displayName`. A refusal is
 *     reported, never thrown: { action: 'start', status, code, message, submissionId, examId,
 *     archiveSha256, numbering, grantOut, mode, modeRevision, expectRejected, exam }.
 *     `--continuation` reuses the submissionId, candidate and exam digest recorded by an earlier
 *     start of the same exam (a different body would be refused as CONTENT_CONFLICT, which is not a
 *     continuation) and reports whether the service returned the original grant.
 *     `--expect-rejected` only labels the observation; the driver does not act on it, because the
 *     phase script owns the judgement.
 *
 * practice … --submit
 *   Same connection arguments; --exam-id and --archive-sha256 are not needed.
 *     Uploads one minimal but structurally valid submission archive through the same
 *     `putStudentSubmissionsSubmissionId` path N7 uses. With a recorded practice the archive carries
 *     that practice's submissionId, exam package id and candidate, so it is a real submission; without
 *     one (the state has never seen a successful start) it carries a fresh id and a placeholder
 *     package id, and the report says `practiceRecorded: false` — a maintenance refusal is decided
 *     before the archive is read, so that case is still observed, but nothing else is claimed for it.
 *     Reports { action: 'submit', status, code, message, submissionId, archive, receipt,
 *     practiceRecorded, mode, modeRevision }.
 */
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubmissionPackage } from '../../../../packages/core-types/src'
import { encodeSubmissionPackage } from '../../../../packages/exam-package/src'
import {
  errorOf,
  fail,
  flag,
  isRecord,
  openSession,
  option,
  readState,
  required,
  targetFrom,
  writeState,
  type CommandHandler,
  type Session
} from '../context'

const DEFAULT_CANDIDATE_ID = '0001'
const DEFAULT_CANDIDATE_NAME = 'Protocol driver'
// Only ever used when the state has no recorded practice, so a maintenance refusal can be observed
// without one; a real submission requires the exam package id the grant was made for.
const PLACEHOLDER_PACKAGE_ID = 'ls101-driver-unknown'
const PLACEHOLDER_TITLE = 'Protocol driver submission'

interface Candidate {
  candidateId: string
  displayName: string
}

export interface PracticeRecord {
  submissionId: string
  examId: string
  archiveSha256: string
  candidate: Candidate
  startedAt: string
  grantedAt: string | null
  startBefore: string | null
  modeRevision: number | null
  packageId: string | null
  examTitle: string | null
}

export interface DeviceState {
  // The student bearer token, used to open the session. Never reported.
  token: string
  // The Authorization header value the raw requests below the client need.
  authorization: string
  practice: PracticeRecord | undefined
}

function candidateOf(value: unknown): Candidate | undefined {
  if (!isRecord(value)) return undefined
  const { candidateId, displayName } = value
  if (typeof candidateId !== 'string' || !candidateId) return undefined
  if (typeof displayName !== 'string' || !displayName) return undefined
  return { candidateId, displayName }
}

function practiceRecordOf(state: Record<string, unknown>): PracticeRecord | undefined {
  const record = state.practice
  if (!isRecord(record)) return undefined
  const { submissionId, examId, archiveSha256, startedAt } = record
  const candidate = candidateOf(record.candidate)
  if (typeof submissionId !== 'string' || !submissionId) return undefined
  if (typeof examId !== 'string' || !examId) return undefined
  if (typeof archiveSha256 !== 'string' || !archiveSha256) return undefined
  if (!candidate) return undefined
  const { grantedAt, startBefore, modeRevision, packageId, examTitle } = record
  return {
    submissionId,
    examId,
    archiveSha256,
    candidate,
    startedAt: typeof startedAt === 'string' ? startedAt : new Date().toISOString(),
    grantedAt: typeof grantedAt === 'string' ? grantedAt : null,
    startBefore: typeof startBefore === 'string' ? startBefore : null,
    modeRevision: typeof modeRevision === 'number' ? modeRevision : null,
    packageId: typeof packageId === 'string' && packageId ? packageId : null,
    examTitle: typeof examTitle === 'string' && examTitle ? examTitle : null
  }
}

// The device credential is written under several names by the enrollment commands; the state also
// carries `authorization` already assembled. The token itself is never printed, logged or put into an
// error message — only used to open the session.
function deviceToken(state: Record<string, unknown>): string {
  const bearer = state.bearerToken ?? state.token
  if (typeof bearer === 'string' && bearer) return bearer
  const authorization = state.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer '))
    return authorization.slice('Bearer '.length)
  const { deviceId, deviceSecret } = state
  if (typeof deviceId === 'string' && deviceId && typeof deviceSecret === 'string' && deviceSecret)
    return `d.${deviceId}.${deviceSecret}`
  fail('the state file has no device credential; run enroll-register first')
}

// A device token belongs to one service identity. Using it against another URL would be reported as a
// credential failure, which hides the actual mistake, so the mismatch is named here instead.
function assertSameService(state: Record<string, unknown>, args: string[]): void {
  const target = targetFrom(args)
  const url = state.url
  if (typeof url === 'string') {
    let same = false
    try {
      same = new URL(url).origin === new URL(target.baseUrl).origin
    } catch {
      same = false
    }
    if (!same) fail('the state file was registered against a different service URL')
  }
  const fingerprint = state.fingerprint
  if (typeof fingerprint === 'string' && fingerprint !== target.fingerprint)
    fail('the state file was registered against a different service fingerprint')
}

// `concurrency` needs the same credential and the same recorded practice, so the reading and the
// service-identity check live here once rather than being copied into each command that needs them.
export function deviceStateFrom(state: Record<string, unknown>, args: string[]): DeviceState {
  assertSameService(state, args)
  const token = deviceToken(state)
  const authorization =
    typeof state.authorization === 'string' && state.authorization.startsWith('Bearer ')
      ? state.authorization
      : `Bearer ${token}`
  return { token, authorization, practice: practiceRecordOf(state) }
}

function detailsOf(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined
  return isRecord(body.error.details) ? body.error.details : undefined
}

function candidateFor(args: string[], recorded: PracticeRecord | undefined): Candidate {
  return {
    candidateId:
      option(args, '--candidate-number') ?? recorded?.candidate.candidateId ?? DEFAULT_CANDIDATE_ID,
    displayName:
      option(args, '--candidate-name') ?? recorded?.candidate.displayName ?? DEFAULT_CANDIDATE_NAME
  }
}

// The exam package id is not in the grant, and the submission archive must carry it. It is a student
// read, so it is only readable while the service is in normal mode; a start that succeeded records it
// for the later maintenance case, where the same read would be refused.
async function findExam(
  session: Session,
  examId: string
): Promise<{ packageId: string; title: string } | undefined> {
  const listed = await session.transport.request(session.connectionId, 'getStudentExams', {
    query: { limit: 200 }
  })
  if (listed.status !== 200 || !isRecord(listed.body) || !Array.isArray(listed.body.items))
    return undefined
  const exam = listed.body.items.filter(isRecord).find((item) => item.examId === examId)
  if (!exam) return undefined
  const { packageId, title } = exam
  if (typeof packageId !== 'string' || !packageId || typeof title !== 'string' || !title)
    return undefined
  return { packageId, title }
}

// One shape for accepted and refused answers: the codes and the mode live in different places
// depending on which one happened, and the phase script should not have to know that.
function observationOf(result: { status: number; body?: unknown }): {
  status: number
  code: string | null
  message: string | null
  mode: string | null
  modeRevision: number | null
} {
  const error = errorOf(result)
  const body = isRecord(result.body) ? result.body : undefined
  const details = detailsOf(result.body)
  const mode = details?.mode
  const revision = body?.modeRevision ?? details?.modeRevision
  return {
    status: result.status,
    code: error.code ?? null,
    message: error.message ?? null,
    mode: typeof mode === 'string' ? mode : null,
    modeRevision: typeof revision === 'number' ? revision : null
  }
}

async function startPractice(
  args: string[],
  session: Session,
  state: Record<string, unknown>,
  stateFile: string,
  previous: PracticeRecord | undefined
): Promise<unknown> {
  const examId = required(args, '--exam-id')
  const continuation = flag(args, '--continuation')
  if (continuation && !previous)
    fail('--continuation needs a recorded practice: run a start in normal mode first')
  const recorded = continuation ? previous : undefined
  if (recorded && recorded.examId !== examId)
    fail('--continuation must name the exam of the recorded practice')
  // A continuation has to repeat the recorded request byte for byte: the service digests the body and
  // refuses a different one with CONTENT_CONFLICT, which would not be the original grant.
  const archiveSha256 = recorded ? recorded.archiveSha256 : required(args, '--archive-sha256')
  const candidate = candidateFor(args, recorded)
  const submissionId = recorded ? recorded.submissionId : randomUUID()
  const result = await session.transport.request(
    session.connectionId,
    'putStudentPracticesSubmissionId',
    { path: { submissionId }, body: { examId, archiveSha256, candidate } }
  )
  const observed = observationOf(result)
  const body = isRecord(result.body) ? result.body : undefined
  const grantedAt = typeof body?.grantedAt === 'string' ? body.grantedAt : null
  const startBefore = typeof body?.startBefore === 'string' ? body.startBefore : null
  const modeRevision = typeof body?.modeRevision === 'number' ? body.modeRevision : null
  const accepted = result.status < 400
  const sameGrant = Boolean(recorded && grantedAt && recorded.grantedAt === grantedAt)
  const grantOut = option(args, '--grant-out')

  let exam: { packageId: string; title: string } | undefined
  if (accepted) {
    // A start for the same exam keeps the recorded package id; a start for another exam must resolve
    // its own, because the submission archive has to name the package the grant was made for.
    const sameExam = previous && previous.examId === examId ? previous : undefined
    if (!sameExam?.packageId) exam = await findExam(session, examId)
    await writeState(stateFile, {
      ...state,
      practice: {
        submissionId,
        examId,
        archiveSha256,
        candidate,
        startedAt: sameExam?.startedAt ?? new Date().toISOString(),
        grantedAt,
        startBefore,
        modeRevision,
        packageId: exam?.packageId ?? sameExam?.packageId ?? null,
        examTitle: exam?.title ?? sameExam?.examTitle ?? null
      } satisfies PracticeRecord
    })
    if (grantOut)
      await writeFile(
        grantOut,
        `${JSON.stringify({ submissionId, examId, archiveSha256, candidate, grantedAt, startBefore, modeRevision }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 }
      )
  }

  return {
    action: 'start',
    ...observed,
    submissionId,
    examId,
    archiveSha256,
    archiveSha256Source: recorded ? 'state' : 'argument',
    candidate,
    continuation,
    expectRejected: flag(args, '--expect-rejected'),
    numbering: accepted
      ? {
          field: 'submissionId',
          serverCounter: false,
          reused: Boolean(recorded),
          sameGrant,
          submissionId,
          grantedAt,
          startBefore,
          modeRevision,
          note: 'the service has no numbering counter: a practice is identified by the client-supplied submissionId in the path, and repeating it returns the original grant with the same grantedAt'
        }
      : null,
    exam: exam ?? null,
    grantOut: accepted && grantOut ? grantOut : null
  }
}

// The same minimal but structurally valid archive is what `concurrency --kind uploads` sends, so the
// two commands cannot drift into building different submissions for the same grant.
export function submissionPackage(
  submissionId: string,
  packageId: string,
  title: string,
  candidate: Candidate,
  startedAt: string
): SubmissionPackage {
  return {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId,
      examPackageId: packageId,
      examTitle: title,
      candidate,
      startedAt,
      submittedAt: new Date().toISOString()
    },
    answers: { strings: [], audios: [] },
    schemaUses: [],
    resources: {}
  }
}

async function submitArchive(
  args: string[],
  session: Session,
  previous: PracticeRecord | undefined
): Promise<unknown> {
  const submissionId = previous?.submissionId ?? randomUUID()
  const packageId = previous?.packageId ?? PLACEHOLDER_PACKAGE_ID
  const title = previous?.examTitle ?? PLACEHOLDER_TITLE
  const candidate = candidateFor(args, previous)
  const startedAt = previous?.startedAt ?? new Date().toISOString()
  const bytes = await encodeSubmissionPackage(
    submissionPackage(submissionId, packageId, title, candidate, startedAt),
    {}
  )
  const file = join(session.directory, 'practice-submission.lssubmission')
  await writeFile(file, bytes, { mode: 0o600 })
  const archive = await session.transport.registerArchive(session.connectionId, file)
  const result = await session.transport.request(
    session.connectionId,
    'putStudentSubmissionsSubmissionId',
    { path: { submissionId }, archive }
  )
  const observed = observationOf(result)
  const body = isRecord(result.body) ? result.body : undefined
  const receipt = isRecord(body?.receipt) ? body.receipt : undefined
  return {
    action: 'submit',
    ...observed,
    submissionId,
    examId: previous?.examId ?? option(args, '--exam-id') ?? null,
    practiceRecorded: Boolean(previous),
    archive: { file, bytes: archive.bytes, sha256: archive.sha256, packageId, examTitle: title },
    receipt: receipt
      ? {
          receiptId: typeof receipt.receiptId === 'string' ? receipt.receiptId : null,
          receivedAt: typeof receipt.receivedAt === 'string' ? receipt.receivedAt : null
        }
      : null,
    numbering: null,
    grantOut: null
  }
}

export const practice: CommandHandler = async (args) => {
  const stateFile = required(args, '--state')
  const state = await readState(stateFile)
  const { token, practice: previous } = deviceStateFrom(state, args)
  const session = await openSession(args, 'student', token)
  try {
    return flag(args, '--submit')
      ? await submitArchive(args, session, previous)
      : await startPractice(args, session, state, stateFile, previous)
  } finally {
    await session.close()
  }
}
