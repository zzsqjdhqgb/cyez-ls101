import type { Schema } from '@ls101/lab-contracts'
import { RemoteError } from '@ls101/lab-client'
import type { StudentRecord } from '@ls101/lab-desktop-host'

export interface SubmissionPorts {
  list(): Promise<StudentRecord[]>
  save(record: StudentRecord): Promise<StudentRecord>
  canQuery(record: StudentRecord): boolean
  canUpload(record: StudentRecord): boolean
  query(record: StudentRecord, signal: AbortSignal): Promise<Schema<'ReceiptQuery'>>
  upload(record: StudentRecord, signal: AbortSignal): Promise<Schema<'CompletedReceipt'>>
  changed(): void
}

export class SubmissionQueue {
  private active: AbortController | null = null
  private running = false
  private pause: string | null = null
  private readonly manualIntents = new Set<string>()
  private readonly nextCheck = new Map<string, number>()
  private readonly failures = new Map<string, number>()
  private settled: Promise<void> = Promise.resolve()
  private finishSettling: (() => void) | undefined
  constructor(
    private readonly ports: SubmissionPorts,
    private readonly now: () => number = Date.now
  ) {}

  async recover(currentContext: string): Promise<void> {
    for (const record of await this.ports.list()) {
      if (record.state === 'completed') continue
      let next = record
      if (record.originalBinding.contextId !== currentContext)
        next = { ...record, retryPolicy: 'receipt-only' }
      if (record.state === 'sending')
        next = {
          ...next,
          state: 'checking',
          resultKnowledge: 'unknown',
          retryPolicy:
            next.retryPolicy === 'receipt-only'
              ? 'receipt-only'
              : next.pauseReason === 'maintenance' && next.retryPolicy !== 'manual'
                ? 'automatic-maintenance'
                : 'manual'
        }
      if (next !== record) await this.ports.save(next)
    }
    this.ports.changed()
  }

  suspend(reason: string): void {
    this.pause = reason
    this.active?.abort()
  }
  resume(): void {
    this.pause = null
  }
  refresh(): void {
    this.failures.clear()
    this.nextCheck.clear()
  }
  async settle(): Promise<void> {
    await this.settled
  }

  async retry(id: string): Promise<void> {
    const record = (await this.ports.list()).find((entry) => entry.submissionId === id)
    if (
      !record ||
      record.state === 'completed' ||
      record.retryPolicy === 'receipt-only' ||
      !this.ports.canUpload(record)
    )
      return
    this.manualIntents.add(id)
    this.nextCheck.delete(id)
    this.failures.delete(id)
    await this.pump()
  }

  async pump(): Promise<void> {
    if (this.running || this.pause) return
    this.running = true
    this.settled = new Promise((resolve) => {
      this.finishSettling = resolve
    })
    try {
      for (let record of await this.ports.list()) {
        if (this.pause || record.state === 'completed' || record.state === 'manual-resolution')
          continue
        if (
          (this.nextCheck.get(record.submissionId) ?? 0) > this.now() ||
          (this.failures.get(record.submissionId) ?? 0) >= 3
        )
          continue
        const manual = this.manualIntents.has(record.submissionId)
        const queryFirst =
          record.resultKnowledge === 'unknown' || manual || record.retryPolicy === 'receipt-only'
        if (queryFirst && !this.ports.canQuery(record)) continue
        if (!queryFirst && !this.ports.canUpload(record)) continue
        this.active = new AbortController()
        try {
          if (queryFirst) {
            const receipt = await this.ports.query(record, this.active.signal)
            if (receipt.status === 'received' || receipt.status === 'deleted') {
              await this.complete(record, receipt)
              continue
            }
            if (receipt.status === 'receiving') {
              this.nextCheck.set(record.submissionId, this.now() + receipt.retryAfterSeconds * 1000)
              continue
            }
            record = await this.ports.save({
              ...record,
              resultKnowledge: 'not-received',
              state:
                record.retryPolicy === 'automatic-maintenance' || manual
                  ? 'queued'
                  : 'retry-required'
            })
            if (
              record.retryPolicy === 'receipt-only' ||
              (record.retryPolicy === 'manual' && !manual)
            )
              continue
          }
          const automatic =
            record.retryPolicy === 'automatic-first' ||
            record.retryPolicy === 'automatic-maintenance'
          if ((!manual && !automatic) || !this.ports.canUpload(record) || this.pause) continue
          this.manualIntents.delete(record.submissionId)
          record = await this.ports.save({
            ...record,
            state: 'sending',
            resultKnowledge: 'unknown',
            attemptId: crypto.randomUUID(),
            attemptCount: record.attemptCount + 1,
            pauseReason: null,
            retryPolicy: manual ? 'manual' : record.retryPolicy
          })
          const result = await this.ports.upload(record, this.active.signal)
          await this.complete(record, result)
        } catch (error) {
          const code = error instanceof RemoteError ? error.code : 'NETWORK_ERROR'
          const maintenance =
            code === 'SERVICE_MAINTENANCE' ||
            (this.pause === 'maintenance' && this.active.signal.aborted)
          const permanent = ['NOT_FOUND', 'CONTENT_CONFLICT', 'INVALID_SUBMISSION'].includes(code)
          const sending = record.state === 'sending'
          const next: StudentRecord = {
            ...record,
            state: permanent
              ? 'manual-resolution'
              : record.resultKnowledge === 'never-sent'
                ? 'queued'
                : 'checking',
            resultKnowledge: sending ? 'unknown' : record.resultKnowledge,
            retryPolicy:
              sending && !maintenance && record.retryPolicy !== 'receipt-only'
                ? 'manual'
                : sending &&
                    maintenance &&
                    record.retryPolicy !== 'manual' &&
                    record.retryPolicy !== 'receipt-only'
                  ? 'automatic-maintenance'
                  : record.retryPolicy,
            pauseReason: maintenance ? 'maintenance' : this.pause,
            lastError: maintenance ? record.lastError : code
          }
          await this.ports.save(next)
          if (code === 'SERVICE_NOT_READY')
            this.failures.set(
              record.submissionId,
              (this.failures.get(record.submissionId) ?? 0) + 1
            )
          const delay = Math.max(
            5,
            error instanceof RemoteError ? (error.retryAfter ?? 0) : 0,
            Math.min(60, 5 * 2 ** (this.failures.get(record.submissionId) ?? 0))
          )
          this.nextCheck.set(record.submissionId, this.now() + delay * 1000)
          this.manualIntents.delete(record.submissionId)
        } finally {
          this.active = null
          this.ports.changed()
        }
      }
    } finally {
      this.running = false
      this.finishSettling?.()
    }
  }

  private async complete(
    record: StudentRecord,
    receipt: Schema<'CompletedReceipt'>
  ): Promise<void> {
    const value = receipt.receipt
    if (
      value.submissionId !== record.submissionId ||
      value.serverId !== record.originalBinding.serverId ||
      value.deviceId !== record.originalBinding.deviceId ||
      value.archiveSha256 !== record.archiveSha256
    )
      throw new Error('Receipt identity mismatch')
    await this.ports.save({
      ...record,
      state: 'completed',
      resultKnowledge: 'received',
      retryPolicy: 'none',
      receipt,
      completedAt: new Date(this.now()).toISOString(),
      pauseReason: null,
      lastError: null
    })
    this.manualIntents.delete(record.submissionId)
  }
}
