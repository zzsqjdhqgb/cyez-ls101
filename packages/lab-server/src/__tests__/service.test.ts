import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { request } from 'node:https'
import type { ClientRequest } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import type { Server } from 'node:https'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LabService } from '../service'
import { createLabHttpServer } from '../http'
import { operationDefinitions, validateResponse } from '@ls101/lab-contracts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action()
})

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'ls101-api-'))
  const root = join(parent, 'data')
  cleanup.push(() => rm(parent, { recursive: true, force: true }))
  const service = await LabService.initialize(
    { root, releaseVersion: 'test-release', isLicenseActive: () => true },
    { name: 'Lab', baseUrl: 'https://127.0.0.1:8443/', password: 'teacher-secret' }
  )
  cleanup.push(() => service.db.close())
  const server = createLabHttpServer(service)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  )
  return {
    service,
    server,
    api: (
      method: string,
      path: string,
      body?: unknown,
      token?: string,
      extra: Record<string, string> = {}
    ) => send(server, service.identity.certificate, method, path, body, token, extra)
  }
}

async function send(
  server: Server,
  certificate: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  extra: Record<string, string> = {}
) {
  const address = server.address() as { port: number }
  return new Promise<{ status: number; body: any; retryAfter?: string }>((resolve, reject) => {
    const call = request(
      {
        host: '127.0.0.1',
        port: address.port,
        path: `/api/v1${path}`,
        method,
        ca: certificate,
        checkServerIdentity: () => undefined,
        headers: {
          'x-ls101-client-version': 'test-release',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...extra
        }
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed: unknown = text
          try {
            parsed = JSON.parse(text)
          } catch {
            /* Enrollment files are JWS. */
          }
          resolve({
            status: response.statusCode!,
            body: parsed,
            retryAfter: response.headers['retry-after']
          })
        })
      }
    )
    call.on('error', reject)
    call.end(body ? JSON.stringify(body) : undefined)
  })
}

// Answers decided from the headers alone arrive while the client is still sending the archive. The
// client here stops mid-body on purpose, which is the only shape that shows the difference: if the server
// answers without reading, the answer arrives while the client is still writing and the socket is reset
// under it, so the second half never lands and the answer is lost. Draining first means nothing arrives
// until the body is complete — and that the answer still reaches a client that is no longer writing.
function earlyAnswer(server: Server, certificate: string, head: Buffer, tail: Buffer) {
  const address = server.address() as { port: number }
  const state = { answered: false }
  let call!: ClientRequest
  const answer = new Promise<{ status: number; code: string }>((resolve, reject) => {
    call = request(
      {
        host: '127.0.0.1',
        port: address.port,
        path: '/api/v1/teacher/exams',
        method: 'POST',
        ca: certificate,
        checkServerIdentity: () => undefined,
        headers: {
          'x-ls101-client-version': 'test-release',
          connection: 'close',
          'content-type': 'application/octet-stream',
          'content-length': String(head.byteLength + tail.byteLength),
          'x-ls101-archive-sha256': '0'.repeat(64),
          // A malformed student credential: the refusal comes from the header check, before any read.
          authorization: `Bearer d.00000000-0000-4000-8000-000000000000.${'x'.repeat(43)}`
        }
      },
      (response) => {
        state.answered = true
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: response.statusCode!, code: JSON.parse(text).error.code })
        })
      }
    )
    call.on('error', reject)
  })
  return {
    state,
    answer,
    sendHead: () => call.write(head),
    sendTail: () => call.end(tail)
  }
}

describe('HTTPS service contracts', () => {
  it('reads the archive before answering, so a half-sent upload still receives its refusal', async () => {
    const { server, service } = await fixture()
    const upload = earlyAnswer(
      server,
      service.identity.certificate,
      randomBytes(64 * 1024),
      randomBytes(64 * 1024)
    )
    upload.sendHead()
    await new Promise((done) => setTimeout(done, 300))
    // Answering here would leave the client writing into a closed socket; that is what lost the answer.
    expect(upload.state.answered).toBe(false)
    upload.sendTail()
    await expect(upload.answer).resolves.toEqual({ status: 401, code: 'AUTH_REQUIRED' })
  })

  it('returns a valid retryable error at capacity and accepts requests again after draining', async () => {
    const { api, service } = await fixture()
    let release!: () => void,
      entered = 0
    const held = new Promise<void>((done) => {
      release = done
    })
    const original = service.handlers.getInfo!
    service.handlers.getInfo = async (context) => {
      entered++
      await held
      return original(context)
    }
    const requests = Array.from({ length: 64 }, () => api('GET', '/info'))
    try {
      await vi.waitFor(() => expect(entered).toBe(64), { timeout: 5000 })
      const response = await api('GET', '/info')
      expect(response.status).toBe(503)
      expect(response.retryAfter).toBe('1')
      expect(() => validateResponse('getInfo', response.status, response.body)).not.toThrow()
      expect(response.body.error.code).toBe('SERVICE_NOT_READY')
    } finally {
      release()
      await Promise.all(requests)
    }
    expect((await api('GET', '/info')).status).toBe(200)
  })

  it('rejects unrepresentable backup passwords before creating a job', async () => {
    const { api, service } = await fixture()
    const token = (await api('POST', '/teacher/sessions', { password: 'teacher-secret' })).body
      .token
    for (const encryptionPassword of ['line\nbreak', 'line\rbreak', 'null\0byte']) {
      expect(
        (
          await api('POST', '/teacher/backups', { encryptionPassword }, token, {
            'idempotency-key': randomUUID()
          })
        ).status
      ).toBe(400)
    }
    expect(service.db.all('SELECT * FROM backups')).toEqual([])
  })
  it('registers every documented HTTP operation', async () => {
    const { service } = await fixture()
    expect(Object.keys(service.handlers).sort()).toEqual(Object.keys(operationDefinitions).sort())
  })
  it('requires authentication and prevents browser/local-proof bypasses', async () => {
    const { api, service } = await fixture()
    expect((await api('GET', '/info')).status).toBe(200)
    expect((await api('GET', '/teacher/security')).status).toBe(401)
    expect((await api('POST', '/teacher/sessions', {})).status).toBe(401)
    expect((await api('POST', '/teacher/sessions', { password: 'wrong' })).status).toBe(401)
    expect(
      (
        await api('POST', '/teacher/sessions', { password: 'teacher-secret' }, undefined, {
          origin: 'https://example.com'
        })
      ).status
    ).toBe(401)
    const proof = service.security.issueLocalProof()
    expect(
      (
        await api('POST', '/teacher/sessions', {}, undefined, {
          'x-ls101-local-authorization': proof
        })
      ).status
    ).toBe(200)
    expect(
      (
        await api('POST', '/teacher/sessions', {}, undefined, {
          'x-ls101-local-authorization': proof
        })
      ).status
    ).toBe(401)
  })

  it('registers idempotently and rejects stale heartbeats without renewing online time', async () => {
    const { api, service } = await fixture()
    const session = await api('POST', '/teacher/sessions', { password: 'teacher-secret' })
    expect(session.status).toBe(200)
    const token = session.body.token
    const batch = await api('POST', '/teacher/enrollments', { expectedModeRevision: 1 }, token, {
      'idempotency-key': randomUUID()
    })
    expect(batch.status).toBe(201)
    const file = await api(
      'GET',
      `/teacher/enrollments/${batch.body.enrollment.id}/file`,
      undefined,
      token
    )
    const installationId = randomUUID(),
      secret = randomBytes(32).toString('base64url')
    const body = {
      enrollmentFile: file.body,
      deviceSecret: secret,
      computerName: 'Lab-001',
      platform: 'linux',
      releaseVersion: 'test-release'
    }
    const enrolled = await api('PUT', `/enrollment/devices/${installationId}`, body)
    expect(enrolled.status).toBe(201)
    expect((await api('PUT', `/enrollment/devices/${installationId}`, body)).status).toBe(200)
    const credential = `d.${enrolled.body.deviceId}.${secret}`
    expect((await api('GET', '/teacher/security', undefined, credential)).status).toBe(401)
    const heartbeat = {
      runtimeId: randomUUID(),
      runtimeGeneration: 2,
      sequence: 1,
      activationState: 'active',
      phase: 'maintenance-idle',
      currentPractice: null,
      submissionSummary: { waitingFirstUpload: 0, unconfirmed: 0, failed: 0 },
      lastError: null
    }
    expect(
      (await api('POST', '/student/heartbeat', heartbeat, credential)).body.heartbeatAccepted
    ).toBe(true)
    const observed = service.db.get('SELECT accepted_at FROM heartbeats')
    const old = await api(
      'POST',
      '/student/heartbeat',
      { ...heartbeat, runtimeGeneration: 1, runtimeId: randomUUID() },
      credential
    )
    expect(old.body.heartbeatAccepted).toBe(false)
    expect(service.db.get('SELECT accepted_at FROM heartbeats')).toEqual(observed)
    expect(
      (
        await api(
          'POST',
          '/student/heartbeat',
          { ...heartbeat, runtimeId: randomUUID() },
          credential
        )
      ).status
    ).toBe(409)
  })

  it('password changes revoke all sessions and preserve independent settings revisions', async () => {
    const { api } = await fixture()
    const session = await api('POST', '/teacher/sessions', { password: 'teacher-secret' })
    const token = session.body.token
    expect((await api('GET', '/teacher/security', undefined, token)).body).toEqual({ revision: 1 })
    expect(
      (
        await api(
          'PUT',
          '/teacher/security/password',
          { expectedRevision: 2, newPassword: 'new-secret' },
          token
        )
      ).status
    ).toBe(409)
    expect(
      (
        await api(
          'PUT',
          '/teacher/security/password',
          { expectedRevision: 1, newPassword: 'new-secret' },
          token
        )
      ).status
    ).toBe(200)
    expect((await api('GET', '/teacher/security', undefined, token)).status).toBe(401)
    expect((await api('POST', '/teacher/sessions', { password: 'teacher-secret' })).status).toBe(
      401
    )
    expect((await api('POST', '/teacher/sessions', { password: 'new-secret' })).status).toBe(200)
  })

  it('leases require the current heartbeat and cancelled tasks retain late failure reports', async () => {
    const { api } = await fixture()
    const token = (await api('POST', '/teacher/sessions', { password: 'teacher-secret' })).body
      .token
    const batch = await api('POST', '/teacher/enrollments', { expectedModeRevision: 1 }, token, {
      'idempotency-key': randomUUID()
    })
    const file = (
      await api('GET', `/teacher/enrollments/${batch.body.enrollment.id}/file`, undefined, token)
    ).body
    const secret = randomBytes(32).toString('base64url')
    const registration = await api('PUT', `/enrollment/devices/${randomUUID()}`, {
      enrollmentFile: file,
      deviceSecret: secret,
      computerName: 'PC-001',
      platform: 'linux',
      releaseVersion: 'test-release'
    })
    const deviceId = registration.body.deviceId,
      credential = `d.${deviceId}.${secret}`,
      runtimeId = randomUUID()
    const run = await api(
      'POST',
      '/teacher/test-runs',
      {
        suiteId: 'ls101-lab-deployment',
        caseIds: ['identity', 'playback'],
        deviceIds: [deviceId],
        expiresAt: new Date(Date.now() + 600000).toISOString()
      },
      token,
      { 'idempotency-key': randomUUID() }
    )
    expect(run.status).toBe(201)
    expect(run.body.devices[0].confirmation).toMatchObject({
      revision: 1,
      updatedAt: null,
      cases: [{ caseId: 'playback', status: 'pending', note: '' }]
    })
    const confirmationPath = `/teacher/test-runs/${run.body.id}/devices/${deviceId}/confirmation`
    expect(
      (
        await api(
          'PUT',
          confirmationPath,
          { expectedRevision: 1, cases: [{ caseId: 'audio', status: 'passed', note: '' }] },
          token
        )
      ).status
    ).toBe(400)
    expect(
      (
        await api(
          'PUT',
          confirmationPath,
          {
            expectedRevision: 1,
            cases: [{ caseId: 'playback', status: 'failed', note: '声音不可听' }]
          },
          token
        )
      ).status
    ).toBe(200)
    expect(
      (
        await api(
          'PUT',
          confirmationPath,
          { expectedRevision: 1, cases: [{ caseId: 'playback', status: 'passed', note: '' }] },
          token
        )
      ).status
    ).toBe(409)
    const task = run.body.devices[0].task
    expect(
      (await api('POST', `/student/tasks/${task.id}/claim`, { runtimeId }, credential)).status
    ).toBe(409)
    await api(
      'POST',
      '/student/heartbeat',
      {
        runtimeId,
        runtimeGeneration: 1,
        sequence: 1,
        activationState: 'active',
        phase: 'maintenance-idle',
        currentPractice: null,
        submissionSummary: { waitingFirstUpload: 0, unconfirmed: 0, failed: 0 },
        lastError: null
      },
      credential
    )
    const claimed = await api('POST', `/student/tasks/${task.id}/claim`, { runtimeId }, credential)
    expect(claimed.status).toBe(200)
    expect(
      (await api('POST', `/student/tasks/${task.id}/claim`, { runtimeId }, credential)).body.leaseId
    ).toBe(claimed.body.leaseId)
    expect(
      (
        await api('POST', '/teacher/backups', { encryptionPassword: 'secret' }, token, {
          'idempotency-key': randomUUID()
        })
      ).status
    ).toBe(409)
    const cancelled = await api(
      'POST',
      `/teacher/test-runs/${run.body.id}/cancel`,
      undefined,
      token
    )
    expect(cancelled.body.status).toBe('cancel-requested')
    const report = {
      leaseId: claimed.body.leaseId,
      status: 'failed',
      completedAt: new Date().toISOString(),
      result: null,
      error: {
        code: 'EXECUTOR_FAILED',
        message: 'Could not initialize audio.',
        occurredAt: new Date().toISOString()
      }
    }
    expect(
      (await api('PUT', `/student/tasks/${task.id}/result`, report, credential)).body.late
    ).toBe(true)
    expect((await api('PUT', `/student/tasks/${task.id}/result`, report, credential)).status).toBe(
      200
    )
    expect(
      (
        await api(
          'PUT',
          `/student/tasks/${task.id}/result`,
          { ...report, status: 'cancelled' },
          credential
        )
      ).status
    ).toBe(409)
    const detail = await api('GET', `/teacher/test-runs/${run.body.id}`, undefined, token)
    expect(detail.body.status).toBe('cancelled')
    expect(detail.body.devices[0].report.error.code).toBe('EXECUTOR_FAILED')
    expect(detail.body.devices[0].confirmation.cases[0].status).toBe('failed')
  })

  it('backup barriers reject writes, release before encryption, and keep idempotent replay read-only', async () => {
    const { api, service } = await fixture()
    const token = (await api('POST', '/teacher/sessions', { password: 'teacher-secret' })).body
      .token
    let activeResolve!: () => void, activeContinue!: () => void
    const active = new Promise<void>((resolve) => {
      activeResolve = resolve
    })
    const continueActive = new Promise<void>((resolve) => {
      activeContinue = resolve
    })
    let encryptionResolve!: () => void, encryptionContinue!: () => void
    const encrypting = new Promise<void>((resolve) => {
      encryptionResolve = resolve
    })
    const continueEncryption = new Promise<void>((resolve) => {
      encryptionContinue = resolve
    })
    service.options.fault = async (point) => {
      if (point === 'backup-active') {
        activeResolve()
        await continueActive
      }
      if (point === 'backup-encrypting') {
        encryptionResolve()
        await continueEncryption
      }
    }
    const key = randomUUID()
    const created = await api(
      'POST',
      '/teacher/backups',
      { encryptionPassword: 'backup-secret' },
      token,
      { 'idempotency-key': key }
    )
    expect(created.status).toBe(202)
    try {
      await active
      expect(
        (await api('PATCH', '/teacher/settings', { expectedRevision: 1, name: 'New lab' }, token))
          .status
      ).toBe(503)
      expect(
        (await api('PUT', '/teacher/service/mode', { mode: 'normal', expectedRevision: 1 }, token))
          .status
      ).toBe(409)
      const replay = await api(
        'POST',
        '/teacher/backups',
        { encryptionPassword: 'backup-secret' },
        token,
        { 'idempotency-key': key }
      )
      expect(replay.body.id).toBe(created.body.id)
      expect(replay.status).toBe(202)
      expect(
        (
          await api('POST', '/teacher/backups', { encryptionPassword: 'different' }, token, {
            'idempotency-key': key
          })
        ).status
      ).toBe(409)
      activeContinue()
      await encrypting
      expect(
        (await api('PATCH', '/teacher/settings', { expectedRevision: 1, name: 'New lab' }, token))
          .status
      ).toBe(200)
      expect(
        (await api('PUT', '/teacher/service/mode', { mode: 'normal', expectedRevision: 1 }, token))
          .status
      ).toBe(409)
    } finally {
      activeContinue()
      encryptionContinue()
      await service.backups.wait()
    }
    const completed = await api('GET', `/teacher/backups/${created.body.id}`, undefined, token)
    expect(completed.body.status).toBe('ready')
    expect(completed.body.archiveBytes).toBeGreaterThan(0)
    expect(
      (await api('PUT', '/teacher/service/mode', { mode: 'normal', expectedRevision: 1 }, token))
        .status
    ).toBe(200)
    expect(
      (
        await api('POST', '/teacher/backups', { encryptionPassword: 'backup-secret' }, token, {
          'idempotency-key': key
        })
      ).body.id
    ).toBe(created.body.id)
  })
})
