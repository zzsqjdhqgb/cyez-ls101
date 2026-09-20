import { afterEach, expect, test } from 'vitest'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  recordFailure,
  enroll,
  fixture,
  heartbeat,
  login,
  practice,
  digest,
  type Fixture
} from '../../packages/lab-server/src/__tests__/integration/support'

let f: Fixture | undefined
afterEach(async ({ task }) => {
  if (f && task.result?.state === 'fail') await recordFailure(f.root, task.name)
  await f?.close()
  f = undefined
})

test('mixed heartbeat, download, receipt and teacher traffic preserves every committed archive', async () => {
  const rounds = Number(process.env.LS101_LAB_SOAK_ROUNDS ?? 20)
  expect(Number.isInteger(rounds) && rounds >= 1 && rounds <= 2000).toBe(true)
  const current = (f = await fixture())
  const teacher = await login(current.endpoint)
  const devices = await enroll(current.endpoint, teacher, 12)
  const practices: Array<Awaited<ReturnType<typeof practice>>> = []
  for (const device of devices)
    practices.push(await practice(current.endpoint, teacher, device.token))
  // At most eight archive receivers; exceeding that limit is tested separately as explicit 429.
  const receipts: unknown[] = []
  for (let offset = 0; offset < practices.length; offset += 4) {
    for (const result of await Promise.all(
      practices.slice(offset, offset + 4).map((p) => p.upload())
    )) {
      expect(result.status).toBe(201)
      receipts.push(result.body.receipt)
    }
  }
  const beats = devices.map(() => heartbeat())
  const measurements: Array<{ round: number; heapUsed: number; rss: number }> = []
  for (let round = 0; round < rounds; round++) {
    const results = await Promise.all(
      devices.map(async (device, index) => {
        const beat = await current.api('POST', '/student/heartbeat', {
          token: device.token,
          body: { ...beats[index], sequence: round + 1, phase: 'idle' }
        })
        expect(beat.status).toBe(200)
        expect(beat.body.heartbeatAccepted).toBe(true)
        const receipt = await practices[index].receipt()
        expect(receipt.body.receipt).toEqual(receipts[index])
        const downloaded = await current.api(
          'GET',
          `/student/exams/${practices[index].exam.examId}/archive`,
          { token: device.token }
        )
        expect(downloaded.status).toBe(200)
        expect(digest(downloaded.bytes)).toBe(digest(practices[index].examBytes))
        return receipt.status
      })
    )
    expect(results).toEqual(devices.map(() => 200))
    expect(
      (await current.api('GET', '/teacher/submissions', { token: teacher })).body.items
    ).toHaveLength(practices.length)
    await expect.poll(() => current.service.fileReferences.size).toBe(0)
    expect(current.service.transfers.size).toBe(0)
    expect(current.service.db.all('SELECT * FROM uploads')).toEqual([])
    if (round % 10 === 0) {
      const { heapUsed, rss } = process.memoryUsage()
      measurements.push({ round, heapUsed, rss })
      await current.restart()
    }
  }
  expect(await readdir(join(current.root, 'incoming'))).toEqual([])
  expect(await readdir(join(current.root, 'archives/submissions'))).toHaveLength(practices.length)
  // Resource measurements are evidence, not invented classroom performance acceptance thresholds.
  console.info(JSON.stringify({ devices: devices.length, rounds, measurements }))
})
