import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  recordFailure,
  api,
  archiveInput,
  digest,
  enroll,
  error,
  examArchive,
  fixture,
  login,
  mode,
  practice,
  type Fixture
} from './support'

let f: Fixture, teacher: string, student: Awaited<ReturnType<typeof enroll>>[number]
beforeEach(async () => {
  f = await fixture()
  teacher = await login(f.endpoint)
  ;[student] = await enroll(f.endpoint, teacher, 1)
})
afterEach(async ({ task }) => {
  if (f && task.result?.state === 'fail') await recordFailure(f.root, task.name)
  await f?.close()
})

describe('ORDER: deterministic final-commit authorization', () => {
  it.each(['maintenance', 'disabled', 'reset', 'license'] as const)(
    '%s before submission commit rejects it without a receipt; committed receipt remains',
    async (action) => {
      const committed = await practice(f.endpoint, teacher, student.token)
      const oldReceipt = (await committed.upload()).body.receipt
      const pending = await practice(f.endpoint, teacher, student.token)
      const gate = f.pause('upload-file-published')
      const uploading = pending.upload()
      await gate.entered
      if (action === 'maintenance') await mode(f.endpoint, teacher, 'maintenance')
      if (action === 'disabled')
        expect(
          (
            await f.api('PATCH', `/teacher/devices/${student.id}`, {
              token: teacher,
              body: { expectedRevision: 1, enabled: false }
            })
          ).status
        ).toBe(200)
      if (action === 'reset')
        expect(
          (
            await f.api('POST', `/teacher/devices/${student.id}/reset-binding`, {
              token: teacher,
              headers: { 'idempotency-key': randomUUID() }
            })
          ).status
        ).toBe(204)
      if (action === 'license') f.license(false)
      gate.release()
      const expected = {
        maintenance: [409, 'SERVICE_MAINTENANCE'],
        disabled: [403, 'DEVICE_DISABLED'],
        reset: [401, 'TOKEN_REVOKED'],
        license: [403, 'LICENSE_INACTIVE']
      } as const
      error(await uploading, expected[action][0], expected[action][1])
      expect(f.service.db.all('SELECT id FROM submissions')).toEqual([{ id: committed.id }])
      expect(f.service.db.all('SELECT * FROM uploads')).toEqual([])
      f.license(true)
      const original = await f.api('GET', `/teacher/submissions/${committed.id}`, {
        token: teacher
      })
      expect(original.body.receipt).toEqual(oldReceipt)
      await f.service.archives.collectGarbage()
      expect(await readdir(join(f.root, 'archives/submissions'))).toHaveLength(1)
    }
  )

  it('password change revokes an already-authorized exam upload before its final commit', async () => {
    const exam = await examArchive()
    const gate = f.pause('upload-file-published')
    const uploading = f.api('POST', '/teacher/exams', archiveInput(teacher, exam.bytes, 'exam'))
    await gate.entered
    expect(
      (
        await f.api('PUT', '/teacher/security/password', {
          token: teacher,
          body: { expectedRevision: 1, newPassword: 'replacement-secret' }
        })
      ).status
    ).toBe(200)
    gate.release()
    error(await uploading, 401, 'TOKEN_REVOKED')
    const fresh = await login(f.endpoint, 'replacement-secret')
    expect((await f.api('GET', '/teacher/exams', { token: fresh })).body.items).toEqual([])
    expect(
      (await f.api('POST', '/teacher/exams', archiveInput(fresh, exam.bytes, 'exam'))).status
    ).toBe(201)
  })

  it('simultaneous retries reserve one submission and converge to one receipt', async () => {
    const p = await practice(f.endpoint, teacher, student.token)
    const gate = f.pause('upload-reserved')
    const first = p.upload()
    await gate.entered
    error(await p.upload(), 409, 'RESOURCE_BUSY')
    expect((await p.receipt()).body.status).toBe('receiving')
    gate.release()
    const received = await first
    expect(received.status).toBe(201)
    const retries = await Promise.all([p.upload(), p.upload(), p.upload()])
    for (const result of retries) expect(result.body).toEqual(received.body)
    expect(f.service.db.all('SELECT * FROM submissions')).toHaveLength(1)
    expect(await readdir(join(f.root, 'archives/submissions'))).toHaveLength(1)
  })

  it.each(['download', 'export'] as const)(
    '%s acquired before delete survives GC; new downloads fail',
    async (operation) => {
      const p = await practice(f.endpoint, teacher, student.token)
      await p.upload()
      const gate = f.pause('archive-download-acquired')
      const pending =
        operation === 'download'
          ? f.api('GET', `/teacher/submissions/${p.id}/archive`, { token: teacher })
          : f.api('POST', '/teacher/submissions/export', {
              token: teacher,
              body: { submissionIds: [p.id] }
            })
      await gate.entered
      expect(
        (await f.api('DELETE', `/teacher/submissions/${p.id}`, { token: teacher })).status
      ).toBe(204)
      await f.service.archives.collectGarbage()
      expect(await readdir(join(f.root, 'archives/submissions'))).toHaveLength(1)
      error(
        await f.api('GET', `/teacher/submissions/${p.id}/archive`, { token: teacher }),
        404,
        'NOT_FOUND'
      )
      gate.release()
      const result = await pending
      expect(result.status).toBe(200)
      if (operation === 'download') expect(digest(result.bytes)).toBe(digest(p.bytes))
      await expect.poll(() => f.service.fileReferences.size).toBe(0)
      await f.service.archives.collectGarbage()
      expect(await readdir(join(f.root, 'archives/submissions'))).toEqual([])
      expect((await p.receipt()).body.status).toBe('deleted')
    }
  )
})
