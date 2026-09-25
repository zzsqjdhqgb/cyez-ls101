import { RemoteError, type OperationInput } from '@ls101/lab-client'
import type { OperationId, Schema } from '@ls101/lab-contracts'
import type { LabHost, TaskJournal } from '@ls101/lab-desktop-host'

export interface MaintenancePorts {
  host: LabHost
  request<T>(operation: OperationId, input: OperationInput, signal?: AbortSignal): Promise<T>
  admitted(): boolean
  busy(value: boolean): Promise<void>
  changed(): void
  test?(
    lease: Schema<'TaskLease'>,
    signal: AbortSignal,
    progress: (cases: Schema<'CaseResult'>[]) => Promise<void>
  ): Promise<Schema<'TestResult'>>
}
export class MaintenanceQueue {
  private running = false
  private active: AbortController | null = null
  private readonly next = new Map<string, number>()
  private readonly failures = new Map<string, number>()
  private settled: Promise<void> = Promise.resolve()
  private finishSettling: (() => void) | undefined
  constructor(
    private readonly ports: MaintenancePorts,
    private readonly now: () => number = performance.now.bind(performance)
  ) {}
  suspend(): void {
    this.active?.abort()
  }
  refresh(): void {
    this.next.clear()
    this.failures.clear()
  }
  async settle(): Promise<void> {
    await this.settled
  }

  async pump(contextId: string, runtimeId: string): Promise<void> {
    if (this.running) return
    this.running = true
    this.settled = new Promise((resolve) => {
      this.finishSettling = resolve
    })
    try {
      const journals = await this.ports.host.invoke<TaskJournal[]>('tasks.listJournals')
      for (let journal of journals) {
        if (journal.contextId !== contextId || journal.reported) continue
        if (journal.lease && !journal.result) {
          journal = {
            ...journal,
            result: {
              leaseId: journal.lease.leaseId,
              status: 'expired',
              completedAt: new Date().toISOString(),
              result: journal.testCases
                ? { kind: 'deployment-test', cases: journal.testCases }
                : null,
              error: {
                code: 'EXECUTION_INTERRUPTED',
                message: '执行已中断，未继续旧租约。',
                occurredAt: new Date().toISOString()
              }
            }
          }
          if (
            journal.task.parameters.type === 'history-cleanup' &&
            journal.task.parameters.phase === 'execute' &&
            journal.selectedCount !== undefined
          ) {
            const result = await this.ports.host.invoke<Schema<'CleanupResult'>>(
              'tasks.cleanupResult',
              { taskId: journal.task.id, selectedCount: journal.selectedCount ?? 0 }
            )
            journal.result!.result = result
          }
          await this.save(journal)
        }
        if (journal.result) await this.report(journal)
      }
      if (!this.ports.admitted()) return
      const tasks = await this.ports.request<Schema<'TaskList'>>('getStudentTasks', {
        query: { limit: 100 }
      })
      for (const task of tasks.items) {
        if (!this.ports.admitted()) break
        if (
          (task.parameters.type === 'deployment-test' && !this.ports.test) ||
          !['pending', 'running'].includes(task.status)
        )
          continue
        const existing = journals.find((journal) => journal.task.id === task.id)
        if (existing?.lease || existing?.result || (existing && existing.runtimeId !== runtimeId))
          continue
        if ((this.next.get(task.id) ?? 0) > this.now() || (this.failures.get(task.id) ?? 0) >= 3)
          continue
        await this.execute(
          existing ?? {
            schemaVersion: 1,
            contextId,
            task,
            runtimeId,
            lease: null,
            result: null,
            reported: false
          }
        )
      }
    } finally {
      this.running = false
      this.finishSettling?.()
      this.ports.changed()
    }
  }
  private save(journal: TaskJournal): Promise<void> {
    return this.ports.host.invoke('tasks.saveJournal', journal)
  }
  private async execute(initial: TaskJournal): Promise<void> {
    let journal = initial
    await this.save(journal)
    const abort = new AbortController()
    this.active = abort
    let expiry: ReturnType<typeof setTimeout> | undefined,
      renewal: ReturnType<typeof setTimeout> | undefined
    let renewing: Promise<void> | undefined
    let selectedCount = 0
    try {
      const started = this.now()
      const lease = await this.ports.request<Schema<'TaskLease'>>(
        'postStudentTasksIdClaim',
        {
          path: { id: journal.task.id },
          body: { runtimeId: journal.runtimeId }
        },
        abort.signal
      )
      journal = { ...journal, lease }
      await this.save(journal)
      const setDeadline = (value: Schema<'TaskLease'>, sent: number): void => {
        clearTimeout(expiry)
        const remaining =
          sent + Date.parse(value.leaseExpiresAt) - Date.parse(value.serverTime) - this.now()
        if (value.cancelRequested) abort.abort()
        else if (remaining <= 0) abort.abort(new DOMException('Task lease expired', 'TimeoutError'))
        else
          expiry = setTimeout(
            () => abort.abort(new DOMException('Task lease expired', 'TimeoutError')),
            remaining
          )
      }
      setDeadline(lease, started)
      const renew = async (): Promise<void> => {
        if (abort.signal.aborted) return
        try {
          const sent = this.now()
          const next = await this.ports.request<Schema<'TaskLease'>>(
            'putStudentTasksIdLease',
            {
              path: { id: journal.task.id },
              body: { leaseId: lease.leaseId, runtimeId: journal.runtimeId }
            },
            abort.signal
          )
          if (abort.signal.aborted) return
          setDeadline(next, sent)
          renewal = setTimeout(() => {
            renewing = renew()
          }, 5000)
        } catch {
          abort.abort()
        }
      }
      renewal = setTimeout(() => {
        renewing = renew()
      }, 5000)
      abort.signal.throwIfAborted()
      if (!this.ports.admitted()) throw new Error('维护准入已变化')
      await this.ports.busy(true)
      const parameters = lease.parameters
      const capabilityInput = { taskId: journal.task.id, leaseId: lease.leaseId }
      let result: Schema<'PreviewResult'> | Schema<'CleanupResult'> | Schema<'TestResult'>
      if (parameters.type === 'deployment-test') {
        if (!this.ports.test) throw new Error('Unsupported maintenance task')
        result = await this.ports.test(lease, abort.signal, async (testCases) => {
          journal = { ...journal, testCases: [...testCases] }
          await this.save(journal)
        })
      } else if (parameters.phase === 'preview') {
        const snapshot = await this.ports.host.invoke<{
          digest: string
          bytes: number
          selection: unknown[]
        }>('cleanup.preview', capabilityInput)
        result = {
          kind: 'history-preview',
          selectionDigest: snapshot.digest,
          selectedCount: snapshot.selection.length,
          selectedBytes: snapshot.bytes
        }
      } else {
        const snapshot = await this.ports.host.invoke<{ selection: unknown[] }>(
          'cleanup.snapshot',
          capabilityInput
        )
        selectedCount = snapshot.selection.length
        journal = { ...journal, selectedCount }
        await this.save(journal)
        for (let index = 0; index < selectedCount; index++) {
          abort.signal.throwIfAborted()
          await this.ports.host.invoke('cleanup.item', { ...capabilityInput, index })
        }
        result = await this.ports.host.invoke('tasks.cleanupResult', {
          taskId: journal.task.id,
          selectedCount
        })
      }
      abort.signal.throwIfAborted()
      journal = {
        ...journal,
        result: {
          leaseId: lease.leaseId,
          status:
            (result.kind === 'history-execute' &&
              (result.failedCount > 0 || result.skippedCount > 0)) ||
            (result.kind === 'deployment-test' &&
              result.cases.some((item) => !['passed', 'manual-required'].includes(item.status)))
              ? 'failed'
              : 'succeeded',
          completedAt: new Date().toISOString(),
          result,
          error: null
        }
      }
    } catch (error) {
      if (!journal.lease) {
        this.backoff(journal.task.id, error)
        return
      }
      const partial =
        journal.task.parameters.type === 'history-cleanup' &&
        journal.task.parameters.phase === 'execute' &&
        journal.selectedCount !== undefined
          ? await this.ports.host.invoke<Schema<'CleanupResult'>>('tasks.cleanupResult', {
              taskId: journal.task.id,
              selectedCount
            })
          : journal.testCases
            ? { kind: 'deployment-test' as const, cases: journal.testCases }
            : null
      journal = {
        ...journal,
        result: {
          leaseId: journal.lease.leaseId,
          status: abort.signal.aborted
            ? abort.signal.reason?.name === 'TimeoutError'
              ? 'expired'
              : 'cancelled'
            : 'failed',
          completedAt: new Date().toISOString(),
          result: partial,
          error: {
            code: abort.signal.aborted ? 'LEASE_STOPPED' : 'EXECUTION_FAILED',
            message: '维护执行已停止。',
            occurredAt: new Date().toISOString()
          }
        }
      }
    } finally {
      clearTimeout(expiry)
      clearTimeout(renewal)
      abort.abort()
      await renewing
      this.active = null
      if (journal.lease) await this.ports.busy(false)
    }
    await this.save(journal)
    await this.report(journal)
  }
  private async report(journal: TaskJournal): Promise<void> {
    const key = `report:${journal.task.id}`
    if ((this.next.get(key) ?? 0) > this.now() || (this.failures.get(key) ?? 0) >= 3) return
    try {
      await this.ports.request('putStudentTasksIdResult', {
        path: { id: journal.task.id },
        body: journal.result
      })
      await this.save({ ...journal, reported: true })
    } catch (error) {
      this.backoff(key, error)
    }
  }
  private backoff(key: string, error: unknown): void {
    const count = (this.failures.get(key) ?? 0) + 1
    const unavailable = error instanceof RemoteError && error.code === 'SERVICE_NOT_READY'
    if (unavailable) this.failures.set(key, count)
    this.next.set(
      key,
      this.now() +
        Math.max(
          Math.min(10000, 1000 * 2 ** (count - 1)),
          error instanceof RemoteError ? (error.retryAfter ?? 0) * 1000 : 0
        )
    )
  }
}
