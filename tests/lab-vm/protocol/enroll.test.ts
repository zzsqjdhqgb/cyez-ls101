/*
 * Enrollment cases for the lab protocol driver (docs/lab-vm-acceptance-design.md, N3/N4/N5).
 *
 * These run the driver's own commands — not a second implementation of them — against the real
 * `LabService` and the real HTTPS server from `harness.ts`. The VM phase repeats the same commands as
 * separate processes and across a real network; what can be proven in-container is the protocol
 * behaviour, the byte-equality rule and the exact status and error codes the phase will assert on.
 *
 * `harness.clock` is the service's clock, so the expiry case ages a batch in milliseconds here and the
 * VM ages it with a short `--valid-for-seconds` and a wait.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HARNESS_PASSWORD, readSecretFile, startHarness, type Harness } from './harness'
import { isRecord, openSession, openTeacher, readState, sha256Hex } from './context'
import { enrollIssue, enrollRegister, enrollReject } from './commands/enroll'

let harness: Harness
let workspace: string
let passwordFile: string

beforeEach(async () => {
  harness = await startHarness()
  workspace = await mkdtemp(join(tmpdir(), 'ls101-enrollment-spec-'))
  passwordFile = await harness.secret('password', HARNESS_PASSWORD)
})

afterEach(async () => {
  await harness.close()
  await rm(workspace, { recursive: true, force: true })
})

function record(value: unknown, description: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${description} was not a JSON object`)
  return value
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected a string')
  return value
}

function items(body: unknown, description: string): Record<string, unknown>[] {
  const page = record(body, description)
  if (!Array.isArray(page.items)) throw new Error(`${description} had no items`)
  return page.items.filter(isRecord)
}

async function issue(extra: string[] = []): Promise<Record<string, unknown>> {
  const out = join(workspace, `batch-${randomUUID()}.lsjoin`)
  return record(
    await enrollIssue(harness.args(['--password-file', passwordFile, '--out', out, ...extra])),
    'enroll-issue'
  )
}

async function register(
  enrollFile: string,
  installation: string,
  computerName: string,
  extra: string[] = []
): Promise<Record<string, unknown>> {
  const stateOut = join(workspace, `state-${installation}.json`)
  return record(
    await enrollRegister(
      harness.args([
        '--enroll-file',
        enrollFile,
        '--computer-name',
        computerName,
        '--state-out',
        stateOut,
        ...extra
      ])
    ),
    'enroll-register'
  )
}

async function reject(extra: string[]): Promise<Record<string, unknown>> {
  return record(await enrollReject(harness.args(extra)), 'enroll-reject')
}

// Read through the product's own teacher session rather than from the database, so "the replay did
// not add a device" is asserted on the list the teacher actually sees.
async function listDevices(): Promise<Record<string, unknown>[]> {
  const session = await openTeacher(harness.args(), { passwordFile })
  try {
    const response = await session.transport.request(session.connectionId, 'getTeacherDevices', {
      query: { limit: 200 }
    })
    expect(response.status).toBe(200)
    return items(response.body, 'the device list')
  } finally {
    await session.close()
  }
}

async function listEnrollments(): Promise<Record<string, unknown>[]> {
  const session = await openTeacher(harness.args(), { passwordFile })
  try {
    const response = await session.transport.request(
      session.connectionId,
      'getTeacherEnrollments',
      {
        query: { limit: 200 }
      }
    )
    expect(response.status).toBe(200)
    return items(response.body, 'the enrollment list')
  } finally {
    await session.close()
  }
}

// Only one batch is open at a time, so a file that belongs to a *different* enrollment always comes
// from a batch that was closed or that expired.
async function revoke(id: string): Promise<void> {
  const session = await openTeacher(harness.args(), { passwordFile })
  try {
    const response = await session.transport.request(
      session.connectionId,
      'deleteTeacherEnrollmentsId',
      { path: { id } }
    )
    expect(response.status).toBe(204)
  } finally {
    await session.close()
  }
}

describe('enrollment issuance and registration', () => {
  it('issues a batch whose downloaded bytes are exactly the file the service signed', async () => {
    const issued = await issue()
    const id = text(issued.enrollmentId)
    const out = text(issued.out)
    const stored = harness.service.db.get<{ signed_file: string }>(
      'SELECT signed_file FROM enrollments WHERE id=?',
      id
    )
    expect(stored).toBeDefined()
    const signed = stored!.signed_file
    expect(signed.split('.')).toHaveLength(3)
    expect(await readFile(out, 'utf8')).toBe(signed)
    expect(issued).toMatchObject({ status: 201, state: 'active', mode: 'maintenance' })
    expect(issued.bytes).toBe(Buffer.byteLength(signed))
    expect(issued.sha256).toBe(sha256Hex(signed))
    expect(issued.downloadSha256).toBe(issued.sha256)
    expect(issued.listed).toMatchObject({ id, status: 'active', registeredCount: 0 })
    expect(record(issued.listed, 'the list entry').expiresAt).toBe(issued.expiresAt)
  })

  it('replays an issued batch for the same idempotency key instead of opening a second one', async () => {
    const key = randomUUID()
    const first = await issue(['--expected-mode-revision', '1', '--idempotency-key', key])
    const second = await issue(['--expected-mode-revision', '1', '--idempotency-key', key])
    expect(second.enrollmentId).toBe(first.enrollmentId)
    expect(second.status).toBe(201)
    expect(second.sha256).toBe(first.sha256)
    expect(await listEnrollments()).toHaveLength(1)
  })

  it('registers two hostnames as two devices', async () => {
    const issued = await issue()
    const enrollmentFile = text(issued.out)
    const first = await register(enrollmentFile, randomUUID(), 'lab-01')
    const second = await register(enrollmentFile, randomUUID(), 'lab-02')
    expect(first).toMatchObject({ status: 200 })
    expect(second).toMatchObject({ status: 200 })
    expect(first.deviceId).not.toBe(second.deviceId)
    const devices = await listDevices()
    expect(devices.map((device) => device.id).sort()).toEqual(
      [first.deviceId, second.deviceId].sort()
    )
    expect(devices.map((device) => device.number).sort()).toEqual(
      [first.number, second.number].sort()
    )
    expect(
      (await listEnrollments()).find((entry) => entry.id === issued.enrollmentId)
    ).toMatchObject({ registeredCount: 2 })
  })

  it('reconnects the same hostname without adding a device', async () => {
    const issued = await issue()
    const enrollmentFile = text(issued.out)
    const installation = randomUUID()
    const secretFile = harness.path(`replay-${installation}.secret`)
    const first = await register(enrollmentFile, installation, 'lab-01', [
      '--device-secret-file',
      secretFile
    ])
    const replay = await register(enrollmentFile, installation, 'lab-01', [
      '--device-secret-file',
      secretFile
    ])
    expect(first.status).toBe(200)
    expect(replay).toMatchObject({ status: 200 })
    expect(replay.deviceId).toBe(first.deviceId)
    expect(replay.number).toBe(first.number)
    expect(await listDevices()).toHaveLength(1)
    expect(
      (await listEnrollments()).find((entry) => entry.id === issued.enrollmentId)
    ).toMatchObject({ registeredCount: 1 })
  })

  it('persists a usable device identity and never reports the secret', async () => {
    const issued = await issue()
    const installation = randomUUID()
    const secretFile = harness.path('device.secret')
    const registered = await register(text(issued.out), installation, 'lab-01', [
      '--device-secret-file',
      secretFile
    ])
    const stateOut = text(registered.stateOut)
    const state = await readState(stateOut)
    const deviceSecret = await readSecretFile(secretFile)
    expect(deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(state).toMatchObject({
      deviceId: registered.deviceId,
      deviceNumber: registered.number,
      number: registered.number,
      deviceSecret,
      bearerToken: `d.${registered.deviceId}.${deviceSecret}`,
      token: `d.${registered.deviceId}.${deviceSecret}`,
      authorization: `Bearer d.${registered.deviceId}.${deviceSecret}`,
      enrollFile: text(issued.out),
      enrollFileSha256: sha256Hex(await readFile(text(issued.out))),
      url: harness.baseUrl,
      fingerprint: harness.fingerprint,
      serverId: harness.serverId,
      version: harness.version,
      releaseVersion: harness.version
    })
    // Windows stat().mode does not describe NTFS ACLs; Node only exposes coarse read/write bits.
    // Check POSIX permissions on POSIX hosts, retaining all credential assertions on Windows.
    if (process.platform !== 'win32') expect((await stat(stateOut)).mode & 0o777).toBe(0o600)
    // The driver prints this report, so a secret or a token in it would be a leak.
    expect(JSON.stringify(registered)).not.toContain(deviceSecret)
    // The token is the real credential, not a plausible-looking string.
    const token = `d.${text(registered.deviceId)}.${deviceSecret}`
    const session = await openSession(harness.args(), 'student', token)
    try {
      const response = await session.transport.request(session.connectionId, 'getStudentState', {})
      expect(response.status).toBe(200)
      expect(record(response.body, 'the student state').device).toMatchObject({
        id: registered.deviceId,
        number: registered.number
      })
    } finally {
      await session.close()
    }
  })
})

describe('enrollment negatives', () => {
  it('reuses the hostname identity even when no local identity files survive', async () => {
    const issued = await issue()
    const first = await register(text(issued.out), randomUUID(), 'lab-01')
    const restored = await register(text(issued.out), randomUUID(), 'LAB-01')
    expect(restored.deviceId).toBe(first.deviceId)
    expect(restored.number).toBe(first.number)
    expect(await listDevices()).toHaveLength(1)
  })

  it('rejects a one-byte mutation of a file the same batch accepts unchanged', async () => {
    const issued = await issue()
    const enrollmentFile = text(issued.out)
    const response = await reject([
      '--enroll-file',
      enrollmentFile,
      '--computer-name',
      randomUUID(),
      '--mutate',
      'one-byte'
    ])
    expect(response).toMatchObject({ accepted: false, status: 403, code: 'ENROLLMENT_REJECTED' })
    const mutation = record(response.mutation, 'the mutation')
    const held = record(response.heldFile, 'the held file')
    expect(mutation.offset).toBe(Math.floor(Number(held.bytes) / 2))
    expect(mutation.after).toBe(Number(mutation.before) ^ 0x01)
    expect(mutation.mutatedSha256).not.toBe(mutation.originalSha256)
    expect(record(response.submitted, 'the submitted file').sha256).toBe(mutation.mutatedSha256)
    // The unmutated original still registers, so the refusal is attributable to the changed byte
    // rather than to the batch, the transport or the driver.
    expect((await register(enrollmentFile, randomUUID(), 'lab-after-mutation')).status).toBe(200)
  })

  it('rejects a validly signed file issued for a different enrollment', async () => {
    const first = await issue()
    await revoke(text(first.enrollmentId))
    const second = await issue()
    const response = await reject([
      '--enroll-file',
      text(second.out),
      '--from-other-enrollment',
      text(first.out),
      '--computer-name',
      randomUUID()
    ])
    expect(response).toMatchObject({ accepted: false, status: 403, code: 'ENROLLMENT_REJECTED' })
    expect(record(response.submitted, 'the submitted file').sha256).not.toBe(
      record(response.heldFile, 'the held file').sha256
    )
  })

  it('rejects a batch that was revoked', async () => {
    const issued = await issue()
    const response = await reject([
      '--enroll-file',
      text(issued.out),
      '--computer-name',
      randomUUID(),
      '--revoke-first',
      '--enrollment-id',
      text(issued.enrollmentId),
      '--password-file',
      passwordFile
    ])
    expect(response).toMatchObject({ accepted: false, status: 403, code: 'ENROLLMENT_REJECTED' })
    expect(record(response.revoke, 'the revocation')).toMatchObject({
      enrollmentId: issued.enrollmentId,
      status: 204
    })
    expect(
      (await listEnrollments()).find((entry) => entry.id === issued.enrollmentId)
    ).toMatchObject({ status: 'revoked' })
  })

  it('rejects a batch once its validity has passed on the service clock', async () => {
    const issued = await issue(['--valid-for-seconds', '1'])
    harness.clock.advance(2000)
    const response = await reject([
      '--enroll-file',
      text(issued.out),
      '--computer-name',
      randomUUID(),
      '--expect-expired'
    ])
    expect(response).toMatchObject({ accepted: false, status: 403, code: 'ENROLLMENT_REJECTED' })
    expect(response.expired).toEqual({ status: 403, code: 'ENROLLMENT_REJECTED' })
    expect(
      (await listEnrollments()).find((entry) => entry.id === issued.enrollmentId)
    ).toMatchObject({ status: 'expired' })
  })

  it('rejects a registration whose release version the service does not run', async () => {
    const issued = await issue()
    const response = await reject([
      '--enroll-file',
      text(issued.out),
      '--computer-name',
      randomUUID(),
      '--release-version',
      '9.9.9'
    ])
    expect(response).toMatchObject({
      accepted: false,
      status: 409,
      code: 'VERSION_MISMATCH',
      releaseVersion: '9.9.9'
    })
  })

  it('refuses a wrong pin before any request and names the pin rather than the enrollment', async () => {
    const issued = await issue()
    // Counted on the server, so "nothing was sent" is the service's observation rather than the
    // client's account of itself.
    let requests = 0
    harness.server.on('request', () => {
      requests++
    })
    let connections = 0
    harness.server.on('connection', () => {
      connections++
    })
    const response = await record(
      await enrollReject([
        '--url',
        harness.baseUrl,
        '--fingerprint',
        `sha256:${'0'.repeat(64)}`,
        '--version',
        harness.version,
        '--enroll-file',
        text(issued.out),
        '--computer-name',
        randomUUID()
      ]),
      'enroll-reject'
    )
    expect(response).toMatchObject({ accepted: false, status: 0, code: 'TLS_PIN_MISMATCH' })
    expect(text(response.message)).toMatch(/public key/i)
    expect(text(response.message)).not.toMatch(/enrollment/i)
    // The client reached the service — the pin is only compared after `getPeerCertificate()` returns
    // — and then sent no HTTP request at all.
    expect(connections).toBeGreaterThan(0)
    expect(requests).toBe(0)
  })

  it('accepts the valid file through the same command and reports the purpose/formatVersion gap', async () => {
    const issued = await issue()
    const response = await reject([
      '--enroll-file',
      text(issued.out),
      '--computer-name',
      randomUUID()
    ])
    expect(response.accepted).toBe(true)
    const notes = response.notes
    expect(Array.isArray(notes)).toBe(true)
    expect((notes as string[]).join(' ')).toMatch(/purpose\/formatVersion/)
  })
})
