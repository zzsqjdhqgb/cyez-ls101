/*
 * Enrollment commands for the lab protocol driver (docs/lab-vm-acceptance-design.md, N3/N4/N5).
 *
 * An enrollment file is a JWS that only the service can verify, and the whole file is the credential:
 * `LabService.putEnrollmentDevicesInstallationId` compares the submitted bytes with the signed file it
 * stored for the enrollment row, so a file that differs from the signed one by a single byte is not a
 * weaker credential, it is a different one. These commands therefore treat the file as opaque bytes —
 * they never parse it, never re-sign it and never repair it — and the only mutation they perform is
 * the one a negative case explicitly asks for.
 *
 * These commands report the HTTP status, which `LabClient` discards on success (it returns the body),
 * so they call the product's own `PinnedTransport` one layer below that wrapper. Validation, pinning
 * and archive streaming are still the shipped implementation.
 *
 * The driver only observes. `enroll-reject` reports a rejection with exit code 0 because the rejection
 * *is* the observation; `enroll-issue` and `enroll-register` exit non-zero when the service refuses,
 * because the phase cannot continue with a batch or a device it never got. Driver-level failures
 * (unreadable file, unreachable service, contract shape violation) throw in all three.
 *
 * Secrets (management password, local proof, device secret, bearer token) travel through files, are
 * read once and are never printed, logged, or embedded in an error message. `--state-out` is the only
 * place a device credential is written, and it is written 0600.
 *
 * enroll-issue
 *   --url <url> --fingerprint <sha256:…> --version <v> (--password-file <p> | --local-proof-file <p>)
 *   --out <file> [--valid-for-seconds <n>] [--expected-mode-revision <n>] [--idempotency-key <uuid>]
 *     Creates one enrollment batch, downloads its signed file to --out, and reports the batch, the
 *     file digest and the batch's entry in `getTeacherEnrollments`. Without --expected-mode-revision
 *     the current revision is read from `getTeacherService`, because every batch bumps it.
 *
 * enroll-register
 *   --url --fingerprint --version --enroll-file <path> --installation-id <uuid> --state-out <file>
 *   [--computer-name <n>] [--platform win32|linux] [--device-secret-file <p>] [--release-version <v>]
 *     Registers one device from this process. --state-out receives everything a later process needs to
 *     act as that device (0600):
 *       installationId, deviceId, deviceNumber, number, deviceSecret, bearerToken, token,
 *       authorization, enrollFile, enrollFileSha256, url, fingerprint, serverId, version,
 *       releaseVersion, computerName, platform, registeredAt
 *     `bearerToken` is the student credential exactly as `Security.authenticate` parses it
 *     (`d.<deviceId>.<43-char secret>`); `authorization` is the ready-made header value, so a later
 *     heartbeat or submission process cannot reassemble it differently. `token`, `number` and
 *     `releaseVersion` are aliases of `bearerToken`, `deviceNumber` and `version`, so a consumer
 *     cannot guess the wrong name. A device secret is read from --device-secret-file when that file
 *     exists, otherwise generated and written there; without the flag it is generated in memory only.
 *
 * enroll-reject
 *   --url --fingerprint --version --enroll-file <path> --installation-id <uuid>
 *   [--device-secret-file <p>] [--release-version <v>] [--computer-name <n>] [--platform …]
 *   [--mutate one-byte] [--from-other-enrollment <path>] [--expect-expired]
 *   [--revoke-first [--enrollment-id <uuid>] (--password-file <p> | --local-proof-file <p>)]
 *     Attempts exactly one registration and reports the refusal instead of throwing. Every mutation is
 *     a real change to real bytes:
 *       --mutate one-byte              submit a copy with one byte changed (the middle-byte rule and
 *                                      the offset/before/after evidence come from `file-edit`)
 *       --from-other-enrollment <p>    submit a validly signed file issued for another batch, using
 *                                      --enroll-file as the reference for what this batch holds
 *       wrong --fingerprint            refused during the TLS handshake, before any HTTP request
 *       --release-version <v>          a body version the service does not run
 *       --revoke-first                 close the batch (N4's revoked case) before registering
 *       --expect-expired               only labels the observation: the driver cannot move the
 *                                      service clock, so the phase ages the batch (a short
 *                                      --valid-for-seconds and a wait; the vitest spec advances
 *                                      `harness.clock` instead) and asserts `expired`
 *     A rejection is reported as { accepted: false, status, code, message } (status 0 with a TLS_*
 *     code when nothing was sent); an unexpected success as { accepted: true, deviceId, … }.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { access, copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
  secret,
  sha256Hex,
  targetFrom,
  versionFrom,
  writeState,
  type CommandHandler,
  type Session
} from '../context'
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

interface DeviceSecret {
  value: string
  file: string | null
  reused: boolean
}

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

// A device secret is generated only when the caller did not supply one, and it is written 0600 on
// POSIX (Windows uses the caller's directory ACL) because it is a credential rather than evidence.
// Reusing an existing file is what turns a second
// registration into a replay of the same device rather than a new one.
async function deviceSecretFor(args: string[]): Promise<DeviceSecret> {
  const file = option(args, '--device-secret-file')
  const value = randomBytes(32).toString('base64url')
  if (!file) return { value, file: null, reused: false }
  const exists = await access(file).then(
    () => true,
    () => false
  )
  if (exists) return { value: await secret(file), file, reused: true }
  await writeFile(file, `${value}\n`, { encoding: 'utf8', mode: 0o600 })
  return { value, file, reused: false }
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
  const installationId = required(args, '--installation-id')
  const stateOut = required(args, '--state-out')
  const fileBytes = await readEnrollmentFile(enrollFile)
  const device = await deviceSecretFor(args)
  const version = versionFrom(args)
  const target = targetFrom(args)
  const computerName = option(args, '--computer-name') ?? hostname()
  const platform = platformFrom(args)
  const releaseVersion = option(args, '--release-version') ?? version
  const session = await openSession(args, 'public')
  try {
    const response = await session.transport.request(
      session.connectionId,
      'putEnrollmentDevicesInstallationId',
      {
        path: { installationId },
        body: {
          enrollmentFile: fileBytes.toString('utf8'),
          deviceSecret: device.value,
          computerName,
          platform,
          releaseVersion
        }
      }
    )
    if (response.status >= 400) {
      const error = errorOf(response)
      fail(`the registration was rejected: ${error.status} ${error.code ?? 'unknown'}`)
    }
    const body = recordOf(response.body, 'the registration response')
    const deviceId = textOf(body.deviceId, 'deviceId')
    const number = textOf(body.deviceNumber, 'deviceNumber')
    const registeredAt = textOf(body.registeredAt, 'registeredAt')
    const bearerToken = `d.${deviceId}.${device.value}`
    // The three alias keys alongside their canonical names exist so a consuming command cannot guess
    // wrong: `token`/`number`/`releaseVersion` are the names the other drivers' flags use, and a
    // state file that disagreed with itself would silently authenticate as nothing.
    await writeState(stateOut, {
      installationId,
      deviceId,
      deviceNumber: number,
      number,
      deviceSecret: device.value,
      bearerToken,
      token: bearerToken,
      authorization: `Bearer ${bearerToken}`,
      enrollFile: resolve(enrollFile),
      enrollFileSha256: sha256Hex(fileBytes),
      url: target.baseUrl,
      fingerprint: target.fingerprint,
      serverId: session.info.serverId,
      version,
      releaseVersion,
      computerName,
      platform,
      registeredAt
    })
    return {
      installationId,
      deviceId,
      number,
      duplicate: response.status === 200,
      status: response.status,
      stateOut,
      deviceSecretFile: device.file,
      deviceSecretReused: device.reused,
      enrollFile: resolve(enrollFile),
      enrollFileSha256: sha256Hex(fileBytes),
      registeredAt,
      serverId: session.info.serverId
    }
  } finally {
    await session.close()
  }
}

export const enrollReject: CommandHandler = async (args) => {
  const heldFile = required(args, '--enroll-file')
  const installationId = required(args, '--installation-id')
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
  const device = await deviceSecretFor(args)
  const result: Record<string, unknown> = {
    accepted: false,
    status: 0,
    installationId,
    heldFile: { path: heldFile, bytes: heldBytes.byteLength, sha256: sha256Hex(heldBytes) },
    submitted: {
      path: mutation?.out ?? submittedFile,
      bytes: submittedBytes.byteLength,
      sha256: sha256Hex(submittedBytes)
    },
    deviceSecretFile: device.file,
    deviceSecretReused: device.reused,
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
      'putEnrollmentDevicesInstallationId',
      {
        path: { installationId },
        body: {
          enrollmentFile: submittedBytes.toString('utf8'),
          deviceSecret: device.value,
          computerName: option(args, '--computer-name') ?? hostname(),
          platform: platformFrom(args),
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
