/*
 * N6 and N11 against the real service in-process (docs/lab-vm-acceptance-design.md §6, Tier 2).
 *
 * The harness injects the clock the service reads, so the 20 s offline window is exercised by moving
 * that clock rather than by waiting: the case is about the service's boundary, and a spec that slept
 * for it would only prove that the test can count seconds.
 *
 * The device fixtures are registered the way a student device really registers — an enrollment batch
 * signed by the service, then a device credential — so the heartbeats travel on a credential the
 * product issued rather than on a row inserted behind its back. `enroll-register` covers the same
 * ground as a driver command for the VM run; this spec must stay runnable on its own.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { DEVICE_OFFLINE_AFTER_MS } from '../../../packages/lab-server/src/devices'
import type { Schema } from '../../../packages/lab-contracts/src'
import { HARNESS_PASSWORD, installationId, startHarness, type Harness } from './harness'
import { openSession, openTeacher, readState, writeState, type CommandHandler } from './context'
import {
  deviceList,
  heartbeat,
  heartbeatLoad,
  type DeviceListEntry,
  type DeviceListReport,
  type HeartbeatLoadReport,
  type HeartbeatReport
} from './commands/heartbeat'

interface Fixture {
  stateFile: string
  deviceId: string
  number: string
}

// Command handlers report an observation as `unknown`; the cases below name the shape they assert.
async function run<T>(handler: CommandHandler, args: string[]): Promise<T> {
  return (await handler(args)) as T
}

describe('N6 heartbeat liveness and N11 heartbeat load', () => {
  let harness: Harness
  let primary: Fixture
  let load: Fixture
  let passwordFile: string

  async function registerFixture(name: string, enrollFile: string): Promise<Fixture> {
    const deviceSecret = randomBytes(32).toString('base64url')
    const installation = installationId()
    const session = await openSession(harness.args(), 'public')
    let registered: Schema<'RegisteredDevice'>
    try {
      registered = await session.client.request<Schema<'RegisteredDevice'>>(
        'putEnrollmentDevicesInstallationId',
        {
          path: { installationId: installation },
          body: {
            enrollmentFile: enrollFile,
            deviceSecret,
            computerName: 'protocol-fixture',
            platform: process.platform === 'win32' ? 'win32' : 'linux',
            releaseVersion: harness.version
          }
        }
      )
    } finally {
      await session.close()
    }
    const stateFile = harness.path(`${name}.state.json`)
    // The state file is the enrollment command's contract; the heartbeat command extends it with the
    // runtime identity so a later process continues the same runtime.
    await writeState(stateFile, {
      installationId: installation,
      deviceId: registered.deviceId,
      number: registered.deviceNumber,
      duplicate: false,
      deviceSecret,
      token: `d.${registered.deviceId}.${deviceSecret}`,
      enrollFile,
      releaseVersion: harness.version
    })
    return { stateFile, deviceId: registered.deviceId, number: registered.deviceNumber }
  }

  async function deviceOf(fixture: Fixture): Promise<DeviceListEntry> {
    const report = await run<DeviceListReport>(
      deviceList,
      harness.args(['--password-file', passwordFile])
    )
    const entry = report.items.find((device) => device.id === fixture.deviceId)
    if (!entry) throw new Error('the device under test is missing from the teacher device list')
    return entry
  }

  beforeAll(async () => {
    harness = await startHarness()
    passwordFile = await harness.secret('teacher-password', HARNESS_PASSWORD)
    const teacher = await openTeacher(harness.args(), { passwordFile })
    try {
      const created = await teacher.client.request<Schema<'EnrollmentCreated'>>(
        'postTeacherEnrollments',
        { body: { expectedModeRevision: 1, validForSeconds: 600 }, idempotencyKey: randomUUID() }
      )
      const archive = await teacher.client.request<{ handle: string }>(
        'getTeacherEnrollmentsIdFile',
        { path: { id: created.enrollment.id } }
      )
      // Whole-file equality is the enrollment credential, so both fixtures must use these exact bytes.
      const enrollFile = (await readFile(teacher.transport.file(archive.handle), 'utf8')).trim()
      primary = await registerFixture('n6', enrollFile)
      load = await registerFixture('n11', enrollFile)
      await teacher.client.request('deleteTeacherEnrollmentsId', {
        path: { id: created.enrollment.id }
      })
    } finally {
      await teacher.close()
    }
  }, 60000)

  afterAll(async () => {
    await harness?.close()
  })

  test('one heartbeat makes the device online in the teacher device list', async () => {
    const result = await run<HeartbeatReport>(
      heartbeat,
      harness.args(['--state', primary.stateFile])
    )
    expect(result).toMatchObject({
      deviceId: primary.deviceId,
      sent: 1,
      accepted: 1,
      rejected: 0,
      firstError: null,
      lastStatus: 200,
      sequence: 1,
      runtimeGeneration: 1,
      phase: 'idle',
      stale: false,
      lastAccepted: true
    })
    const device = await deviceOf(primary)
    expect(device).toMatchObject({
      id: primary.deviceId,
      number: primary.number,
      online: true,
      enabled: true,
      phase: 'idle'
    })
    expect(device.lastHeartbeatAt).not.toBeNull()
    expect(device.lastSeenAt).toBe(device.lastHeartbeatAt)
    expect(device.heartbeat?.runtimeId).toBe(result.runtimeId)
  })

  test('the offline threshold is the boundary, and the last known values survive it', async () => {
    const online = await deviceOf(primary)
    harness.clock.advance(DEVICE_OFFLINE_AFTER_MS - 1)
    expect((await deviceOf(primary)).online).toBe(true)
    // Exactly at the threshold the server already calls the device offline: the comparison is
    // `acceptedAt > now - DEVICE_OFFLINE_AFTER_MS`, so the window is half-open and 20 s is offline.
    harness.clock.advance(1)
    const offline = await deviceOf(primary)
    expect(DEVICE_OFFLINE_AFTER_MS).toBe(20000)
    expect(offline.online).toBe(false)
    // Going offline is a visibility change, not a reset: every last known value is still reported.
    expect(offline.lastHeartbeatAt).toBe(online.lastHeartbeatAt)
    expect(offline.lastSeenAt).toBe(online.lastSeenAt)
    expect(offline.number).toBe(primary.number)
    expect(offline.phase).toBe('idle')
    expect(offline.heartbeat).toMatchObject({
      runtimeId: online.heartbeat?.runtimeId,
      sequence: 1,
      phase: 'idle',
      submissionSummary: { waitingFirstUpload: 0, unconfirmed: 0, failed: 0 }
    })
  })

  test('a repeated sequence is refused without an error code and does not move lastSeenAt', async () => {
    const accepted = await run<HeartbeatReport>(
      heartbeat,
      harness.args(['--state', primary.stateFile])
    )
    expect(accepted).toMatchObject({ accepted: 1, rejected: 0, sequence: 2 })
    const before = await deviceOf(primary)
    harness.clock.advance(1000)
    const repeated = await run<HeartbeatReport>(
      heartbeat,
      harness.args(['--state', primary.stateFile, '--sequence', '2'])
    )
    // The real answer for a non-increasing sequence is HTTP 200 with heartbeatAccepted:false, not a
    // CONTENT_CONFLICT error: the request succeeded and the observation was simply not stored.
    expect(repeated).toMatchObject({
      sent: 1,
      accepted: 0,
      rejected: 1,
      firstError: null,
      lastStatus: 200,
      lastAccepted: false
    })
    const after = await deviceOf(primary)
    expect(after.lastHeartbeatAt).toBe(before.lastHeartbeatAt)
    // The refused beat is still inside the window, so it is the refusal that kept the record still.
    expect(after.online).toBe(true)
  })

  test('a higher sequence for the same runtime is accepted', async () => {
    const before = await deviceOf(primary)
    harness.clock.advance(1000)
    const result = await run<HeartbeatReport>(
      heartbeat,
      harness.args(['--state', primary.stateFile])
    )
    expect(result).toMatchObject({ accepted: 1, rejected: 0, sequence: 3 })
    const after = await deviceOf(primary)
    expect(after.lastHeartbeatAt).not.toBe(before.lastHeartbeatAt)
    expect(after.heartbeat?.sequence).toBe(3)
  })

  test('--stale re-sends the stored sequence and reports the refusal', async () => {
    const before = await deviceOf(primary)
    harness.clock.advance(1000)
    const stale = await run<HeartbeatReport>(
      heartbeat,
      harness.args(['--state', primary.stateFile, '--stale'])
    )
    expect(stale).toMatchObject({
      sent: 1,
      accepted: 0,
      rejected: 1,
      firstError: null,
      lastStatus: 200,
      lastAccepted: false,
      stale: true
    })
    expect((await deviceOf(primary)).lastHeartbeatAt).toBe(before.lastHeartbeatAt)
  })

  test('the generation orders runtimes, and the same generation with a new runtime conflicts', async () => {
    const state = await readState(primary.stateFile)
    const runtimeId = String(state.runtimeId)
    // A higher generation is how the student runtime announces a restart of the same installation.
    const bumped = await run<HeartbeatReport>(
      heartbeat,
      harness.args([
        '--state',
        primary.stateFile,
        '--runtime-id',
        runtimeId,
        '--runtime-generation',
        '5',
        '--sequence',
        '1'
      ])
    )
    expect(bumped).toMatchObject({ accepted: 1, rejected: 0, runtimeGeneration: 5 })
    const before = await deviceOf(primary)
    harness.clock.advance(1000)
    // A lower generation for the same runtime is refused as stale rather than as a conflict.
    const lower = await run<HeartbeatReport>(
      heartbeat,
      harness.args([
        '--state',
        primary.stateFile,
        '--runtime-id',
        runtimeId,
        '--runtime-generation',
        '2',
        '--sequence',
        '1'
      ])
    )
    expect(lower).toMatchObject({
      accepted: 0,
      rejected: 1,
      firstError: null,
      lastStatus: 200,
      lastAccepted: false
    })
    expect((await deviceOf(primary)).lastHeartbeatAt).toBe(before.lastHeartbeatAt)
    // The conflict is a *different* runtime id at the generation the credential already holds: one
    // device credential owns exactly one runtime, so the runtime may only be replaced by moving the
    // generation, which is what a reinstall does.
    const conflict = await run<HeartbeatReport>(
      heartbeat,
      harness.args([
        '--state',
        primary.stateFile,
        '--runtime-id',
        randomUUID(),
        '--runtime-generation',
        '5',
        '--sequence',
        '1'
      ])
    )
    expect(conflict).toMatchObject({
      accepted: 0,
      rejected: 1,
      lastStatus: 409,
      firstError: { status: 409, code: 'CONTENT_CONFLICT' },
      lastAccepted: null
    })
    expect((await deviceOf(primary)).lastHeartbeatAt).toBe(before.lastHeartbeatAt)
    // A newer generation does authorise a different runtime, which is how the row is replaced.
    const takeover = await run<HeartbeatReport>(
      heartbeat,
      harness.args([
        '--state',
        primary.stateFile,
        '--runtime-id',
        randomUUID(),
        '--runtime-generation',
        '6',
        '--sequence',
        '1'
      ])
    )
    expect(takeover).toMatchObject({ accepted: 1, rejected: 0, runtimeGeneration: 6 })
  })

  test('heartbeat-load with three clients runs cleanly at 200 ms for two seconds', async () => {
    const result = await run<HeartbeatLoadReport>(
      heartbeatLoad,
      harness.args([
        '--state',
        load.stateFile,
        '--clients',
        '3',
        '--seconds',
        '2',
        '--interval-ms',
        '200'
      ])
    )
    expect(result.clients).toBe(3)
    expect(result.seconds).toBe(2)
    expect(result.intervalMs).toBe(200)
    // Three clients at 200 ms for two seconds is ten beats each; scheduling may drop the last one.
    // A client may also overshoot by one beat if a timer fires a millisecond early.
    expect(result.sent).toBeGreaterThanOrEqual(24)
    expect(result.sent).toBeLessThanOrEqual(36)
    expect(result.accepted + result.rejected).toBe(result.sent)
    expect(result.accepted).toBeGreaterThan(0)
    expect(result.errors).toEqual([])
    expect(result.maxInFlight).toBeGreaterThan(1)
    expect(result.maxInFlight).toBeLessThanOrEqual(3)
    expect(result.throughputPerSecond).toBeGreaterThan(0)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(2000)
    const device = await deviceOf(load)
    expect(device.online).toBe(true)
    // The stored sequence is the highest beat the service accepted, never the highest one offered:
    // a beat that lost the arrival race is refused, so the two may differ by one.
    expect(device.heartbeat?.sequence).toBeGreaterThan(0)
    expect(device.heartbeat?.sequence).toBeLessThanOrEqual(result.sequence)
  })

  test('--count sends consecutive sequences and --last-error is stored with the observation', async () => {
    const before = await deviceOf(load)
    const result = await run<HeartbeatReport>(
      heartbeat,
      harness.args([
        '--state',
        load.stateFile,
        '--count',
        '2',
        '--interval-ms',
        '10',
        '--last-error'
      ])
    )
    expect(result).toMatchObject({ sent: 2, accepted: 2, rejected: 0, firstError: null })
    const device = await deviceOf(load)
    const stored = device.heartbeat?.sequence ?? 0
    const previous = before.heartbeat?.sequence ?? 0
    // Consecutive beats, and the last one is the observation the service kept.
    expect(stored).toBe(result.sequence)
    expect(stored).toBeGreaterThan(previous)
    // `lastError` is part of the observation the teacher list reports, so a diagnostic the student
    // sends has to survive the round trip rather than being dropped by the service.
    expect(device.heartbeat?.lastError).toMatchObject({ code: 'DRIVER_REPORTED' })
  })

  test('the device credential is found under either state-file key', async () => {
    const { token, ...rest } = await readState(load.stateFile)
    const alternate = harness.path('n11.bearer.state.json')
    // The enrollment command may name the same credential `token`, `bearerToken` or an
    // `authorization` header; a phase chaining enrollment into a heartbeat must not care which. The
    // alternate file has to carry the runtime the state file already reached, or it would present
    // itself as a second runtime on the same credential.
    await writeState(alternate, {
      ...rest,
      bearerToken: token,
      authorization: `Bearer ${String(token)}`
    })
    const result = await run<HeartbeatReport>(heartbeat, harness.args(['--state', alternate]))
    expect(result).toMatchObject({ accepted: 1, rejected: 0 })
  })
})
