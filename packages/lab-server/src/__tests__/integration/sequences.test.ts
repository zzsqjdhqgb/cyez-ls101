import { afterEach, describe, expect, it } from 'vitest'
import { recordFailure, enroll, fixture, login, practice, type Fixture } from './support'

let f: Fixture | undefined
afterEach(async ({ task }) => {
  if (f && task.result?.state === 'fail') await recordFailure(f.root, task.name)
  await f?.close()
  f = undefined
})

describe('SEQ: seeded operation sequences checked against an independent receipt model', () => {
  it.each([101, 709, 20260920])(
    'seed %i: upload/query/delete/restart never invents or loses a receipt',
    async (seed) => {
      const current = (f = await fixture())
      const teacher = await login(current.endpoint)
      const [student] = await enroll(current.endpoint, teacher, 1)
      const entries = [] as Array<{
        p: Awaited<ReturnType<typeof practice>>
        state: 'not-received' | 'received' | 'deleted'
        receipt?: unknown
      }>
      for (let i = 0; i < 3; i++)
        entries.push({
          p: await practice(current.endpoint, teacher, student.token),
          state: 'not-received'
        })
      let random = seed >>> 0
      const next = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0
        return random
      }
      const trace: string[] = []
      for (let step = 0; step < 24; step++) {
        const entry = entries[step < 2 ? 0 : (next() >>> 16) % entries.length]
        const operation = step < 4 ? step : (next() >>> 16) % 4
        trace.push(`${step}:${operation}:${entries.indexOf(entry)}`)
        if (operation === 0) {
          const response = await entry.p.upload()
          expect(response.status, trace.join(',')).toBe(entry.state === 'not-received' ? 201 : 200)
          if (entry.state === 'not-received') {
            entry.state = 'received'
            entry.receipt = response.body.receipt
          }
          expect(response.body.receipt, trace.join(',')).toEqual(entry.receipt)
        } else if (operation === 1 && entry.state !== 'not-received') {
          expect(
            (await current.api('DELETE', `/teacher/submissions/${entry.p.id}`, { token: teacher }))
              .status,
            trace.join(',')
          ).toBe(204)
          entry.state = 'deleted'
        } else if (operation === 2) await current.restart()
        for (const expected of entries) {
          const observed = await expected.p.receipt()
          expect(observed.status, trace.join(',')).toBe(200)
          expect(observed.body.status, trace.join(',')).toBe(expected.state)
          if (expected.receipt)
            expect(observed.body.receipt, trace.join(',')).toEqual(expected.receipt)
        }
        const visible = await current.api('GET', '/teacher/submissions', { token: teacher })
        expect(
          visible.body.items.map((row: { id: string }) => row.id).sort(),
          trace.join(',')
        ).toEqual(
          entries
            .filter((entry) => entry.state === 'received')
            .map((entry) => entry.p.id)
            .sort()
        )
      }
    }
  )
})
