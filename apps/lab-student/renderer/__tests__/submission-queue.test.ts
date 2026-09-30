import { expect, it, vi } from 'vitest'
import type { Schema } from '@ls101/lab-contracts'
import { RemoteError } from '@ls101/lab-client'
import type { StudentRecord } from '@ls101/lab-desktop-host'
import { SubmissionQueue, type SubmissionPorts } from '../submission-queue'

function fixture(patch: Partial<StudentRecord> = {}) {
  let record: StudentRecord = {
    schemaVersion: 1,
    revision: 1,
    submissionId: crypto.randomUUID(),
    originalBinding: {
      serverId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      contextId: crypto.randomUUID(),
      baseUrl: 'https://127.0.0.1/',
      fingerprint: `sha256:${'0'.repeat(64)}`,
      generation: 1,
      maintenanceLocked: false,
      versionMismatch: false
    },
    examId: crypto.randomUUID(),
    candidate: { candidateId: '1', displayName: 'Student' },
    submittedAt: new Date().toISOString(),
    archiveSha256: 'a'.repeat(64),
    archiveBytes: 100,
    state: 'queued',
    attemptId: null,
    attemptCount: 0,
    resultKnowledge: 'never-sent',
    retryPolicy: 'automatic-first',
    pauseReason: null,
    lastError: null,
    receipt: null,
    completedAt: null,
    archivePresent: true,
    ...patch
  }
  const receipt: Schema<'CompletedReceipt'> = {
    status: 'received',
    receipt: {
      receiptId: crypto.randomUUID(),
      serverId: record.originalBinding.serverId,
      deviceId: record.originalBinding.deviceId,
      submissionId: record.submissionId,
      archiveSha256: record.archiveSha256,
      receivedAt: new Date().toISOString()
    }
  }
  let now = 1000
  const ports: SubmissionPorts = {
    list: vi.fn(async () => [structuredClone(record)]),
    save: vi.fn(async (next) => {
      if (next.revision !== record.revision) throw new Error('CAS conflict')
      record = structuredClone({ ...next, revision: next.revision + 1 })
      return structuredClone(record)
    }),
    canQuery: () => true,
    canUpload: () => true,
    query: vi.fn(async () => ({ status: 'not-received' as const })),
    upload: vi.fn(async () => receipt),
    changed: vi.fn()
  }
  const queue = new SubmissionQueue(ports, () => now)
  return {
    ports,
    queue,
    receipt,
    record: () => record,
    advance: () => {
      now += 120000
    }
  }
}

it('persists sending before network bytes and permanently stops after a receipt', async () => {
  const f = fixture()
  f.ports.upload = vi.fn(async () => {
    expect(f.record()).toMatchObject({
      state: 'sending',
      resultKnowledge: 'unknown',
      attemptCount: 1
    })
    return f.receipt
  })
  await f.queue.pump()
  expect(f.record()).toMatchObject({ state: 'completed', retryPolicy: 'none', receipt: f.receipt })
  await f.queue.recover(crypto.randomUUID())
  await f.queue.retry(f.record().submissionId)
  await f.queue.pump()
  expect(f.ports.upload).toHaveBeenCalledTimes(1)
  expect(f.ports.query).not.toHaveBeenCalled()
})

it.each([new Error('disconnected'), new RemoteError('SERVICE_NOT_READY', 503)])(
  'ordinary failure stays manual after maintenance and restart: %s',
  async (error) => {
    const f = fixture()
    f.ports.upload = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(f.receipt)
    await f.queue.pump()
    expect(f.record()).toMatchObject({ retryPolicy: 'manual', resultKnowledge: 'unknown' })
    f.queue.suspend('maintenance')
    f.queue.resume()
    f.advance()
    await f.queue.recover(f.record().originalBinding.contextId)
    await f.queue.pump()
    expect(f.record()).toMatchObject({
      state: 'retry-required',
      resultKnowledge: 'not-received',
      retryPolicy: 'manual'
    })
    expect(f.ports.upload).toHaveBeenCalledTimes(1)
    await f.queue.retry(f.record().submissionId)
    expect(f.ports.query).toHaveBeenCalledTimes(2)
    expect(f.ports.upload).toHaveBeenCalledTimes(2)
    expect(f.record().state).toBe('completed')
  }
)

it('maintenance rejection queries the receipt before reusing the original archive', async () => {
  const f = fixture()
  f.ports.upload = vi
    .fn()
    .mockRejectedValueOnce(new RemoteError('SERVICE_MAINTENANCE', 409))
    .mockResolvedValue(f.receipt)
  await f.queue.pump()
  expect(f.record()).toMatchObject({ retryPolicy: 'automatic-maintenance', lastError: null })
  f.advance()
  await f.queue.pump()
  expect(f.ports.query).toHaveBeenCalledTimes(1)
  expect(f.ports.upload).toHaveBeenCalledTimes(2)
  expect(f.record().state).toBe('completed')
})

it('a lost upload response can complete through a deleted receipt without resending', async () => {
  const f = fixture({ state: 'sending', resultKnowledge: 'unknown' })
  f.ports.query = vi.fn(async () => ({
    ...f.receipt,
    status: 'deleted' as const,
    deletedAt: new Date().toISOString()
  }))
  await f.queue.recover(f.record().originalBinding.contextId)
  expect(f.record().retryPolicy).toBe('manual')
  await f.queue.pump()
  expect(f.record().state).toBe('completed')
  expect(f.ports.upload).not.toHaveBeenCalled()
})

it('rebind keeps incomplete records receipt-only even after manual retry', async () => {
  const f = fixture()
  await f.queue.recover(crypto.randomUUID())
  await f.queue.pump()
  await f.queue.retry(f.record().submissionId)
  expect(f.record().retryPolicy).toBe('receipt-only')
  expect(f.ports.upload).not.toHaveBeenCalled()
})

it('receiving honors Retry-After and never overlaps upload', async () => {
  const f = fixture({ state: 'checking', resultKnowledge: 'unknown', retryPolicy: 'manual' })
  f.ports.query = vi
    .fn()
    .mockResolvedValueOnce({ status: 'receiving', retryAfterSeconds: 30 })
    .mockResolvedValue(f.receipt)
  await f.queue.pump()
  await f.queue.pump()
  expect(f.ports.query).toHaveBeenCalledTimes(1)
  f.advance()
  await f.queue.pump()
  expect(f.record().state).toBe('completed')
  expect(f.ports.upload).not.toHaveBeenCalled()
})

it('receipt persistence failure preserves the archive and requires confirmation', async () => {
  const f = fixture()
  const save = f.ports.save
  f.ports.save = vi.fn(async (record) => {
    if (record.receipt) throw new Error('disk full')
    return save(record)
  })
  await f.queue.pump()
  expect(f.record()).toMatchObject({
    state: 'checking',
    resultKnowledge: 'unknown',
    retryPolicy: 'manual',
    receipt: null,
    archivePresent: true
  })
  expect(f.ports.upload).toHaveBeenCalledTimes(1)
})

it('service-not-ready receipt checks stop after three failures until refreshed', async () => {
  const f = fixture({ state: 'checking', resultKnowledge: 'unknown', retryPolicy: 'manual' })
  f.ports.query = vi.fn().mockRejectedValue(new RemoteError('SERVICE_NOT_READY', 503))
  for (let i = 0; i < 5; i++) {
    f.advance()
    await f.queue.pump()
  }
  expect(f.ports.query).toHaveBeenCalledTimes(3)
  f.queue.refresh()
  await f.queue.pump()
  expect(f.ports.query).toHaveBeenCalledTimes(4)
  expect(f.ports.upload).not.toHaveBeenCalled()
})
