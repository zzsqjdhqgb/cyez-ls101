/*
 * The two concurrency ceilings for the lab protocol driver (docs/lab-vm-acceptance-design.md, N9).
 *
 * They are different resources and they answer with different codes, which is the whole point of the
 * case: `ArchiveStore.receive` counts rows in the `uploads` table and refuses the overflow with 429
 * RATE_LIMITED and Retry-After, while the HTTP server counts live handler promises in `http.ts` and
 * refuses the 65th with 503 SERVICE_NOT_READY before any routing happens. A driver that only proved
 * "something was refused under load" would not distinguish them, so both kinds are driven the same way
 * and the report keeps the status counts, the code counts and the first error separately.
 *
 * The product transport writes a whole body in one call and only then waits for the answer, so it
 * cannot keep a request open while the others pile up. These requests are therefore made through
 * `pinnedSocket` — the same pin-before-anything primitive the transport uses — with the headers the
 * contract declares and a body that arrives in steps. Pinning, TLS, the request path and the server
 * side are all real; only the socket bookkeeping is local.
 *
 * The body is what holds a request open: `http.ts` reads a JSON body before the handler runs (so a
 * slow heartbeat occupies a handler) and `receive` reserves the upload row before it reads the stream
 * (so a slow upload keeps its reservation while the other requests are decided). The connections are
 * all opened first and then started together, so the requests actually overlap.
 *
 * concurrency
 *   --url <url> --fingerprint <sha256:…> --version <v> --state <file> --kind uploads|handlers
 *   --count <n> [--keepalive-seconds <s>]
 *     uploads:  --count simultaneous `putStudentSubmissionsSubmissionId` calls from one device. Each
 *               needs its own practice grant, so --state must carry the `practice` record that a
 *               preceding start wrote; one device may hold only one submission upload at a time, and
 *               that per-device rule is what a single machine can actually exceed.
 *     handlers: --count simultaneous `postStudentHeartbeat` requests with JSON bodies that arrive
 *               slowly, which is how a handler is occupied long enough for the next one to arrive.
 *     Reports { kind, operation, count, statuses, codes, firstError, transportErrors,
 *     firstTransportError, keepaliveSeconds, elapsedMs }. Nothing is asserted here: a status a case
 *     expects is data, and a setup failure (no recorded practice, a refused grant) fails the process
 *     instead of being reported as a ceiling observation.
 */
import { randomUUID } from 'node:crypto'
import { Agent, request as httpsRequest } from 'node:https'
import type { TLSSocket } from 'node:tls'
import {
  API_PREFIX,
  operationDefinitions,
  type OperationId,
  type Schema
} from '../../../../packages/lab-contracts/src'
import { encodeSubmissionPackage } from '../../../../packages/exam-package/src'
import {
  pinnedSocket,
  type TrustedTarget
} from '../../../../packages/lab-desktop-host/src/transport'
import {
  errorOf,
  fail,
  numberOption,
  openSession,
  readState,
  required,
  sha256Hex,
  targetFrom,
  versionFrom,
  type CommandHandler,
  type Session
} from '../context'
import { deviceStateFrom, submissionPackage, type PracticeRecord } from './practice'

// Long enough that every request of the fan-out is decided while the first ones are still open; a VM
// run can raise it, but a case that needs more is a case about timing rather than about a ceiling.
const DEFAULT_KEEPALIVE_SECONDS = 2
// The body is written in this many steps. More steps would add timer jitter without changing which
// request is decided first.
const TRICKLE_STEPS = 8

interface RequestSpec {
  operation: OperationId
  method: string
  path: Record<string, string>
  headers: Record<string, string>
  body: Buffer
}

type Outcome =
  | { kind: 'response'; status: number; code: string | null; message: string | null }
  | { kind: 'transport'; error: string }

interface Summary {
  kind: string
  operation: OperationId
  count: number
  statuses: Record<string, number>
  codes: Record<string, number>
  firstError: { status: number; code: string | null; message: string | null } | null
  transportErrors: number
  firstTransportError: string | null
  keepaliveSeconds: number
  elapsedMs: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The path is built from the contract rather than written out, so a route change cannot leave this
// command quietly talking to a path the product transport no longer uses.
function routeOf(operation: OperationId, path: Record<string, string>): string {
  const definition = operationDefinitions[operation]
  return `${API_PREFIX}${definition.route.replace(/\{([^}]+)\}/g, (_, key: string) =>
    encodeURIComponent(path[key])
  )}`
}

// Each request opens its own connection: the service's real path is one socket per request with no
// keep-alive, and a shared connection would serialise the very overlap under test.
async function openConnections(
  target: TrustedTarget,
  count: number
): Promise<Array<TLSSocket | Error>> {
  return await Promise.all(
    Array.from({ length: count }, async () => {
      try {
        return await pinnedSocket(target)
      } catch (error) {
        return error instanceof Error ? error : new Error(messageOf(error))
      }
    })
  )
}

async function slowRequest(
  target: TrustedTarget,
  socket: TLSSocket,
  spec: RequestSpec,
  keepaliveMs: number
): Promise<Outcome> {
  const agent = new Agent({ keepAlive: false })
  agent.createConnection = () => socket
  const chunkBytes = Math.max(1, Math.ceil(spec.body.byteLength / TRICKLE_STEPS))
  const intervalMs = Math.max(1, Math.floor(keepaliveMs / TRICKLE_STEPS))
  try {
    return await new Promise<Outcome>((resolve) => {
      let settled = false
      let timer: NodeJS.Timeout | null = null
      let offset = 0
      const stop = (): void => {
        if (!timer) return
        clearInterval(timer)
        timer = null
      }
      const finish = (value: Outcome): void => {
        if (settled) return
        settled = true
        stop()
        resolve(value)
      }
      const call = httpsRequest(
        `${new URL(target.baseUrl).origin}${routeOf(spec.operation, spec.path)}`,
        {
          method: spec.method,
          agent,
          headers: { ...spec.headers, 'Content-Length': String(spec.body.byteLength) }
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            const status = response.statusCode ?? 0
            const text = Buffer.concat(chunks).toString('utf8')
            let body: unknown
            try {
              body = text ? JSON.parse(text) : undefined
            } catch {
              body = undefined
            }
            const error = errorOf({ status, body })
            finish({
              kind: 'response',
              status,
              code: error.code ?? null,
              message: error.message ?? null
            })
          })
          response.on('error', (error: Error) =>
            finish({ kind: 'transport', error: error.message })
          )
        }
      )
      call.on('error', (error: Error) => finish({ kind: 'transport', error: error.message }))
      call.setTimeout(Math.max(10000, keepaliveMs * 4), () =>
        call.destroy(new Error('request timed out'))
      )
      call.flushHeaders()
      const step = (): void => {
        if (settled || call.destroyed || offset >= spec.body.byteLength) {
          stop()
          return
        }
        const end = Math.min(offset + chunkBytes, spec.body.byteLength)
        try {
          call.write(spec.body.subarray(offset, end))
        } catch (error) {
          finish({ kind: 'transport', error: messageOf(error) })
          return
        }
        offset = end
        if (offset >= spec.body.byteLength) {
          stop()
          call.end()
        }
      }
      timer = setInterval(step, intervalMs)
      step()
    })
  } finally {
    agent.destroy()
  }
}

async function fanOut(
  target: TrustedTarget,
  specs: RequestSpec[],
  keepaliveMs: number
): Promise<{ outcomes: Outcome[]; elapsedMs: number }> {
  const started = Date.now()
  const connections = await openConnections(target, specs.length)
  const outcomes = await Promise.all(
    connections.map(async (connection, index) => {
      if (connection instanceof Error)
        return { kind: 'transport' as const, error: connection.message }
      const outcome = await slowRequest(target, connection, specs[index], keepaliveMs)
      connection.destroy()
      return outcome
    })
  )
  return { outcomes, elapsedMs: Date.now() - started }
}

function summarize(
  kind: string,
  operation: OperationId,
  count: number,
  keepaliveSeconds: number,
  result: { outcomes: Outcome[]; elapsedMs: number }
): Summary {
  const statuses: Record<string, number> = {}
  const codes: Record<string, number> = {}
  let firstError: Summary['firstError'] = null
  let transportErrors = 0
  let firstTransportError: string | null = null
  for (const outcome of result.outcomes) {
    if (outcome.kind === 'transport') {
      transportErrors++
      if (!firstTransportError) firstTransportError = outcome.error
      continue
    }
    const status = String(outcome.status)
    statuses[status] = (statuses[status] ?? 0) + 1
    if (outcome.code) codes[outcome.code] = (codes[outcome.code] ?? 0) + 1
    if (outcome.status >= 400 && !firstError)
      firstError = { status: outcome.status, code: outcome.code, message: outcome.message }
  }
  return {
    kind,
    operation,
    count,
    statuses,
    codes,
    firstError,
    transportErrors,
    firstTransportError,
    keepaliveSeconds,
    elapsedMs: result.elapsedMs
  }
}

// A device may hold one submission upload at a time, so exceeding that rule needs more than one
// request in flight; each request needs its own grant, and a grant is bound to the exam digest and
// candidate the practice start used.
async function uploadRequests(
  session: Session,
  practice: PracticeRecord,
  count: number,
  version: string,
  authorization: string
): Promise<RequestSpec[]> {
  if (!practice.packageId)
    fail('--kind uploads needs the exam package id: run practice against a published exam first')
  const specs: RequestSpec[] = []
  for (let index = 0; index < count; index++) {
    const submissionId = randomUUID()
    const grant = await session.transport.request(
      session.connectionId,
      'putStudentPracticesSubmissionId',
      {
        path: { submissionId },
        body: {
          examId: practice.examId,
          archiveSha256: practice.archiveSha256,
          candidate: practice.candidate
        }
      }
    )
    if (grant.status >= 400) {
      const error = errorOf(grant)
      fail(
        `practice grant ${index + 1} of ${count} was refused: ${grant.status} ${error.code ?? 'unknown error'}`
      )
    }
    const bytes = Buffer.from(
      await encodeSubmissionPackage(
        submissionPackage(
          submissionId,
          practice.packageId,
          practice.examTitle ?? 'protocol driver',
          practice.candidate,
          practice.startedAt
        ),
        {}
      )
    )
    specs.push({
      operation: 'putStudentSubmissionsSubmissionId',
      method: 'PUT',
      path: { submissionId },
      headers: {
        Authorization: authorization,
        'X-LS101-Client-Version': version,
        'Content-Type': 'application/x-ls101-submission',
        'X-LS101-Archive-SHA256': sha256Hex(bytes)
      },
      body: bytes
    })
  }
  return specs
}

function heartbeatRequests(
  count: number,
  version: string,
  authorization: string,
  state: Record<string, unknown>
): RequestSpec[] {
  const heartbeat: Schema<'Heartbeat'> = {
    runtimeId: String(state.runtimeId),
    runtimeGeneration: Number(state.runtimeGeneration),
    sequence: 1,
    activationState: 'active',
    phase: 'idle',
    currentPractice: null,
    submissionSummary: { waitingFirstUpload: 0, unconfirmed: 0, failed: 0 },
    lastError: null
  }
  const body = Buffer.from(JSON.stringify(heartbeat))
  return Array.from({ length: count }, () => ({
    operation: 'postStudentHeartbeat' as const,
    method: 'POST',
    path: {},
    headers: {
      Authorization: authorization,
      'X-LS101-Client-Version': version,
      'Content-Type': 'application/json'
    },
    body
  }))
}

function kindOf(args: string[]): 'uploads' | 'handlers' {
  const kind = required(args, '--kind')
  if (kind !== 'uploads' && kind !== 'handlers') fail('--kind must be uploads or handlers')
  return kind
}

function countOf(args: string[]): number {
  const raw = required(args, '--count')
  const count = Number(raw)
  if (!Number.isSafeInteger(count) || count < 1) fail('--count must be a positive integer')
  return count
}

export const concurrency: CommandHandler = async (args) => {
  const kind = kindOf(args)
  const count = countOf(args)
  const keepaliveSeconds = numberOption(args, '--keepalive-seconds', DEFAULT_KEEPALIVE_SECONDS)
  const keepaliveMs = Math.max(1, Math.round(keepaliveSeconds * 1000))
  const target = targetFrom(args)
  const version = versionFrom(args)
  const state = await readState(required(args, '--state'))
  const device = deviceStateFrom(state, args)
  if (kind === 'uploads') {
    const practice = device.practice
    if (!practice)
      fail('--kind uploads needs a recorded practice: run practice against a published exam first')
    const session = await openSession(args, 'student', device.token)
    try {
      const specs = await uploadRequests(session, practice, count, version, device.authorization)
      return summarize(
        kind,
        'putStudentSubmissionsSubmissionId',
        count,
        keepaliveSeconds,
        await fanOut(target, specs, keepaliveMs)
      )
    } finally {
      await session.close()
    }
  }
  const specs = heartbeatRequests(count, version, device.authorization, state)
  return summarize(
    kind,
    'postStudentHeartbeat',
    count,
    keepaliveSeconds,
    await fanOut(target, specs, keepaliveMs)
  )
}
