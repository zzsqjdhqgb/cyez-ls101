/*
 * N6 and N11: heartbeat liveness, the device list the teacher reads, and the many-client load case
 * (docs/lab-vm-acceptance-design.md §6, Tier 2).
 *
 * `online` is the server's judgement, so `device-list` copies it out of the response and never
 * derives it from the driver's own clock: the case is about the service's answer, not about this
 * driver agreeing with it. What the driver does own is sequence bookkeeping. The service stores one
 * heartbeat row per device credential and only accepts a heartbeat that is newer than the stored
 * one, so a run spread over several processes has to continue the same runtime rather than present
 * itself as a restart — or, worse, as a stale duplicate — by accident.
 *
 * `heartbeat-load` opens one pinned connection per client, which is what makes N11 a real port and
 * handshake measurement: every request builds and destroys its own TLS socket, and no response body
 * is retained, so a run of several minutes holds only counters in memory.
 */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { RemoteError } from '../../../../packages/lab-client/src'
import type { Schema } from '../../../../packages/lab-contracts/src'
import {
  fail,
  flag,
  numberOption,
  openSession,
  openTeacher,
  option,
  readState,
  required,
  writeState,
  type CommandHandler,
  type Session
} from '../context'

const PHASES = [
  'idle',
  'preparing',
  'practicing',
  'saving',
  'maintenance-idle',
  'testing',
  'error'
] as const
type Phase = (typeof PHASES)[number]

// `heartbeats` is keyed by credential, so the state file is the only place the runtime identity can
// live; it is written back after every run so the next process continues it instead of inventing one.
interface Runtime {
  runtimeId: string
  runtimeGeneration: number
  sequence: number
}

export interface HeartbeatError {
  status: number
  code: string
  message: string
}

export interface HeartbeatReport {
  deviceId: string | null
  sent: number
  accepted: number
  rejected: number
  firstError: HeartbeatError | null
  lastStatus: number
  sequence: number
  runtimeId: string
  runtimeGeneration: number
  phase: Phase
  stale: boolean
  lastAccepted: boolean | null
}

export interface DeviceListEntry extends Schema<'DeviceDetails'> {
  // The API names these `lastHeartbeatAt` and `heartbeat.phase`; the aliases carry the same server
  // values under the names the phase script reads, and never a value computed here.
  lastSeenAt: string | null
  phase: Phase | null
}

export interface DeviceListReport {
  items: DeviceListEntry[]
  nextCursor: string | null
  total: number
}

export interface HeartbeatLoadReport {
  clients: number
  seconds: number
  intervalMs: number
  sent: number
  accepted: number
  rejected: number
  errors: HeartbeatError[]
  maxInFlight: number
  throughputPerSecond: number
  elapsedMs: number
  sequence: number
}

// A failing load client keeps running, so the error list is a bounded sample rather than a log.
const ERROR_SAMPLE = 5

function integerOption(args: string[], name: string): number | undefined {
  const raw = option(args, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive integer`)
  return value
}

function phaseFrom(args: string[]): Phase {
  const value = option(args, '--phase') ?? 'idle'
  if (!(PHASES as readonly string[]).includes(value))
    fail(`--phase must be one of ${PHASES.join(', ')}`)
  return value as Phase
}

// The token is a device credential. It is read from the state file and never printed, logged or put
// into an error message; the file name is the only identifier that may appear in a diagnostic.
//
// The enrollment command's state file names this credential `token`, and also writes the same value
// as `bearerToken` and as a ready-made `authorization` header. All three are one credential, so any
// of them is accepted: a phase that chains enrollment into a heartbeat must not depend on which of
// the names the enrollment step happened to write.
function tokenFrom(stateFile: string, state: Record<string, unknown>): string {
  const authorization =
    typeof state.authorization === 'string'
      ? state.authorization.replace(/^Bearer\s+/i, '')
      : undefined
  const token =
    typeof state.token === 'string'
      ? state.token
      : typeof state.bearerToken === 'string'
        ? state.bearerToken
        : authorization
  if (!token || !token.startsWith('d.')) fail(`${stateFile} has no device token`)
  return token
}

function runtimeFrom(args: string[], state: Record<string, unknown>): Runtime {
  const generation = state.runtimeGeneration
  const sequence = state.sequence
  const storedGeneration =
    typeof generation === 'number' && Number.isSafeInteger(generation) && generation >= 1
      ? generation
      : 1
  const storedSequence =
    typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence >= 1 ? sequence : 0
  return {
    runtimeId:
      option(args, '--runtime-id') ??
      (typeof state.runtimeId === 'string' ? state.runtimeId : randomUUID()),
    runtimeGeneration: integerOption(args, '--runtime-generation') ?? storedGeneration,
    sequence: storedSequence
  }
}

// The contract makes all four of these fields required, so the idle values have to be explicit: a
// driver that is not playing a paper has an empty summary and no practice, not a missing one.
function heartbeatBody(
  runtime: Runtime,
  sequence: number,
  phase: Phase,
  lastError: boolean
): Schema<'Heartbeat'> {
  return {
    runtimeId: runtime.runtimeId,
    runtimeGeneration: runtime.runtimeGeneration,
    sequence,
    activationState: 'active',
    phase,
    currentPractice: null,
    submissionSummary: { waitingFirstUpload: 0, unconfirmed: 0, failed: 0 },
    lastError: lastError
      ? {
          code: 'DRIVER_REPORTED',
          message: 'diagnostic reported by the protocol driver',
          occurredAt: new Date().toISOString()
        }
      : null
  }
}

function describeError(error: unknown): HeartbeatError {
  if (error instanceof RemoteError)
    return { status: error.status, code: error.code, message: error.message }
  return {
    status: 0,
    code: 'TRANSPORT_ERROR',
    message: error instanceof Error ? error.message : 'the transport failed'
  }
}

export const heartbeat: CommandHandler = async (args) => {
  const stateFile = required(args, '--state')
  const state = await readState(stateFile)
  const token = tokenFrom(stateFile, state)
  const runtime = runtimeFrom(args, state)
  const phase = phaseFrom(args)
  const lastError = flag(args, '--last-error')
  const stale = flag(args, '--stale')
  const requested = integerOption(args, '--sequence')
  // `--stale` re-sends the sequence the service already stored; an explicit --sequence can force an
  // even older one. Without a stored sequence there is nothing older to send.
  const start = requested ?? (stale ? runtime.sequence : runtime.sequence + 1)
  if (start < 1) fail('--stale needs a previous sequence: pass --sequence <n>')
  const count = stale ? 1 : (integerOption(args, '--count') ?? 1)
  const intervalMs = numberOption(args, '--interval-ms', 5000)

  const session = await openSession(args, 'student', token)
  try {
    let accepted = 0
    let rejected = 0
    let firstError: HeartbeatError | null = null
    let lastStatus = 0
    let lastAccepted: boolean | null = null
    let sequence = start
    for (let index = 0; index < count; index += 1) {
      if (index > 0) await delay(intervalMs)
      try {
        const response = await session.client.request<Schema<'HeartbeatResponse'>>(
          'postStudentHeartbeat',
          { body: heartbeatBody(runtime, sequence, phase, lastError) }
        )
        // A refused sequence is a 200 with heartbeatAccepted:false, so it is reported as a rejection
        // without being an error; conflating the two would hide the monotonic rule N6 depends on.
        lastStatus = 200
        lastAccepted = response.heartbeatAccepted
        if (response.heartbeatAccepted) accepted += 1
        else rejected += 1
      } catch (error) {
        // A service rejection is an observation. Anything else means the service could not be asked
        // at all, which is a driver-level failure rather than a result.
        if (!(error instanceof RemoteError)) throw error
        const described = describeError(error)
        if (!firstError) firstError = described
        lastStatus = described.status
        lastAccepted = null
        rejected += 1
      }
      sequence += 1
    }
    const lastSequence = sequence - 1
    await writeState(stateFile, {
      ...state,
      // A rejected attempt must not move the runtime backwards: the next process still has to offer
      // something higher than what the service stored.
      sequence: Math.max(runtime.sequence, lastSequence),
      runtimeId: runtime.runtimeId,
      runtimeGeneration: runtime.runtimeGeneration
    })
    return {
      deviceId: typeof state.deviceId === 'string' ? state.deviceId : null,
      sent: count,
      accepted,
      rejected,
      firstError,
      lastStatus,
      sequence: lastSequence,
      runtimeId: runtime.runtimeId,
      runtimeGeneration: runtime.runtimeGeneration,
      phase,
      stale,
      lastAccepted
    } satisfies HeartbeatReport
  } finally {
    await session.close()
  }
}

export const deviceList: CommandHandler = async (args) => {
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  try {
    const query: Record<string, string | boolean> = {}
    const q = option(args, '--q')
    if (q !== undefined) query.q = q
    const online = option(args, '--online')
    if (online !== undefined) {
      if (online !== 'true' && online !== 'false') fail('--online must be true or false')
      query.online = online === 'true'
    }
    const cursor = option(args, '--cursor')
    if (cursor !== undefined) query.cursor = cursor
    const list = await session.client.request<Schema<'DeviceList'>>('getTeacherDevices', { query })
    const items = list.items.map((device) => ({
      ...device,
      lastSeenAt: device.lastHeartbeatAt,
      phase: device.heartbeat?.phase ?? null
    }))
    // `Page` carries only `nextCursor`, so the API exposes no total; this is the size of the page the
    // service returned, which is what a case whose filter matches every device can compare against.
    return { items, nextCursor: list.nextCursor, total: items.length } satisfies DeviceListReport
  } finally {
    await session.close()
  }
}

export const heartbeatLoad: CommandHandler = async (args) => {
  const stateFile = required(args, '--state')
  const state = await readState(stateFile)
  const token = tokenFrom(stateFile, state)
  const clients = integerOption(args, '--clients')
  if (clients === undefined) fail('--clients is required')
  const seconds = numberOption(args, '--seconds', 0)
  if (seconds === 0) fail('--seconds is required')
  const intervalMs = numberOption(args, '--interval-ms', 5000)
  const runtime = runtimeFrom(args, state)
  const phase = phaseFrom(args)

  const sessions: Session[] = []
  try {
    // One transport per client: its own connection and its own scratch directory, so the service
    // sees the same shape of traffic as N independent student processes.
    for (let index = 0; index < clients; index += 1)
      sessions.push(await openSession(args, 'student', token))

    // Clients sharing a state file share one device credential, and the service keeps one heartbeat
    // row per credential, so they must also share the runtime and draw sequences from one counter. A
    // second runtime id at the generation the credential already holds is CONTENT_CONFLICT by
    // design, which is a protocol result and not load.
    let nextSequence = runtime.sequence + 1
    let sent = 0
    let accepted = 0
    let rejected = 0
    let inFlight = 0
    let maxInFlight = 0
    const errors: HeartbeatError[] = []
    const started = Date.now()
    const deadline = started + seconds * 1000
    await Promise.all(
      sessions.map(async (session) => {
        while (Date.now() < deadline) {
          const sequence = nextSequence
          nextSequence += 1
          inFlight += 1
          if (inFlight > maxInFlight) maxInFlight = inFlight
          sent += 1
          try {
            const response = await session.client.request<Schema<'HeartbeatResponse'>>(
              'postStudentHeartbeat',
              { body: heartbeatBody(runtime, sequence, phase, false) }
            )
            if (response.heartbeatAccepted) accepted += 1
            else rejected += 1
          } catch (error) {
            // N11 is about ports and handshakes under sustained load, so one failed request must not
            // end the run: it is counted and the client keeps its cadence.
            rejected += 1
            if (errors.length < ERROR_SAMPLE) errors.push(describeError(error))
          } finally {
            inFlight -= 1
          }
          await delay(intervalMs)
        }
      })
    )
    const elapsedMs = Date.now() - started
    await writeState(stateFile, {
      ...state,
      sequence: Math.max(runtime.sequence, nextSequence - 1),
      runtimeId: runtime.runtimeId,
      runtimeGeneration: runtime.runtimeGeneration
    })
    return {
      clients,
      seconds,
      intervalMs,
      sent,
      accepted,
      rejected,
      errors,
      maxInFlight,
      throughputPerSecond: elapsedMs > 0 ? Number((sent / (elapsedMs / 1000)).toFixed(2)) : sent,
      elapsedMs,
      sequence: nextSequence - 1
    } satisfies HeartbeatLoadReport
  } finally {
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)))
  }
}
