import { afterEach, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeSubmissionPackage } from '@ls101/exam-package'
import { StudentRecords } from '../records'
import type { PracticeIntent } from '../shared'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ls101-records-'))
  roots.push(root)
  const records = new StudentRecords(root)
  await records.initialize()
  const intent: PracticeIntent = {
    submissionId: randomUUID(),
    examId: randomUUID(),
    candidate: { displayName: 'Student', candidateId: '1' },
    binding: {
      serverId: randomUUID(),
      deviceId: randomUUID(),
      contextId: randomUUID(),
      baseUrl: 'https://127.0.0.1/',
      fingerprint: `sha256:${'a'.repeat(64)}`,
      maintenanceLocked: false,
      versionMismatch: false,
      generation: 1
    }
  }
  const bytes = await encodeSubmissionPackage(
    {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: {
        submissionId: intent.submissionId,
        examPackageId: 'fixture',
        examTitle: 'Fixture',
        candidate: intent.candidate,
        startedAt: new Date().toISOString(),
        submittedAt: new Date().toISOString()
      },
      schemaUses: [],
      resources: {},
      answers: { strings: [], audios: [] }
    },
    {}
  )
  const expectation = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length
  }
  return { root, records, intent, bytes, expectation }
}

it('validates chunk ownership/order and only returns success after archive and record exist', async () => {
  const f = await fixture()
  const handle = await f.records.begin(1, f.intent, f.expectation)
  await expect(f.records.chunk(2, handle, 0, f.bytes)).rejects.toThrow('chunk')
  await expect(f.records.chunk(1, handle, 1, f.bytes)).rejects.toThrow('chunk')
  await f.records.chunk(1, handle, 0, f.bytes)
  const record = await f.records.finish(1, handle, f.expectation.sha256)
  expect(record).toMatchObject({
    state: 'queued',
    resultKnowledge: 'never-sent',
    archiveBytes: f.bytes.length
  })
  expect(await readFile(f.records.archivePath(record.submissionId))).toEqual(Buffer.from(f.bytes))
  expect(await f.records.get(record.submissionId)).toEqual(record)
})

it('recovers a published archive after a crash before record publication', async () => {
  const f = await fixture()
  const handle = await f.records.begin(1, f.intent, f.expectation)
  await f.records.chunk(1, handle, 0, f.bytes)
  await rename(
    join(f.root, 'submissions', f.intent.submissionId, `${handle}.part`),
    f.records.archivePath(f.intent.submissionId)
  )
  const restarted = new StudentRecords(f.root)
  await restarted.initialize()
  expect(await restarted.get(f.intent.submissionId)).toMatchObject({
    state: 'queued',
    archiveSha256: f.expectation.sha256
  })
})

it('never promotes an incomplete temporary archive to a queued submission', async () => {
  const f = await fixture()
  const handle = await f.records.begin(1, f.intent, f.expectation)
  await f.records.chunk(1, handle, 0, f.bytes.slice(0, 20))
  const restarted = new StudentRecords(f.root)
  await restarted.initialize()
  expect(await restarted.list()).toEqual([])
  expect(
    JSON.parse(
      await readFile(join(f.root, 'submissions', f.intent.submissionId, 'interrupted.json'), 'utf8')
    )
  ).toEqual({ reason: 'incomplete-archive' })
  await expect(
    readFile(join(f.root, 'submissions', f.intent.submissionId, `${handle}.part`))
  ).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects corruption, identity replacement and stale revisions', async () => {
  const f = await fixture()
  const handle = await f.records.begin(1, f.intent, f.expectation)
  await f.records.chunk(1, handle, 0, f.bytes)
  const record = await f.records.finish(1, handle, f.expectation.sha256)
  await expect(f.records.compareAndSwap(record.submissionId, 0, record)).rejects.toThrow('revision')
  await expect(
    f.records.compareAndSwap(record.submissionId, 1, { ...record, examId: randomUUID() })
  ).rejects.toThrow('Immutable')
  await expect(
    f.records.compareAndSwap(record.submissionId, 1, { ...record, state: 'completed' })
  ).rejects.toThrow('receipt')
  await expect(
    f.records.begin(1, f.intent, { ...f.expectation, sha256: 'b'.repeat(64) })
  ).rejects.toThrow('identity')
  await writeFile(f.records.archivePath(record.submissionId), 'corrupt')
  await expect(new StudentRecords(f.root).initialize()).rejects.toThrow('integrity')
})

async function completedFixture() {
  const f = await fixture()
  const handle = await f.records.begin(1, f.intent, f.expectation)
  await f.records.chunk(1, handle, 0, f.bytes)
  const queued = await f.records.finish(1, handle, f.expectation.sha256)
  const completed = await f.records.compareAndSwap(queued.submissionId, queued.revision, {
    ...queued,
    state: 'completed',
    resultKnowledge: 'received',
    retryPolicy: 'none',
    completedAt: new Date().toISOString(),
    receipt: {
      status: 'received',
      receipt: {
        receiptId: randomUUID(),
        serverId: f.intent.binding.serverId,
        deviceId: f.intent.binding.deviceId,
        submissionId: f.intent.submissionId,
        archiveSha256: f.expectation.sha256,
        receivedAt: new Date().toISOString()
      }
    }
  })
  return { ...f, completed }
}

it('cleanup verifies the confirmed snapshot and lease, keeps receipts, and counts deletion once', async () => {
  const f = await completedFixture(),
    planId = randomUUID(),
    taskId = randomUUID()
  const snapshot = await f.records.preview(planId, new Date(Date.now() + 1000).toISOString())
  expect(snapshot.selection).toHaveLength(1)
  await expect(f.records.cleanupItem(taskId, planId, 'b'.repeat(64), 0)).rejects.toThrow(
    'selection'
  )
  await expect(
    f.records.cleanupItem(taskId, planId, snapshot.digest, 0, () => {
      throw new Error('lease expired')
    })
  ).rejects.toThrow('lease expired')
  await readFile(f.records.archivePath(f.intent.submissionId))
  await f.records.cleanupItem(taskId, planId, snapshot.digest, 0)
  await f.records.cleanupItem(taskId, planId, snapshot.digest, 0)
  expect(await f.records.cleanupResult(taskId, 1)).toMatchObject({
    selectedCount: 1,
    deletedCount: 1,
    deletedBytes: f.bytes.length,
    failedCount: 0
  })
  expect(await f.records.get(f.intent.submissionId)).toMatchObject({
    archivePresent: false,
    state: 'completed',
    receipt: f.completed.receipt
  })
  await new StudentRecords(f.root).initialize()
})

it('restart finishes a logged deletion without repeating it or losing the successful receipt', async () => {
  const f = await completedFixture(),
    taskId = randomUUID()
  const directory = join(f.root, 'tasks', taskId, 'deletions')
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, `${f.intent.submissionId}.json`),
    JSON.stringify({ submissionId: f.intent.submissionId, status: 'intent', bytes: f.bytes.length })
  )
  await rm(f.records.archivePath(f.intent.submissionId))
  const restarted = new StudentRecords(f.root)
  await restarted.initialize()
  expect(await restarted.cleanupResult(taskId, 1)).toMatchObject({
    deletedCount: 1,
    deletedBytes: f.bytes.length
  })
  expect(await restarted.get(f.intent.submissionId)).toMatchObject({
    archivePresent: false,
    receipt: f.completed.receipt
  })
  await restarted.initialize()
  expect(await restarted.cleanupResult(taskId, 1)).toMatchObject({ deletedCount: 1 })
})

it('preview excludes unconfirmed submissions and a missing archive without intent is already absent', async () => {
  const f = await fixture(),
    handle = await f.records.begin(1, f.intent, f.expectation)
  await f.records.chunk(1, handle, 0, f.bytes)
  await f.records.finish(1, handle, f.expectation.sha256)
  expect(
    (await f.records.preview(randomUUID(), new Date(Date.now() + 1000).toISOString())).selection
  ).toEqual([])
  const completed = await completedFixture(),
    planId = randomUUID(),
    taskId = randomUUID()
  const snapshot = await completed.records.preview(
    planId,
    new Date(Date.now() + 1000).toISOString()
  )
  await rm(completed.records.archivePath(completed.intent.submissionId))
  await completed.records.cleanupItem(taskId, planId, snapshot.digest, 0)
  expect(await completed.records.cleanupResult(taskId, 1)).toMatchObject({
    deletedCount: 0,
    alreadyAbsentCount: 1,
    deletedBytes: 0
  })
})
