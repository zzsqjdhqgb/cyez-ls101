import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  recordFailure,
  enroll,
  error,
  fixture,
  heartbeat,
  login,
  mode,
  type Fixture
} from './support'

let f: Fixture, teacher: string, devices: Awaited<ReturnType<typeof enroll>>
beforeEach(async () => {
  f = await fixture()
  teacher = await login(f.endpoint)
  devices = await enroll(f.endpoint, teacher)
})
afterEach(async ({ task }) => {
  if (f && task.result?.state === 'fail') await recordFailure(f.root, task.name)
  await f?.close()
})
const keyed = () => ({ 'idempotency-key': randomUUID() })
async function run() {
  const reply = await f.api('POST', '/teacher/test-runs', {
    token: teacher,
    headers: keyed(),
    body: {
      suiteId: 'ls101-lab-deployment',
      caseIds: ['identity'],
      deviceIds: [devices[0].id],
      expiresAt: new Date(f.now + 600000).toISOString()
    }
  })
  expect(reply.status, JSON.stringify(reply.body)).toBe(201)
  return reply.body
}
async function claim(task: string, index = 0) {
  const beat = heartbeat(devices[index].runtimeId)
  expect(
    (await f.api('POST', '/student/heartbeat', { token: devices[index].token, body: beat })).status
  ).toBe(200)
  const claimed = await f.api('POST', `/student/tasks/${task}/claim`, {
    token: devices[index].token,
    body: { runtimeId: beat.runtimeId }
  })
  expect(claimed.status, JSON.stringify(claimed.body)).toBe(200)
  return claimed.body
}

describe('TASK: leases, cancellation, expiry and ownership', () => {
  it('wrong owner cannot claim/read test resources or report; expired leases never revive', async () => {
    const batch = await run(),
      task = batch.devices[0].task.id
    error(
      await f.api('POST', `/student/tasks/${task}/claim`, {
        token: devices[1].token,
        body: { runtimeId: randomUUID() }
      }),
      404,
      'NOT_FOUND'
    )
    const lease = await claim(task)
    error(
      await f.api('GET', `/student/tasks/${task}/test/exam`, {
        token: devices[1].token,
        headers: { 'x-ls101-task-lease': lease.leaseId }
      }),
      404,
      'NOT_FOUND'
    )
    const report = {
      leaseId: lease.leaseId,
      status: 'failed',
      completedAt: new Date(f.now).toISOString(),
      result: null,
      error: {
        code: 'TEST_FAILURE',
        message: 'Test failed',
        occurredAt: new Date(f.now).toISOString()
      }
    }
    error(
      await f.api('PUT', `/student/tasks/${task}/result`, {
        token: devices[1].token,
        body: report
      }),
      404,
      'NOT_FOUND'
    )
    f.advance(30000)
    error(
      await f.api('PUT', `/student/tasks/${task}/lease`, {
        token: devices[0].token,
        body: { leaseId: lease.leaseId, runtimeId: lease.runtimeId }
      }),
      409,
      'RESOURCE_BUSY'
    )
    const late = await f.api('PUT', `/student/tasks/${task}/result`, {
      token: devices[0].token,
      body: report
    })
    expect(late.body.late).toBe(true)
    expect(
      (await f.api('GET', `/teacher/test-runs/${batch.id}`, { token: teacher })).body.status
    ).toBe('expired')
    await f.restart()
    expect(
      (
        await f.api('PUT', `/student/tasks/${task}/result`, {
          token: devices[0].token,
          body: report
        })
      ).body
    ).toEqual(late.body)
  })

  it.each(['cancel-first', 'result-first'] as const)(
    '%s retains execution evidence and does not revive terminal tasks',
    async (order) => {
      const batch = await run(),
        task = batch.devices[0].task.id
      const lease = await claim(task)
      const report = {
        leaseId: lease.leaseId,
        status: 'failed',
        completedAt: new Date(f.now).toISOString(),
        result: null,
        error: {
          code: 'TEST_FAILURE',
          message: 'Test failed',
          occurredAt: new Date(f.now).toISOString()
        }
      }
      const cancel = () =>
        f.api('POST', `/teacher/test-runs/${batch.id}/cancel`, { token: teacher })
      if (order === 'cancel-first') expect((await cancel()).status).toBe(200)
      const result = await f.api('PUT', `/student/tasks/${task}/result`, {
        token: devices[0].token,
        body: report
      })
      expect(result.body.late).toBe(order === 'cancel-first')
      if (order === 'result-first') expect((await cancel()).status).toBe(200)
      const before = (await f.api('GET', `/teacher/test-runs/${batch.id}`, { token: teacher })).body
      expect(before.status).toBe(order === 'cancel-first' ? 'cancelled' : 'failed')
      // Reset must revoke unfinished work, never rewrite an already terminal execution result.
      expect(
        (
          await f.api('POST', `/teacher/devices/${devices[0].id}/reset-binding`, {
            token: teacher,
            headers: keyed()
          })
        ).status
      ).toBe(204)
      const after = (await f.api('GET', `/teacher/test-runs/${batch.id}`, { token: teacher })).body
      expect(after.status).toBe(before.status)
      expect(after.devices[0].report).toEqual(before.devices[0].report)
    }
  )

  it('test-run retries create a new batch and preserve the original report', async () => {
    const batch = await run()
    await f.api('POST', `/teacher/test-runs/${batch.id}/cancel`, { token: teacher })
    const input = {
      token: teacher,
      headers: keyed(),
      body: {
        suiteId: 'ls101-lab-deployment',
        caseIds: ['identity'],
        deviceIds: [devices[0].id],
        expiresAt: new Date(f.now + 600000).toISOString(),
        retryOf: batch.id
      }
    }
    const retried = await f.api('POST', '/teacher/test-runs', input)
    expect(retried.status).toBe(201)
    expect(retried.body.id).not.toBe(batch.id)
    expect((await f.api('POST', '/teacher/test-runs', input)).body.id).toBe(retried.body.id)
    expect(
      (await f.api('GET', `/teacher/test-runs/${batch.id}/report`, { token: teacher })).body.status
    ).toBe('cancelled')
    expect((await f.api('GET', '/teacher/test-suites', { token: teacher })).body.items[0].id).toBe(
      'ls101-lab-deployment'
    )
  })
})

describe('CLEAN: frozen selections and preview authority', () => {
  async function preview() {
    const created = await f.api('POST', '/teacher/history-cleanups', {
      token: teacher,
      headers: keyed(),
      body: {
        deviceIds: devices.map((device) => device.id),
        submittedBefore: new Date(f.now).toISOString(),
        expiresAt: new Date(f.now + 600000).toISOString()
      }
    })
    expect(created.status).toBe(201)
    const plan = created.body,
      task = plan.devices[0].previewTaskId
    const lease = await claim(task)
    expect(
      (
        await f.api('PUT', `/student/tasks/${task}/result`, {
          token: devices[0].token,
          body: {
            leaseId: lease.leaseId,
            status: 'succeeded',
            completedAt: new Date(f.now).toISOString(),
            result: {
              kind: 'history-preview',
              selectionDigest: 'a'.repeat(64),
              selectedCount: 2,
              selectedBytes: 1234
            },
            error: null
          }
        })
      ).status
    ).toBe(200)
    return (await f.api('GET', `/teacher/history-cleanups/${plan.id}`, { token: teacher })).body
  }

  it('preview never dispatches execute; confirmation excludes offline devices and cannot expand on replay', async () => {
    const plan = await preview()
    expect(plan.devices.every((device: any) => device.executionTaskId === null)).toBe(true)
    const input = {
      token: teacher,
      headers: keyed(),
      body: {
        expectedRevision: plan.revision,
        selections: [{ deviceId: devices[0].id, selectionDigest: 'a'.repeat(64) }]
      }
    }
    const path = `/teacher/history-cleanups/${plan.id}/confirm`
    error(
      await f.api('POST', path, {
        ...input,
        body: {
          ...input.body,
          selections: [{ deviceId: devices[1].id, selectionDigest: 'a'.repeat(64) }]
        }
      }),
      409,
      'CONTENT_CONFLICT'
    )
    const confirmed = await f.api('POST', path, input)
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.devices.filter((device: any) => device.confirmed)).toHaveLength(1)
    expect(confirmed.body.devices[1].executionTaskId).toBeNull()
    const tasksBefore = f.service.db.all('SELECT id FROM tasks ORDER BY id')
    expect((await f.api('POST', path, input)).status).toBe(200)
    expect(f.service.db.all('SELECT id FROM tasks ORDER BY id')).toEqual(tasksBefore)
    error(
      await f.api('POST', path, {
        ...input,
        body: {
          ...input.body,
          selections: [
            ...input.body.selections,
            { deviceId: devices[1].id, selectionDigest: 'b'.repeat(64) }
          ]
        }
      }),
      409,
      'CONTENT_CONFLICT'
    )
    await f.restart()
    expect((await f.api('POST', path, input)).body.devices).toEqual(confirmed.body.devices)
  })

  it.each(['stale-revision', 'wrong-digest', 'cancelled', 'expired'] as const)(
    '%s prevents execution task creation',
    async (condition) => {
      const plan = await preview()
      const input = {
        token: teacher,
        headers: keyed(),
        body: {
          expectedRevision: condition === 'stale-revision' ? 0 : plan.revision,
          selections: [
            {
              deviceId: devices[0].id,
              selectionDigest: condition === 'wrong-digest' ? 'b'.repeat(64) : 'a'.repeat(64)
            }
          ]
        }
      }
      if (condition === 'cancelled')
        await f.api('POST', `/teacher/history-cleanups/${plan.id}/cancel`, { token: teacher })
      if (condition === 'expired') f.advance(600001)
      if (condition === 'cancelled' || condition === 'expired')
        input.body.expectedRevision = (
          await f.api('GET', `/teacher/history-cleanups/${plan.id}`, { token: teacher })
        ).body.revision
      const response = await f.api('POST', `/teacher/history-cleanups/${plan.id}/confirm`, input)
      expect(response.status).toBeGreaterThanOrEqual(400)
      const current = await f.api('GET', `/teacher/history-cleanups/${plan.id}`, { token: teacher })
      expect(current.body.devices.every((device: any) => device.executionTaskId === null)).toBe(
        true
      )
    }
  )
})

describe('BK-ORDER: backup admission vs mode and lease', () => {
  it.each(['backup-first', 'mode-first'] as const)(
    '%s has only the permitted committed state',
    async (order) => {
      const input = {
        token: teacher,
        headers: keyed(),
        body: { encryptionPassword: 'backup-secret' }
      }
      if (order === 'mode-first') {
        await mode(f.endpoint, teacher, 'normal')
        error(await f.api('POST', '/teacher/backups', input), 409, 'RESOURCE_BUSY')
        expect((await f.api('GET', '/teacher/backups', { token: teacher })).body.items).toEqual([])
      } else {
        const gate = f.pause('backup-pending')
        expect((await f.api('POST', '/teacher/backups', input)).status).toBe(202)
        await gate.entered
        const info = (await f.api('GET', '/teacher/service', { token: teacher })).body
        error(
          await f.api('PUT', '/teacher/service/mode', {
            token: teacher,
            body: { mode: 'normal', expectedRevision: info.modeRevision }
          }),
          409,
          'RESOURCE_BUSY'
        )
        gate.release()
        await f.service.backups.wait()
        await mode(f.endpoint, teacher, 'normal')
      }
    }
  )

  it.each(['backup-first', 'lease-first'] as const)(
    '%s excludes the other operation without extending a lease',
    async (order) => {
      const batch = await run(),
        task = batch.devices[0].task.id
      const input = {
        token: teacher,
        headers: keyed(),
        body: { encryptionPassword: 'backup-secret' }
      }
      if (order === 'lease-first') {
        const lease = await claim(task)
        error(await f.api('POST', '/teacher/backups', input), 409, 'RESOURCE_BUSY')
        expect(f.service.db.all('SELECT * FROM backups')).toEqual([])
        expect(
          f.service.db.get<{ expires_at: number }>(
            'SELECT expires_at FROM task_leases WHERE id=?',
            lease.leaseId
          )?.expires_at
        ).toBe(Date.parse(lease.leaseExpiresAt))
      } else {
        const beat = heartbeat(devices[0].runtimeId)
        await f.api('POST', '/student/heartbeat', { token: devices[0].token, body: beat })
        const gate = f.pause('backup-pending')
        expect((await f.api('POST', '/teacher/backups', input)).status).toBe(202)
        await gate.entered
        error(
          await f.api('POST', `/student/tasks/${task}/claim`, {
            token: devices[0].token,
            body: { runtimeId: beat.runtimeId }
          }),
          409,
          'RESOURCE_BUSY'
        )
        expect(f.service.db.all('SELECT * FROM task_leases')).toEqual([])
        gate.release()
        await f.service.backups.wait()
        expect(
          (
            await f.api('POST', `/student/tasks/${task}/claim`, {
              token: devices[0].token,
              body: { runtimeId: beat.runtimeId }
            })
          ).status
        ).toBe(200)
      }
    }
  )
})
