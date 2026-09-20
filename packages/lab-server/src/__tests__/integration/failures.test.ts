import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import * as durable from '../../durable-files'
import { LabError } from '../../errors'
import {
  recordFailure,
  archiveInput,
  beginRequest,
  enroll,
  error,
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
  vi.restoreAllMocks()
  await f?.close()
})

describe('IO: failed transfers never create successful receipts', () => {
  it('insufficient capacity refuses before receiving bytes and permits a later retry', async () => {
    const p = await practice(f.endpoint, teacher, student.token)
    // Only the filesystem capacity probe is replaced. HTTP, authorization, SQLite and all writes
    // remain real. This proves error handling, not an actual full-filesystem durability result.
    const probe = vi
      .spyOn(durable, 'ensureSpace')
      .mockRejectedValueOnce(new LabError('STORAGE_UNAVAILABLE'))
    error(await p.upload(), 503, 'STORAGE_UNAVAILABLE')
    probe.mockRestore()
    expect((await p.receipt()).body.status).toBe('not-received')
    expect(f.service.db.all('SELECT * FROM uploads')).toEqual([])
    expect(await readdir(join(f.root, 'incoming'))).toEqual([])
    expect((await p.upload()).status).toBe(201)
  })

  it.each(['upload-reserved', 'upload-file-synced', 'upload-file-published'])(
    '%s exception cleans resources and retry works',
    async (point) => {
      const p = await practice(f.endpoint, teacher, student.token)
      f.service.options.fault = (at) => {
        if (at === point) throw Object.assign(new Error('Injected I/O failure'), { code: 'EIO' })
      }
      error(await p.upload(), 503, 'STORAGE_UNAVAILABLE')
      f.service.options.fault = undefined
      await f.service.archives.collectGarbage()
      expect((await p.receipt()).body.status).toBe('not-received')
      expect(f.service.db.all('SELECT * FROM uploads')).toEqual([])
      expect(f.service.transfers.size).toBe(0)
      expect(await readdir(join(f.root, 'incoming'))).toEqual([])
      expect(await readdir(join(f.root, 'archives/submissions'))).toEqual([])
      expect((await p.upload()).status).toBe(201)
    }
  )

  it('aborted upload releases its reservation and allows the same identifier again', async () => {
    const p = await practice(f.endpoint, teacher, student.token)
    const gate = f.pause('upload-reserved')
    const pending = beginRequest(
      f.endpoint,
      'PUT',
      `/student/submissions/${p.id}`,
      archiveInput(student.token, p.bytes)
    )
    const interrupted = pending.response.catch((error: unknown) => error)
    pending.call.write(p.bytes.subarray(0, 10))
    await gate.entered
    pending.call.destroy(new Error('Client disconnected'))
    gate.release()
    expect(await interrupted).toBeInstanceOf(Error)
    await expect.poll(() => f.service.transfers.size).toBe(0)
    expect((await p.receipt()).body.status).toBe('not-received')
    expect((await p.upload()).status).toBe(201)
  })

  it('maintenance cancels a stalled body without waiting for the client to send another byte', async () => {
    const p = await practice(f.endpoint, teacher, student.token)
    const gate = f.pause('upload-reserved')
    const pending = beginRequest(
      f.endpoint,
      'PUT',
      `/student/submissions/${p.id}`,
      archiveInput(student.token, p.bytes)
    )
    const interrupted = pending.response.catch((error: unknown) => error)
    pending.call.write(p.bytes.subarray(0, 10))
    await gate.entered
    gate.release()
    try {
      await mode(f.endpoint, teacher, 'maintenance')
      await expect.poll(() => f.service.transfers.size, { timeout: 1500 }).toBe(0)
      expect(f.service.db.all('SELECT * FROM uploads')).toEqual([])
    } finally {
      pending.call.destroy(new Error('Test cleanup'))
      await interrupted
    }
    await mode(f.endpoint, teacher, 'normal')
    expect((await p.upload()).status).toBe(201)
  })

  it.each(['before-commit', 'after-commit'] as const)(
    'uncertain SQLite outcome %s: API remains unavailable until reopen, then recovers the actual fact',
    async (point) => {
      const p = await practice(f.endpoint, teacher, student.token)
      const gate = f.pause('upload-file-published')
      const pending = p.upload()
      await gate.entered
      const sql = f.service.db.sql
      const original = sql.exec.bind(sql)
      const commit = vi.spyOn(sql, 'exec').mockImplementation((statement) => {
        if (statement === 'COMMIT') {
          commit.mockRestore()
          if (point === 'after-commit') original(statement)
          throw new Error('Commit outcome unknown')
        }
        return original(statement)
      })
      gate.release()
      error(await pending, 503, 'STORAGE_UNAVAILABLE')
      // A second request must get a bounded storage error, never hang or produce an unhandled rejection.
      error(await p.receipt(), 503, 'STORAGE_UNAVAILABLE')
      await f.restart()
      expect((await p.receipt()).body.status).toBe(
        point === 'after-commit' ? 'received' : 'not-received'
      )
      expect((await p.upload()).status).toBe(point === 'after-commit' ? 200 : 201)
    }
  )
})

describe('HTTP: malformed input is rejected without disabling subsequent requests', () => {
  it.each(['authentication', 'media', 'size', 'rate'] as const)(
    '%s early refusal survives a large request body',
    async (reason) => {
      const p = await practice(f.endpoint, teacher, student.token)
      const bytes = Buffer.alloc(4 * 1024 * 1024, 0x61)
      const input = archiveInput(student.token, bytes)
      let first: Promise<unknown> | undefined
      let release: (() => void) | undefined
      let path = `/student/submissions/${p.id}`
      if (reason === 'authentication') input.token = 'invalid'
      if (reason === 'media') input.headers!['content-type'] = 'text/plain'
      if (reason === 'size') {
        const data = f.service.data()
        f.service.db.transaction(() =>
          f.service.saveData({
            ...data,
            limits: { ...data.limits, maxSubmissionArchiveBytes: 1024 }
          })
        )
      }
      if (reason === 'rate') {
        const other = await practice(f.endpoint, teacher, student.token)
        path = `/student/submissions/${other.id}`
        const gate = f.pause('upload-reserved')
        release = gate.release
        first = p.upload()
        await gate.entered
      }
      try {
        const reply = await f.api('PUT', path, input)
        const expected = {
          authentication: [401, 'AUTH_REQUIRED'],
          media: [415, 'UNSUPPORTED_MEDIA_TYPE'],
          size: [413, 'PAYLOAD_TOO_LARGE'],
          rate: [429, 'RATE_LIMITED']
        } as const
        error(reply, expected[reason][0], expected[reason][1])
        if (reason === 'rate')
          expect(Number(reply.headers['retry-after'])).toBeGreaterThanOrEqual(1)
      } finally {
        release?.()
        await first
      }
      expect((await f.api('GET', '/teacher/security', { token: teacher })).status).toBe(200)
    }
  )

  it.each([
    ['invalid-json', '{', 'application/json', 400, 'INVALID_REQUEST'],
    [
      'unknown-field',
      '{"password":"secret","extra":true}',
      'application/json',
      400,
      'INVALID_REQUEST'
    ],
    ['wrong-media', '{}', 'text/plain', 415, 'UNSUPPORTED_MEDIA_TYPE']
  ] as const)(
    '%s returns the documented error envelope',
    async (_name, body, contentType, status, code) => {
      error(
        await f.api('POST', '/teacher/sessions', {
          bytes: Buffer.from(body),
          headers: { 'content-type': contentType }
        }),
        status,
        code
      )
      expect((await f.api('GET', '/teacher/security', { token: teacher })).status).toBe(200)
    }
  )

  it('duplicate query, invalid UUID and forged browser origin are rejected', async () => {
    error(
      await f.api('GET', '/teacher/devices?limit=1&limit=2', { token: teacher }),
      400,
      'INVALID_REQUEST'
    )
    error(
      await f.api('GET', '/teacher/devices/not-an-id', { token: teacher }),
      400,
      'INVALID_REQUEST'
    )
    error(
      await f.api('GET', '/teacher/security', {
        token: teacher,
        headers: { origin: 'https://untrusted.invalid' }
      }),
      401,
      'AUTH_REQUIRED'
    )
    const valid = await f.api('GET', '/teacher/security', { token: teacher })
    expect(valid.status).toBe(200)
    expect(valid.headers['cache-control']).toBe('no-store')
    expect(valid.headers['x-content-type-options']).toBe('nosniff')
  })
})
