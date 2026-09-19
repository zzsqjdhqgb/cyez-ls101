/*
 * Maintenance mode for the lab protocol driver (docs/lab-vm-acceptance-design.md, N8/N10).
 *
 * `putTeacherServiceMode` is the only place the service decides whether it may leave maintenance, and
 * the decision is a list: every pending task, open enrollment, backup and unexpired task lease is a
 * `Blocker`, and a single one keeps the service in maintenance with 409 RESOURCE_BUSY. N10 is a
 * statement about that list — which resource blocks the exit and for how long — so the list is copied
 * out verbatim instead of being reduced to a code, and `maintenance-exit` records one entry per
 * attempt so the phase script can show the transition instead of only its end state.
 *
 * The nested location matters: the service puts blocking resources in `error.details.blockers`. The
 * shared `errorOf` reads the top-level envelope (and reports `blockers` from a key the service never
 * writes), so `blockersOf` below reads the details object directly.
 *
 * A refusal is an observation, not a driver failure: `--set normal` that the service rejects, or an
 * `maintenance-exit` that never succeeds, is reported with exit code 0 and judged by the phase script.
 * Only requests that never produced an HTTP status (pin mismatch, unreachable service, unusable
 * credentials) fail the process.
 *
 * mode
 *   --url <url> --fingerprint <sha256:…> --version <v> (--password-file <p> | --local-proof-file <p>)
 *   --set normal|maintenance [--expected-revision <n>]
 *     Reports { status, mode, modeRevision, code, message, blockers }. Without --expected-revision the
 *     current revision is read from `getTeacherService`, because a stale revision is refused as
 *     REVISION_CONFLICT and says nothing about the mode.
 *
 * mode --read | --get
 *   --url --fingerprint --version (--password-file <p> | --local-proof-file <p>)
 *     Reports `getTeacherService` only: { status, mode, modeRevision, code, message, blockers }.
 *
 * maintenance-exit
 *   --url --fingerprint --version (--password-file <p> | --local-proof-file <p>)
 *   [--attempts <n>] [--interval-ms <n>]
 *     Tries `mode: normal` up to --attempts times, --interval-ms apart, and stops at the first
 *     accepted exit (spending the remaining attempts on a service that already left maintenance
 *     would only add noise). Reports { attempts: [{ at, status, mode, modeRevision, code, message,
 *     blockers }], final, attempted }. `at` is the service's own clock when it answers one, so the
 *     attempt can be lined up against the lease deadline that is blocking it.
 *
 * test-run
 *   --url --fingerprint --version (--password-file <p> | --local-proof-file <p>)
 *   --device-id <uuid> [--device-id <uuid> …] [--suite <id>] [--case <id> …]
 *   [--expires-seconds <n>] [--cancel <runId>]
 *     The deployment test run N10 needs: a task has to exist before a device can claim it and hold
 *     the 30 s lease that keeps the exit blocked. A run is creatable only in maintenance mode
 *     (`postTeacherTestRuns` authorises maintenance), and `--cancel` is the teacher's cancel of a run
 *     whose device is already offline. `expiresAt` is computed from the service's own clock, because
 *     a driver clock ahead of the service would create a run that is expired on arrival.
 *     Reports { action: 'create', runId, status, code, message, suiteId, expiresAt,
 *     devices: [{ deviceId, taskId, status }] }, or { action: 'cancel', runId, status, code, message }.
 *     A cancelled run is reported, never thrown; a create the phase cannot continue without is not.
 */
import { randomUUID } from 'node:crypto'
import {
  errorOf,
  fail,
  flag,
  isRecord,
  numberOption,
  openTeacher,
  option,
  type CommandHandler,
  type Session
} from '../context'

const DEFAULT_ATTEMPTS = 4
const DEFAULT_INTERVAL_MS = 1000
const DEFAULT_SUITE = 'ls101-lab-deployment'
const DEFAULT_CASE = 'identity'
const DEFAULT_EXPIRES_SECONDS = 600

interface Observation {
  status: number
  mode: string | null
  modeRevision: number | null
  code: string | null
  message: string | null
  blockers: unknown[]
}

interface Attempt extends Observation {
  at: string
}

function detailsOf(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined
  return isRecord(body.error.details) ? body.error.details : undefined
}

function blockersOf(body: unknown): unknown[] {
  const blockers = detailsOf(body)?.blockers
  return Array.isArray(blockers) ? blockers : []
}

function observe(result: { status: number; body?: unknown }): Observation {
  const error = errorOf(result)
  const body = isRecord(result.body) ? result.body : undefined
  const details = detailsOf(result.body)
  const mode = typeof body?.mode === 'string' ? body.mode : details?.mode
  const revision = body?.modeRevision ?? details?.modeRevision
  return {
    status: result.status,
    mode: typeof mode === 'string' ? mode : null,
    modeRevision: typeof revision === 'number' ? revision : null,
    code: error.code ?? null,
    message: error.message ?? null,
    blockers: blockersOf(result.body)
  }
}

function expectedRevision(args: string[]): number | undefined {
  const raw = option(args, '--expected-revision')
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1)
    fail('--expected-revision must be a positive integer')
  return value
}

// Every attempt re-reads the revision: an accepted exit bumps it, a refused one does not, so a single
// read up front would turn the second attempt into a REVISION_CONFLICT instead of a blocker report.
async function serviceState(
  session: Session
): Promise<{ revision: number; serverTime: string | null }> {
  const result = await session.transport.request(session.connectionId, 'getTeacherService', {})
  const observed = observe(result)
  const body = isRecord(result.body) ? result.body : undefined
  const revision = observed.modeRevision
  if (result.status !== 200 || revision === null)
    fail(
      `the service state could not be read: ${result.status} ${observed.code ?? 'unknown error'}`
    )
  return {
    revision,
    serverTime: typeof body?.serverTime === 'string' ? body.serverTime : null
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

type ModeCommand = { read: true } | { read: false; set: 'normal' | 'maintenance' }

function modeCommand(args: string[]): ModeCommand {
  const read = flag(args, '--read') || flag(args, '--get')
  const set = option(args, '--set')
  if (read) {
    if (set !== undefined) fail('--read and --set are mutually exclusive')
    return { read: true }
  }
  if (set !== 'normal' && set !== 'maintenance')
    fail('mode requires --set normal|maintenance, or --read')
  return { read: false, set }
}

export const mode: CommandHandler = async (args) => {
  const command = modeCommand(args)
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  try {
    if (command.read)
      return observe(await session.transport.request(session.connectionId, 'getTeacherService', {}))
    const revision = expectedRevision(args) ?? (await serviceState(session)).revision
    const result = await session.transport.request(session.connectionId, 'putTeacherServiceMode', {
      body: { mode: command.set, expectedRevision: revision }
    })
    return observe(result)
  } finally {
    await session.close()
  }
}

export const maintenanceExit: CommandHandler = async (args) => {
  const attempts = numberOption(args, '--attempts', DEFAULT_ATTEMPTS)
  if (!Number.isSafeInteger(attempts)) fail('--attempts must be an integer')
  const intervalMs = numberOption(args, '--interval-ms', DEFAULT_INTERVAL_MS)
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  const attemptsMade: Attempt[] = []
  try {
    for (let index = 0; index < attempts; index++) {
      const state = await serviceState(session)
      const result = await session.transport.request(
        session.connectionId,
        'putTeacherServiceMode',
        {
          body: { mode: 'normal', expectedRevision: state.revision }
        }
      )
      attemptsMade.push({
        at: state.serverTime ?? new Date().toISOString(),
        ...observe(result)
      })
      if (result.status < 400) break
      if (index + 1 < attempts) await delay(intervalMs)
    }
    const final = attemptsMade[attemptsMade.length - 1] ?? fail('maintenance-exit made no attempt')
    return { attempts: attemptsMade, final, attempted: attemptsMade.length }
  } finally {
    await session.close()
  }
}

// `option()` answers with the first occurrence; this command takes a list, so the whole argv is
// scanned and every `--name value` pair is collected.
function listOption(args: string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== name) continue
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`)
    values.push(value)
    index++
  }
  return values
}

// The reported device entries are read field by field: a run whose task is missing should show up as
// an absent task id in the evidence rather than as a crash in the driver.
function runDevices(body: unknown): Array<{
  deviceId: string | null
  taskId: string | null
  status: string | null
}> {
  if (!isRecord(body) || !Array.isArray(body.devices)) return []
  return body.devices.map((entry) => {
    const device = isRecord(entry) && isRecord(entry.device) ? entry.device : undefined
    const task = isRecord(entry) && isRecord(entry.task) ? entry.task : undefined
    return {
      deviceId: typeof device?.id === 'string' ? device.id : null,
      taskId: typeof task?.id === 'string' ? task.id : null,
      status: typeof task?.status === 'string' ? task.status : null
    }
  })
}

export const testRun: CommandHandler = async (args) => {
  const cancel = option(args, '--cancel')
  const deviceIds = listOption(args, '--device-id')
  if (cancel && deviceIds.length) fail('--cancel and --device-id are mutually exclusive')
  if (!cancel && deviceIds.length === 0) fail('test-run requires --device-id, or --cancel <runId>')
  const session = await openTeacher(args, {
    passwordFile: option(args, '--password-file'),
    localProofFile: option(args, '--local-proof-file')
  })
  try {
    if (cancel) {
      const result = await session.transport.request(
        session.connectionId,
        'postTeacherTestRunsIdCancel',
        { path: { id: cancel } }
      )
      const error = errorOf(result)
      return {
        action: 'cancel',
        runId: cancel,
        status: result.status,
        code: error.code ?? null,
        message: error.message ?? null
      }
    }
    const service = await session.transport.request(session.connectionId, 'getTeacherService', {})
    const state = isRecord(service.body) ? service.body : undefined
    const reported = typeof state?.serverTime === 'string' ? Date.parse(state.serverTime) : NaN
    const serverTime = Number.isNaN(reported) ? Date.now() : reported
    const expiresSeconds = numberOption(args, '--expires-seconds', DEFAULT_EXPIRES_SECONDS)
    if (!Number.isSafeInteger(expiresSeconds)) fail('--expires-seconds must be an integer')
    const caseIds = listOption(args, '--case')
    const result = await session.transport.request(session.connectionId, 'postTeacherTestRuns', {
      body: {
        suiteId: option(args, '--suite') ?? DEFAULT_SUITE,
        caseIds: caseIds.length ? caseIds : [DEFAULT_CASE],
        deviceIds,
        expiresAt: new Date(serverTime + expiresSeconds * 1000).toISOString()
      },
      idempotencyKey: randomUUID()
    })
    const error = errorOf(result)
    // A run the phase cannot create is a setup failure: without it there is no task to claim, so the
    // lease N10 is about would never exist and every later assertion would be about nothing.
    if (result.status >= 400)
      fail(`the test run was refused: ${result.status} ${error.code ?? 'unknown error'}`)
    const body = isRecord(result.body) ? result.body : undefined
    return {
      action: 'create',
      runId: typeof body?.id === 'string' ? body.id : null,
      status: result.status,
      code: null,
      message: null,
      suiteId: typeof body?.suiteId === 'string' ? body.suiteId : null,
      expiresAt: typeof body?.expiresAt === 'string' ? body.expiresAt : null,
      devices: runDevices(result.body)
    }
  } finally {
    await session.close()
  }
}
