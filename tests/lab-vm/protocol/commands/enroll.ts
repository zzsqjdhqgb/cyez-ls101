/* Enrollment driver. The product persists only portable server connection settings.
 * This test driver writes device tokens to its private state file so independent probe processes
 * can exercise the protocol. Those files are test instrumentation and must not enter an image.
 * enroll-register: --enroll-file --computer-name --state-out, plus the usual service target flags.
 * enroll-reject: the same enrollment input plus the negative-case mutation flags.
 */
import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  errorOf,
  fail,
  flag,
  isRecord,
  numberOption,
  openSession,
  openTeacher,
  option,
  required,
  sha256Hex,
  targetFrom,
  versionFrom,
  writeState,
  type CommandHandler,
  type Session
} from '../context'
import { registerStudent } from '../register-student'
import { fileEdit } from './file-edit'

// `EnrollmentPayload.purpose` and `formatVersion` are literals in the signing code, and the driver
// never holds the service private key, so the N4 "wrong purpose/formatVersion" variant cannot be
// produced end to end. Saying so in the report is better than a case that quietly proves nothing.
const PURPOSE_NOTE =
  'a wrong purpose/formatVersion payload cannot be produced by the driver: it needs the service ' +
  'signing key, and postTeacherEnrollments always signs purpose=ls101-device-enrollment, ' +
  'formatVersion=1. verifyEnrollment rejects both, but only a file re-signed with the service key ' +
  'could exercise it, so no request here covers that variant.'

// `pinnedSocket` refuses on its own terms and its message is the only place the refusal is named. A
// pin mismatch has to be distinguishable from "the driver could not reach a service at all": the
// first is an observation N4 expects, the second is a driver failure.
const PIN_REFUSALS: Record<string, string> = {
  'Service public key changed': 'TLS_PIN_MISMATCH',
  'Service certificate missing': 'TLS_CERTIFICATE_MISSING',
  'Service certificate expired or not yet valid': 'TLS_CERTIFICATE_INVALID'
}

const DEFAULT_VALID_FOR_SECONDS = 600

interface OneByteMutation {
  out: string
  bytes: Buffer
  offset: number
  before: number
  after: number
  originalSha256: string
}

function textOf(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) fail(`the service did not report ${field}`)
  return value
}

function recordOf(value: unknown, description: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${description} was not a JSON object`)
  return value
}

function pinRefusal(error: unknown): { code: string; message: string } | undefined {
  const message = error instanceof Error ? error.message : ''
  const code = PIN_REFUSALS[message]
  return code ? { code, message } : undefined
}

async function readEnrollmentFile(file: string): Promise<Buffer> {
  try {
    return await readFile(file)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown error'
    fail(`cannot read ${file}: ${code}`)
  }
}

function platformFrom(args: string[]): 'win32' | 'linux' {
  const value = option(args, '--platform')
  if (value === undefined) return process.platform === 'win32' ? 'win32' : 'linux'
  if (value !== 'win32' && value !== 'linux') fail('--platform must be win32 or linux')
  return value
}

// The rule that picks the byte lives in `file-edit`; calling it instead of copying the rule keeps the
// evidence identical if the rule ever changes.
async function mutateOneByte(source: string): Promise<OneByteMutation> {
  const directory = await mkdtemp(join(tmpdir(), 'ls101-enrollment-mutation-'))
  const out = join(directory, 'mutated.lsjoin')
  const result = await fileEdit(['mutate', '--in', source, '--out', out])
  const reported = recordOf(result, 'the one-byte mutation')
  const { offset, before, after } = reported
  if (typeof offset !== 'number' || typeof before !== 'number' || typeof after !== 'number')
    fail('the one-byte mutation did not report the changed byte')
  return {
    out,
    bytes: await readFile(out),
    offset,
    before,
    after,
    originalSha256: sha256Hex(await readFile(source))
  }
}

async function listEnrollments(session: Session): Promise<Record<string, unknown>[]> {
  const listed = await session.transport.request(session.connectionId, 'getTeacherEnrollments', {
    query: { limit: 200 }
  })
  if (listed.status !== 200 || !isRecord(listed.body) || !Array.isArray(listed.body.items))
    fail(`the enrollment list could not be read: ${listed.status}`)
  return listed.body.items.filter(isRecord)
}

// Every batch bumps the mode revision, so the phase would otherwise have to thread a number from one
// step to the next just to create the next batch.
async function expectedModeRevision(args: string[], session: Session): Promise<number> {
  const raw = option(args, '--expected-mode-revision')
  if (raw !== undefined) {
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < 1)
      fail('--expected-mode-revision must be a positive integer')
    return value
  }
  const service = await session.transport.request(session.connectionId, 'getTeacherService', {})
  const body =
    service.status === 200 && isRecord(service.body)
      ? service.body
      : fail(`the service state could not be read: ${service.status}`)
  const revision = body.modeRevision
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision))
    fail('the service did not report a mode revision')
  return revision
}

// A failure here is a setup failure, not the case under test: continuing would register against a
// batch that is still open and quietly assert the wrong thing.
async function revokeEnrollment(args: string[]): Promise<Record<string, unknown>> {
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  try {
    const requested = option(args, '--enrollment-id')
    const active = (await listEnrollments(session)).find((item) => item.status === 'active')
    const id = requested ?? (typeof active?.id === 'string' ? active.id : undefined)
    if (!id) fail('--revoke-first found no active enrollment to revoke')
    const deleted = await session.transport.request(
      session.connectionId,
      'deleteTeacherEnrollmentsId',
      { path: { id } }
    )
    if (deleted.status !== 204) {
      const error = errorOf(deleted)
      fail(`the revocation failed: ${error.status} ${error.code ?? 'unknown'}`)
    }
    return { enrollmentId: id, status: deleted.status }
  } finally {
    await session.close()
  }
}

export const enrollIssue: CommandHandler = async (args) => {
  const out = required(args, '--out')
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  try {
    const idempotencyKey = option(args, '--idempotency-key') ?? randomUUID()
    const created = await session.transport.request(
      session.connectionId,
      'postTeacherEnrollments',
      {
        body: {
          expectedModeRevision: await expectedModeRevision(args, session),
          validForSeconds: numberOption(args, '--valid-for-seconds', DEFAULT_VALID_FOR_SECONDS)
        },
        idempotencyKey
      }
    )
    if (created.status >= 400) {
      const error = errorOf(created)
      fail(`the enrollment batch was rejected: ${error.status} ${error.code ?? 'unknown'}`)
    }
    const createdBody = recordOf(created.body, 'the enrollment response')
    const enrollment = recordOf(createdBody.enrollment, 'the enrollment')
    const enrollmentId = textOf(enrollment.id, 'enrollment.id')

    const download = await session.transport.request(
      session.connectionId,
      'getTeacherEnrollmentsIdFile',
      { path: { id: enrollmentId } }
    )
    if (download.status >= 400 || !download.archive) {
      const error = errorOf(download)
      fail(
        `the enrollment file could not be downloaded: ${error.status} ${error.code ?? 'unknown'}`
      )
    }
    await copyFile(session.transport.file(download.archive.handle), out)
    const written = await readFile(out)
    // The digest the transport computed while receiving is the only digest the API exposes: the
    // operation declares no digest header, so there is no independent server-side digest to compare
    // against. The proof that these bytes are the signed file is that the service accepts them for a
    // registration, which compares the whole file.
    if (sha256Hex(written) !== download.archive.sha256)
      fail('the enrollment file on disk differs from the downloaded stream')

    const listed = (await listEnrollments(session)).find((item) => item.id === enrollmentId)
    return {
      enrollmentId,
      status: created.status,
      state: enrollment.status,
      issuedAt: enrollment.issuedAt,
      expiresAt: enrollment.expiresAt,
      mode: createdBody.mode,
      modeRevision: createdBody.modeRevision,
      out,
      bytes: written.byteLength,
      sha256: sha256Hex(written),
      downloadSha256: download.archive.sha256,
      idempotencyKey,
      listed: listed ?? null
    }
  } finally {
    await session.close()
  }
}

export const enrollRegister: CommandHandler = async (args) => {
  const enrollFile = required(args, '--enroll-file')
  const stateOut = required(args, '--state-out')
  const fileBytes = await readEnrollmentFile(enrollFile)
  const version = versionFrom(args),
    target = targetFrom(args)
  const computerName = option(args, '--computer-name') ?? hostname()
  const session = await openSession(args, 'public')
  try {
    const body = await registerStudent(
      session,
      fileBytes.toString('utf8'),
      computerName,
      option(args, '--release-version') ?? version,
      randomUUID(),
      platformFrom(args)
    )
    const bearerToken = `d.${body.deviceId}.${body.deviceSecret}`
    await writeState(stateOut, {
      ...body,
      deviceNumber: body.deviceNumber,
      number: body.deviceNumber,
      bearerToken,
      token: bearerToken,
      authorization: `Bearer ${bearerToken}`,
      enrollFile: resolve(enrollFile),
      enrollFileSha256: sha256Hex(fileBytes),
      url: target.baseUrl,
      fingerprint: target.fingerprint,
      serverId: session.info.serverId,
      version,
      releaseVersion: version,
      computerName,
      platform: platformFrom(args)
    })
    const secretFile = option(args, '--device-secret-file')
    if (secretFile) await writeFile(secretFile, `${body.deviceSecret}\n`, { mode: 0o600 })
    return {
      deviceId: body.deviceId,
      number: body.deviceNumber,
      status: 200,
      stateOut,
      enrollFile: resolve(enrollFile),
      enrollFileSha256: sha256Hex(fileBytes),
      registeredAt: body.registeredAt,
      serverId: session.info.serverId
    }
  } finally {
    await session.close()
  }
}

export const enrollReject: CommandHandler = async (args) => {
  const heldFile = required(args, '--enroll-file')
  const version = versionFrom(args)
  const heldBytes = await readEnrollmentFile(heldFile)
  const otherFile = option(args, '--from-other-enrollment')
  const submittedFile = otherFile ?? heldFile
  let submittedBytes = otherFile ? await readEnrollmentFile(otherFile) : heldBytes
  const mutationKind = option(args, '--mutate')
  if (mutationKind !== undefined && mutationKind !== 'one-byte')
    fail('--mutate only supports one-byte')
  const mutation = mutationKind ? await mutateOneByte(submittedFile) : undefined
  if (mutation) submittedBytes = mutation.bytes
  const result: Record<string, unknown> = {
    accepted: false,
    status: 0,
    heldFile: { path: heldFile, bytes: heldBytes.byteLength, sha256: sha256Hex(heldBytes) },
    submitted: {
      path: mutation?.out ?? submittedFile,
      bytes: submittedBytes.byteLength,
      sha256: sha256Hex(submittedBytes)
    },
    releaseVersion: option(args, '--release-version') ?? version,
    notes: [PURPOSE_NOTE]
  }
  if (mutation)
    result.mutation = {
      kind: mutationKind,
      out: mutation.out,
      offset: mutation.offset,
      before: mutation.before,
      after: mutation.after,
      originalSha256: mutation.originalSha256,
      mutatedSha256: sha256Hex(mutation.bytes)
    }
  if (flag(args, '--revoke-first')) result.revoke = await revokeEnrollment(args)

  let session: Session
  try {
    session = await openSession(args, 'public')
  } catch (error) {
    const refusal = pinRefusal(error)
    // Any other failure — a closed port, a name that does not resolve — is not an observation about
    // the credential, so it stays a driver failure instead of a fabricated rejection.
    if (!refusal) throw error
    // The pin is checked inside the handshake, before any HTTP request exists, so there is no status
    // to report: 0 means nothing was sent.
    return { ...result, status: 0, ...refusal }
  }
  try {
    const response = await session.transport.request(
      session.connectionId,
      'postEnrollmentConnections',
      {
        body: {
          enrollmentFile: submittedBytes.toString('utf8'),
          computerName: option(args, '--computer-name') ?? hostname(),
          releaseVersion: option(args, '--release-version') ?? version
        }
      }
    )
    if (response.status < 400) {
      const body = recordOf(response.body, 'the registration response')
      return {
        ...result,
        accepted: true,
        status: response.status,
        deviceId: body.deviceId,
        number: body.deviceNumber,
        duplicate: response.status === 200
      }
    }
    const error = errorOf(response)
    return {
      ...result,
      accepted: false,
      status: response.status,
      code: error.code,
      message: error.message,
      ...(flag(args, '--expect-expired')
        ? { expired: { status: response.status, code: error.code } }
        : {})
    }
  } finally {
    await session.close()
  }
}
