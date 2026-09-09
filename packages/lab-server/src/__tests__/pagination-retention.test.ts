import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { LabService, type Context } from '../service'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ls101-page-test-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  let now = Date.now()
  const service = await LabService.initialize(
    { root, releaseVersion: 'test', isLicenseActive: () => true, now: () => now },
    { name: 'Lab', password: 'teacher-secret', baseUrl: 'https://localhost:8443/' }
  )
  cleanups.push(() => service.db.close())
  return {
    service,
    advance: (milliseconds: number) => {
      now += milliseconds
    }
  }
}
const context: Context = {
  id: 'getTeacherDevices',
  path: {},
  query: { limit: 2 },
  headers: {},
  body: undefined,
  version: 'test',
  loopback: true,
  signal: new AbortController().signal,
  principal: { role: 'teacher', revision: 1, hash: 'session' }
}

describe('stable traversal and terminal task retention', () => {
  it('continues after the preceding row is deleted, without repeating reordered rows or including new rows', async () => {
    const { service, advance } = await fixture()
    const first = service.page(context, ['a', 'b', 'c', 'd'], (id) => id)
    expect(first.items).toEqual(['a', 'b'])
    const next = { ...context, query: { limit: 2, cursor: first.nextCursor } }
    expect(service.page(next, ['d', 'a', 'new', 'c'], (id) => id)).toEqual({
      items: ['c', 'd'],
      nextCursor: null
    })
    expect(() =>
      service.page({ ...next, query: { ...next.query, room: 'different' } }, ['c'], (id) => id)
    ).toThrow('INVALID_REQUEST')
    expect(() =>
      service.page(
        { ...next, principal: { role: 'teacher', revision: 1, hash: 'other' } },
        ['c'],
        (id) => id
      )
    ).toThrow('INVALID_REQUEST')
    advance(16 * 60000)
    expect(() => service.page(next, ['c'], (id) => id)).toThrow('INVALID_REQUEST')
  })

  it('commits task expiration once and preserves completed results past lease expiry', async () => {
    const { service, advance } = await fixture()
    const device = randomUUID(),
      credential = randomUUID(),
      batch = randomUUID()
    service.db.run('INSERT INTO devices VALUES (?,?,?,?)', device, randomUUID(), '001', '{}')
    service.db.run('INSERT INTO device_credentials VALUES (?,?,?,NULL)', credential, device, 'hash')
    const task = service.tasks.create(batch, device, new Date(service.now() + 1000).toISOString(), {
      type: 'history-cleanup',
      phase: 'preview',
      planId: randomUUID(),
      submittedBefore: new Date().toISOString()
    })
    advance(1001)
    service.tasks.expire()
    expect(service.tasks.task(service.tasks.row(task.id))).toMatchObject({
      status: 'expired',
      revision: 2
    })
    service.tasks.expire()
    expect(service.tasks.task(service.tasks.row(task.id)).revision).toBe(2)
    const successful = { ...task, id: randomUUID(), status: 'succeeded' as const }
    service.db.run(
      'INSERT INTO tasks VALUES (?,?,?,?,?,?,?)',
      successful.id,
      batch,
      device,
      credential,
      'succeeded',
      service.now() - 10,
      JSON.stringify(successful)
    )
    service.db.run(
      'INSERT INTO task_leases VALUES (?,?,?,?,?,NULL)',
      randomUUID(),
      successful.id,
      device,
      randomUUID(),
      service.now() - 1
    )
    expect(service.tasks.task(service.tasks.row(successful.id)).status).toBe('succeeded')
    advance(91 * 86400000)
    service.tasks.retain()
    expect(service.db.all('SELECT * FROM tasks')).toEqual([])
    expect(service.db.all('SELECT * FROM device_credentials')).toHaveLength(1)
  })
})
