/*
 * N7 exam publication, student listing and archive fetch (docs/lab-vm-acceptance-design.md, M2).
 *
 * These three commands are the head of the N7 chain: a real `ExamPackage` is encoded with the shipped
 * encoder, published through the product transport, listed the way a student sees it, and streamed
 * back down by a process that recomputes the digest from the bytes on disk. That last step is the
 * point of the case: the transport already verifies the digest the service declared while streaming,
 * and the driver then hashes the written file on its own so a service that served the wrong bytes
 * could not hide behind its own header.
 *
 * The archive sizes come from `--resource-bytes`, and the bytes are random rather than a fixed
 * fixture. A compressible placeholder would deflate to nothing in the zip and the "large archive"
 * case would silently stop exercising a large transfer, which is why the VM can make the archive
 * genuinely large without a huge repository file.
 *
 * `submission.ts` reuses `hashFile`, `studentSession` and `byteOption` from here: the two modules are
 * one case, and keeping the shared runtime in one of them avoids a third home for it.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { decodeExamPackage, encodeExamPackage } from '@ls101/exam-package'
import type { ExamPackage } from '@ls101/core-types'
import type { Schema } from '@ls101/lab-contracts'
import {
  errorOf,
  fail,
  flag,
  isRecord,
  openSession,
  openTeacher,
  option,
  readState,
  required,
  secret,
  sha256Hex,
  type CommandHandler,
  type Session
} from '../context'

export const DEFAULT_EXAM_TITLE = 'LS101 机房验收试卷'
const DEFAULT_RESOURCE_KEY = 'narration'

// Every command reports the HTTP status it observed plus the error envelope, so a rejection is a
// normal observation with exit code 0. `code` is null when the service answered successfully.
export interface CommandOutcome {
  status: number
  code: string | null
  message: string | null
  details?: unknown
}

export interface StudentExamSummary {
  examId: string
  packageId: string
  title: string
  archiveSha256: string
  archiveBytes: number
  pageCount: number
  resourceCount: number
  published: boolean
  revision: number
}

export interface VisibleExams {
  source: 'student-session' | 'teacher-published-projection'
  // Whether the exam just published is in the list the service returned. The phase script asserts
  // this, so the answer travels with the list rather than being re-derived from an id it may not have.
  listed: boolean
  items: StudentExamSummary[]
  nextCursor: string | null
}

export interface ExamPublishReport extends CommandOutcome {
  examId: string | null
  revision: number | null
  packageId: string
  title: string
  published: boolean
  duplicate: boolean | null
  file: string
  bytes: number
  sha256: string
  reused: boolean
  mirror: string
  patchStatus: number | null
  visible: VisibleExams | null
}

export interface ExamListReport extends CommandOutcome {
  connectionId: string | null
  items: StudentExamSummary[]
  nextCursor: string | null
}

export interface ExamFetchReport extends CommandOutcome {
  connectionId: string | null
  out: string | null
  bytes: number
  sha256: string | null
  transportSha256: string | null
  digestsMatch: boolean
  decoded: { packageId: string; title: string; resourceCount: number } | null
  decodeError: string | null
}

export interface BuildExamArchiveOptions {
  file: string
  title?: string
  packageId?: string
  resourceBytes?: number
}

export interface BuildExamArchiveResult {
  file: string
  bytes: number
  sha256: string
  packageId: string
  title: string
  resourceCount: number
  exam: ExamPackage
}

// Recomputes the digest of a file the driver itself can read. Kept separate from the transport's
// streaming hash on purpose: two independent computations is what makes the N7 digest claim mean
// something.
export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export function byteOption(args: string[], name: string, fallback: number): number {
  const raw = option(args, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a non-negative integer`)
  return value
}

/*
 * A connection that dies while an archive is still being written is not a driver mistake, and a case
 * has to be able to record it: it is reported like a rejection, with `status: 0` meaning "no HTTP
 * response" and the socket error as the code. Anything that is not a socket-level failure is still
 * thrown, because that would be a real driver failure.
 */
export function transportError(error: unknown): CommandOutcome | null {
  if (!isRecord(error) || typeof error.code !== 'string' || !error.code) return null
  return {
    status: 0,
    code: error.code,
    message: error instanceof Error ? error.message : error.code
  }
}

export async function fileExists(file: string): Promise<boolean> {
  return await access(file).then(
    () => true,
    () => false
  )
}

// The session token is never printed: it is either read from the device state the phase script
// wrote, or re-derived from the device secret when an older state file predates the token field.
export async function studentSession(args: string[]): Promise<Session> {
  const stateFile = option(args, '--state')
  const tokenFile = option(args, '--token-file')
  if (stateFile && tokenFile) fail('--state and --token-file are mutually exclusive')
  if (!stateFile && !tokenFile) fail('--state or --token-file is required')
  const token = tokenFile
    ? await secret(tokenFile)
    : await studentToken(await readState(stateFile ?? tokenFile!))
  return await openSession(args, 'student', token)
}

async function studentToken(state: Record<string, unknown>): Promise<string> {
  if (typeof state.token === 'string' && state.token) return state.token
  if (typeof state.deviceId === 'string' && typeof state.deviceSecret === 'string')
    return `d.${state.deviceId}.${state.deviceSecret}`
  return fail('the device state has no session token')
}

export async function studentExamPage(
  session: Session
): Promise<{ items: Schema<'Exam'>[]; nextCursor: string | null }> {
  const response = await session.transport.request(session.connectionId, 'getStudentExams', {})
  if (response.status >= 400)
    throw new Error(`getStudentExams was rejected: ${errorOf(response).code}`)
  const page = response.body as { items: Schema<'Exam'>[]; nextCursor: string | null }
  return { items: page.items, nextCursor: page.nextCursor }
}

// Builds the exam the case publishes. The single page plays one audio-like resource and records one
// answer, so the submission built later in the chain has a real recording to carry and the archive is
// large for reasons the product itself defines rather than for a synthetic extra file.
export async function buildExamArchive(
  options: BuildExamArchiveOptions
): Promise<BuildExamArchiveResult> {
  const title = options.title ?? DEFAULT_EXAM_TITLE
  const packageId = options.packageId ?? randomUUID()
  const resourceBytes = options.resourceBytes ?? 0
  const resources: Record<string, Uint8Array> = {}
  const manifest: ExamPackage['examData']['resources'] = {}
  const timeline: ExamPackage['examData']['player']['pages'][number]['timeline'] = [
    { type: 'record', duration: 60, recordIndex: 0 }
  ]
  if (resourceBytes > 0) {
    resources[DEFAULT_RESOURCE_KEY] = randomBytes(resourceBytes)
    manifest[DEFAULT_RESOURCE_KEY] = {
      filename: 'narration.wav',
      packagePath: 'resources/narration.wav',
      mediaType: 'audio/wav'
    }
    timeline.unshift({ type: 'play', src: `resource:${DEFAULT_RESOURCE_KEY}` })
  }
  const exam: ExamPackage = {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId,
    examData: {
      title,
      resources: manifest,
      player: {
        pages: [{ id: 'page-1', content: [], timeline }],
        recordingIndices: [0]
      }
    },
    answerCapturePlan: { strings: [], audios: [{ audioAnswerIndex: 0, recordIndex: 0 }] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: packageId, examTitle: title },
      schemaUses: [],
      resources: {}
    }
  }
  const archive = await encodeExamPackage(exam, resources)
  await mkdir(dirname(options.file), { recursive: true })
  await writeFile(options.file, archive)
  return await readExamArchive(options.file)
}

// Reports what is actually on disk, so the publish path and the reuse path describe the archive the
// same way and a digest in the log always belongs to the file the service received.
export async function readExamArchive(file: string): Promise<BuildExamArchiveResult> {
  const bytes = await readFile(file)
  const archive = await decodeExamPackage(bytes)
  return {
    file,
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    packageId: archive.exam.packageId,
    title: archive.exam.examData.title,
    resourceCount: Object.keys(archive.resources).length,
    exam: archive.exam
  }
}

function summarize(exam: Schema<'Exam'>): StudentExamSummary {
  return {
    examId: exam.examId,
    packageId: exam.packageId,
    title: exam.title,
    archiveSha256: exam.archiveSha256,
    archiveBytes: exam.archiveBytes,
    pageCount: exam.pageCount,
    resourceCount: exam.resourceCount,
    published: exam.published,
    revision: exam.revision
  }
}

// The phase script can hand the device state to `exam-publish`, in which case publication is proven
// by asking the service exactly what a student asks; without one the same published projection the
// teacher sees is reported, labelled so nobody mistakes it for a student session.
async function visibleExams(
  args: string[],
  teacher: Session,
  examId: string
): Promise<VisibleExams> {
  if (option(args, '--state') || option(args, '--token-file')) {
    const student = await studentSession(args)
    try {
      const page = await studentExamPage(student)
      return summarizeVisible('student-session', page.items, examId, page.nextCursor)
    } finally {
      await student.close()
    }
  }
  const response = await teacher.transport.request(teacher.connectionId, 'getTeacherExams', {
    query: { published: true }
  })
  if (response.status >= 400)
    throw new Error(`getTeacherExams was rejected: ${errorOf(response).code}`)
  const page = response.body as { items: Schema<'Exam'>[]; nextCursor: string | null }
  return summarizeVisible('teacher-published-projection', page.items, examId, page.nextCursor)
}

function summarizeVisible(
  source: VisibleExams['source'],
  items: Schema<'Exam'>[],
  examId: string,
  nextCursor: string | null
): VisibleExams {
  return {
    source,
    listed: items.some((item) => item.examId === examId),
    items: items.map(summarize),
    nextCursor
  }
}

export const examPublish: CommandHandler = async (args) => {
  const mirror = required(args, '--out')
  const title = option(args, '--title') ?? DEFAULT_EXAM_TITLE
  const file = option(args, '--exam-file') ?? join(mirror, 'exam.lsexam')
  const resourceBytes = byteOption(args, '--resource-bytes', 0)
  const publish = flag(args, '--publish')
  await mkdir(mirror, { recursive: true })
  // An archive already on disk is published unchanged. Rebuilding would mint a new packageId and,
  // because the zip stamps the current time, new bytes: the exam the VM published in an earlier phase
  // has to stay the same object across processes.
  const reused = await fileExists(file)
  const archive = reused
    ? await readExamArchive(file)
    : await buildExamArchive({ file, title, resourceBytes })
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  try {
    const handle = await session.transport.registerArchive(session.connectionId, archive.file)
    const response = await session.transport.request(session.connectionId, 'postTeacherExams', {
      archive: handle,
      idempotencyKey: randomUUID()
    })
    if (response.status >= 400)
      return {
        ...errorOf(response),
        examId: null,
        revision: null,
        packageId: archive.packageId,
        title: archive.title,
        published: false,
        duplicate: null,
        file: archive.file,
        bytes: archive.bytes,
        sha256: archive.sha256,
        reused,
        mirror,
        patchStatus: null,
        visible: null
      } satisfies ExamPublishReport
    const imported = response.body as Schema<'ExamImport'>
    let patched: Schema<'Exam'> | null = null
    let patchStatus: number | null = null
    if (publish) {
      const patch = await session.transport.request(
        session.connectionId,
        'patchTeacherExamsExamId',
        {
          path: { examId: imported.examId },
          body: { published: true, expectedRevision: imported.revision }
        }
      )
      if (patch.status >= 400)
        return {
          ...errorOf(patch),
          examId: imported.examId,
          revision: imported.revision,
          packageId: imported.packageId,
          title: imported.title,
          published: imported.published,
          duplicate: imported.duplicate,
          file: archive.file,
          bytes: archive.bytes,
          sha256: archive.sha256,
          reused,
          mirror,
          patchStatus: patch.status,
          visible: null
        } satisfies ExamPublishReport
      patched = patch.body as Schema<'Exam'>
      patchStatus = patch.status
    }
    const result = patched ?? imported
    return {
      status: response.status,
      code: null,
      message: null,
      examId: imported.examId,
      revision: result.revision,
      packageId: imported.packageId,
      title: imported.title,
      published: result.published,
      duplicate: imported.duplicate,
      file: archive.file,
      bytes: archive.bytes,
      sha256: archive.sha256,
      reused,
      mirror,
      patchStatus,
      visible: await visibleExams(args, session, imported.examId)
    } satisfies ExamPublishReport
  } finally {
    await session.close()
  }
}

export const examList: CommandHandler = async (args) => {
  const session = await studentSession(args)
  try {
    const response = await session.transport.request(session.connectionId, 'getStudentExams', {})
    if (response.status >= 400)
      return {
        ...errorOf(response),
        connectionId: session.connectionId,
        items: [],
        nextCursor: null
      } satisfies ExamListReport
    const page = response.body as { items: Schema<'Exam'>[]; nextCursor: string | null }
    return {
      status: response.status,
      code: null,
      message: null,
      connectionId: session.connectionId,
      items: page.items.map(summarize),
      nextCursor: page.nextCursor
    } satisfies ExamListReport
  } finally {
    await session.close()
  }
}

export const examFetch: CommandHandler = async (args) => {
  const examId = required(args, '--exam-id')
  const out = required(args, '--out')
  const session = await studentSession(args)
  try {
    const response = await session.transport.request(
      session.connectionId,
      'getStudentExamsExamIdArchive',
      { path: { examId } }
    )
    if (response.status >= 400 || !response.archive)
      return {
        ...errorOf(response),
        connectionId: session.connectionId,
        out: null,
        bytes: 0,
        sha256: null,
        transportSha256: null,
        digestsMatch: false,
        decoded: null,
        decodeError: null
      } satisfies ExamFetchReport
    // The transport deletes its own copies when the connection closes, so the verified bytes are
    // copied out first and every digest below is computed from that copy.
    await mkdir(dirname(out), { recursive: true })
    await copyFile(session.transport.file(response.archive.handle, session.connectionId), out)
    const bytes = await readFile(out)
    const sha256 = sha256Hex(bytes)
    let decoded: ExamFetchReport['decoded'] = null
    let decodeError: string | null = null
    try {
      const archive = await decodeExamPackage(bytes)
      decoded = {
        packageId: archive.exam.packageId,
        title: archive.exam.examData.title,
        resourceCount: Object.keys(archive.resources).length
      }
    } catch (error) {
      decodeError = (error as Error).message
    }
    return {
      status: response.status,
      code: null,
      message: null,
      connectionId: session.connectionId,
      out,
      bytes: bytes.byteLength,
      sha256,
      transportSha256: response.archive.sha256,
      digestsMatch: sha256 === response.archive.sha256,
      decoded,
      decodeError
    } satisfies ExamFetchReport
  } finally {
    await session.close()
  }
}
