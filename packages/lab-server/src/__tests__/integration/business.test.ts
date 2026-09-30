import { randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
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
  heartbeat,
  login,
  mode,
  practice,
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

describe('AUTH: role, ownership and admission matrix', () => {
  it.each([
    '/teacher/service',
    '/teacher/devices',
    '/teacher/exams',
    '/teacher/submissions',
    '/teacher/security',
    '/teacher/backups',
    '/teacher/test-runs',
    '/teacher/history-cleanups',
    '/teacher/settings',
    '/teacher/logs'
  ])('%s rejects both anonymous and student credentials', async (path) => {
    error(await f.api('GET', path), 401, 'AUTH_REQUIRED')
    error(await f.api('GET', path, { token: devices[0].token }), 401, 'AUTH_REQUIRED')
    expect((await f.api('GET', path, { token: teacher })).status).toBe(200)
  })

  it('a different device cannot read, overwrite or obtain the same practice grant', async () => {
    const p = await practice(f.endpoint, teacher, devices[0].token)
    const original = await p.upload()
    error(
      await f.api('GET', `/student/submissions/${p.id}/receipt`, { token: devices[1].token }),
      404,
      'NOT_FOUND'
    )
    error(
      await f.api('PUT', `/student/submissions/${p.id}`, archiveInput(devices[1].token, p.bytes)),
      404,
      'NOT_FOUND'
    )
    error(
      await f.api('PUT', `/student/practices/${p.id}`, {
        token: devices[1].token,
        body: p.grantInput
      }),
      409,
      'CONTENT_CONFLICT'
    )
    expect((await p.receipt()).body).toEqual(original.body)
  })

  it.each([
    ['maintenance', 409, 'SERVICE_MAINTENANCE'],
    ['version', 409, 'VERSION_MISMATCH'],
    ['disabled', 403, 'DEVICE_DISABLED'],
    ['revoked', 401, 'TOKEN_REVOKED'],
    ['license', 403, 'LICENSE_INACTIVE']
  ] as const)(
    '%s refuses all formal student entry points without creating submissions',
    async (condition, status, code) => {
      const student = devices[0]
      const p = await practice(f.endpoint, teacher, student.token)
      if (condition === 'maintenance') await mode(f.endpoint, teacher, 'maintenance')
      if (condition === 'disabled')
        expect(
          (
            await f.api('PATCH', `/teacher/devices/${student.id}`, {
              token: teacher,
              body: { expectedRevision: 1, enabled: false }
            })
          ).status
        ).toBe(200)
      if (condition === 'revoked')
        expect(
          (
            await f.api('POST', `/teacher/devices/${student.id}/reset-binding`, {
              token: teacher,
              headers: { 'idempotency-key': randomUUID() }
            })
          ).status
        ).toBe(204)
      if (condition === 'license') f.license(false)
      const headers: Record<string, string> =
        condition === 'version' ? { 'x-ls101-client-version': 'other-release' } : {}
      for (const path of [
        '/student/exams',
        `/student/exams/${p.exam.examId}/archive`,
        `/student/submissions/${p.id}/receipt`
      ]) {
        error(await f.api('GET', path, { token: student.token, headers }), status, code)
      }
      error(
        await f.api('PUT', `/student/practices/${randomUUID()}`, {
          token: student.token,
          headers,
          body: p.grantInput
        }),
        status,
        code
      )
      const upload = archiveInput(student.token, p.bytes)
      error(
        await f.api('PUT', `/student/submissions/${p.id}`, {
          ...upload,
          headers: { ...upload.headers, ...headers }
        }),
        status,
        code
      )
      expect(f.service.db.all('SELECT * FROM submissions')).toEqual([])
      expect(f.service.db.all('SELECT * FROM uploads')).toEqual([])
      if (['maintenance', 'version', 'disabled'].includes(condition))
        expect(
          (await f.api('GET', '/student/state', { token: student.token, headers })).status
        ).toBe(200)
    }
  )

  it('logout and expiry invalidate sessions while new login still works', async () => {
    expect((await f.api('DELETE', '/teacher/sessions/current', { token: teacher })).status).toBe(
      204
    )
    error(await f.api('GET', '/teacher/security', { token: teacher }), 401, 'AUTH_REQUIRED')
    const token = await login(f.endpoint)
    f.advance(8 * 3600000)
    error(await f.api('GET', '/teacher/security', { token }), 401, 'TOKEN_EXPIRED')
    const fresh = await login(f.endpoint)
    expect((await f.api('GET', '/teacher/security', { token: fresh })).status).toBe(200)
  })
})

describe('DEV: durable identity, revisions and heartbeat order', () => {
  it('HTTP number conflict and stale revision change no other fields', async () => {
    const first = (await f.api('GET', `/teacher/devices/${devices[0].id}`, { token: teacher })).body
    const second = (await f.api('GET', `/teacher/devices/${devices[1].id}`, { token: teacher }))
      .body
    error(
      await f.api('PATCH', `/teacher/devices/${second.id}`, {
        token: teacher,
        body: { expectedRevision: 1, number: first.number, room: 'must-not-stick' }
      }),
      409,
      'CONTENT_CONFLICT'
    )
    expect((await f.api('GET', `/teacher/devices/${second.id}`, { token: teacher })).body).toEqual(
      second
    )
    expect(
      (
        await f.api('PATCH', `/teacher/devices/${second.id}`, {
          token: teacher,
          body: { expectedRevision: 1, room: 'new-room', seat: 'A' }
        })
      ).body.revision
    ).toBe(2)
    error(
      await f.api('PATCH', `/teacher/devices/${second.id}`, {
        token: teacher,
        body: { expectedRevision: 1, room: 'stale' }
      }),
      409,
      'REVISION_CONFLICT'
    )
    await f.restart()
    expect(
      (await f.api('GET', '/student/state', { token: devices[1].token })).body.device
    ).toMatchObject({ id: second.id, revision: 2, room: 'new-room', seat: 'A' })
  })

  it('restart preserves heartbeat generation/sequence and does not renew stale observations', async () => {
    const student = devices[0],
      beat = heartbeat(student.runtimeId, 1, 8)
    expect(
      (await f.api('POST', '/student/heartbeat', { token: student.token, body: beat })).body
        .heartbeatAccepted
    ).toBe(true)
    const before = (await f.api('GET', `/teacher/devices/${student.id}`, { token: teacher })).body
    f.advance(20000)
    await f.restart()
    for (const stale of [
      { ...beat, sequence: 7 },
      { ...beat, runtimeGeneration: 2 }
    ]) {
      expect(
        (await f.api('POST', '/student/heartbeat', { token: student.token, body: stale })).body
          .heartbeatAccepted
      ).toBe(false)
    }
    error(
      await f.api('POST', '/student/heartbeat', {
        token: student.token,
        body: { ...beat, runtimeId: randomUUID() }
      }),
      409,
      'CONTENT_CONFLICT'
    )
    const after = (await f.api('GET', `/teacher/devices/${student.id}`, { token: teacher })).body
    expect(after).toMatchObject({
      online: false,
      lastHeartbeatAt: before.lastHeartbeatAt,
      heartbeat: before.heartbeat
    })
    const nextRuntime = randomUUID()
    const next = await f.api('POST', '/student/sessions', {
      body: {
        connectionSecret: student.connectionSecret,
        computerName: student.computerName,
        platform: 'linux',
        runtimeId: nextRuntime
      }
    })
    expect(next.status).toBe(200)
    expect(next.body.runtimeGeneration).toBe(2)
    expect(
      (
        await f.api('POST', '/student/heartbeat', {
          token: student.token,
          body: heartbeat(nextRuntime, next.body.runtimeGeneration)
        })
      ).body.heartbeatAccepted
    ).toBe(true)
  })

  it('receipt-time labels remain stable after device edits', async () => {
    const student = devices[0]
    await f.api('PATCH', `/teacher/devices/${student.id}`, {
      token: teacher,
      body: { expectedRevision: 1, room: 'original' }
    })
    const p = await practice(f.endpoint, teacher, student.token)
    await p.upload()
    await f.api('PATCH', `/teacher/devices/${student.id}`, {
      token: teacher,
      body: { expectedRevision: 2, room: 'new-room', number: '999' }
    })
    const detail = (await f.api('GET', `/teacher/submissions/${p.id}`, { token: teacher })).body
    expect(detail.deviceAtReceipt.room).toBe('original')
    expect(detail.currentDevice).toMatchObject({ id: student.id, room: 'new-room', number: '999' })
    expect(
      (await f.api('GET', '/teacher/submissions?room=original', { token: teacher })).body.items
    ).toHaveLength(1)
    expect(
      (await f.api('GET', '/teacher/submissions?room=new-room', { token: teacher })).body.items
    ).toHaveLength(0)
  })
})

describe('AR: archive workflows and response contracts', () => {
  it('exam duplicate/conflict, unpublish, delete and reimport preserve existing receipts', async () => {
    const p = await practice(f.endpoint, teacher, devices[0].token)
    const receipt = (await p.upload()).body
    const duplicate = await f.api(
      'POST',
      '/teacher/exams',
      archiveInput(teacher, p.examBytes, 'exam')
    )
    expect(duplicate.body).toMatchObject({ examId: p.exam.examId, duplicate: true })
    const changed = await examArchive(p.exam.packageId, 'Changed content')
    error(
      await f.api('POST', '/teacher/exams', archiveInput(teacher, changed.bytes, 'exam')),
      409,
      'CONTENT_CONFLICT'
    )
    expect(
      (
        await f.api('PATCH', `/teacher/exams/${p.exam.examId}`, {
          token: teacher,
          body: { expectedRevision: 1, published: false }
        })
      ).status
    ).toBe(200)
    error(
      await f.api('GET', `/student/exams/${p.exam.examId}/archive`, { token: devices[0].token }),
      404,
      'NOT_FOUND'
    )
    expect(
      (await f.api('DELETE', `/teacher/exams/${p.exam.examId}`, { token: teacher })).status
    ).toBe(204)
    const again = await f.api(
      'POST',
      '/teacher/exams',
      archiveInput(teacher, changed.bytes, 'exam')
    )
    expect(again.status).toBe(201)
    expect(again.body.examId).not.toBe(p.exam.examId)
    expect((await p.receipt()).body).toEqual(receipt)
  })

  it('invalid archive and digest mismatch leave no success record and release upload slots', async () => {
    const p = await practice(f.endpoint, teacher, devices[0].token)
    const input = archiveInput(devices[0].token, p.bytes)
    error(
      await f.api('PUT', `/student/submissions/${p.id}`, {
        ...input,
        headers: { ...input.headers, 'x-ls101-archive-sha256': '0'.repeat(64) }
      }),
      409,
      'CONTENT_CONFLICT'
    )
    error(
      await f.api(
        'PUT',
        `/student/submissions/${p.id}`,
        archiveInput(devices[0].token, Buffer.from('not a zip'))
      ),
      422,
      'INVALID_SUBMISSION'
    )
    expect((await p.receipt()).body.status).toBe('not-received')
    expect(await readdir(join(f.root, 'incoming'))).toEqual([])
    expect(f.service.db.all('SELECT * FROM uploads')).toEqual([])
    expect((await p.upload()).status).toBe(201)
  })

  it('same-size archive corruption returns storage failure, never successful bytes', async () => {
    const p = await practice(f.endpoint, teacher, devices[0].token)
    await p.upload()
    const [name] = await readdir(join(f.root, 'archives/submissions'))
    const path = join(f.root, 'archives/submissions', name)
    const corrupt = await readFile(path)
    corrupt[0] ^= 1
    await writeFile(path, corrupt)
    error(
      await f.api('GET', `/teacher/submissions/${p.id}/archive`, { token: teacher }),
      503,
      'STORAGE_UNAVAILABLE'
    )
    expect(f.service.fileReferences.size).toBe(0)
    await writeFile(path, p.bytes)
    expect(
      digest((await f.api('GET', `/teacher/submissions/${p.id}/archive`, { token: teacher })).bytes)
    ).toBe(digest(p.bytes))
  })

  it('export validates the whole selection before sending ZIP; batch-delete replay stays fixed after restart', async () => {
    const p = await practice(f.endpoint, teacher, devices[0].token)
    await p.upload()
    const selection = { submissionIds: [p.id] }
    const exported = await f.api('POST', '/teacher/submissions/export', {
      token: teacher,
      body: selection
    })
    expect(exported.status).toBe(200)
    const files = unzipSync(exported.bytes)
    expect(Object.values(files)).toHaveLength(1)
    expect(digest(Object.values(files)[0])).toBe(digest(p.bytes))
    error(
      await f.api('POST', '/teacher/submissions/export', {
        token: teacher,
        body: { submissionIds: [p.id, randomUUID()] }
      }),
      404,
      'NOT_FOUND'
    )
    expect(f.service.fileReferences.size).toBe(0)
    const input = { token: teacher, body: selection, headers: { 'idempotency-key': randomUUID() } }
    const deleted = await f.api('POST', '/teacher/submissions/delete', input)
    expect(deleted.status).toBe(200)
    await f.restart()
    expect((await f.api('POST', '/teacher/submissions/delete', input)).body).toEqual(deleted.body)
    error(
      await f.api('POST', '/teacher/submissions/delete', {
        ...input,
        body: { submissionIds: [randomUUID()] }
      }),
      409,
      'CONTENT_CONFLICT'
    )
  })

  it('HTTP pagination freezes identity order across edits and rejects cross-session/filter reuse', async () => {
    const page = await f.api('GET', '/teacher/devices?limit=1', { token: teacher })
    expect(page.body.items).toHaveLength(1)
    const seen = page.body.items[0].id
    await f.api('PATCH', `/teacher/devices/${seen}`, {
      token: teacher,
      body: { expectedRevision: 1, number: 'zzz' }
    })
    const cursor = encodeURIComponent(page.body.nextCursor)
    const next = await f.api('GET', `/teacher/devices?limit=1&cursor=${cursor}`, { token: teacher })
    expect(next.body.items.map((device: { id: string }) => device.id)).toEqual(
      devices.filter((device) => device.id !== seen).map((device) => device.id)
    )
    error(
      await f.api('GET', `/teacher/devices?limit=1&cursor=${cursor}&room=other`, {
        token: teacher
      }),
      400,
      'INVALID_REQUEST'
    )
    error(
      await f.api('GET', `/teacher/devices?limit=1&cursor=${cursor}`, {
        token: await login(f.endpoint)
      }),
      400,
      'INVALID_REQUEST'
    )
  })
})
