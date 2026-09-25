import type { LicenseActivationResult, LicenseStatus } from '@ls101/core-types'
import type { ExamPlayerProps } from '@ls101/exam-player'
import { LabClient, RemoteError, type LabTransport } from '@ls101/lab-client'
import type { Schema } from '@ls101/lab-contracts'
import type {
  BindingSummary,
  LabHost,
  PracticeIntent,
  StudentRecord
} from '@ls101/lab-desktop-host'
import { admission, canViewRecords, type AdmissionFacts } from './admission'
import { SubmissionQueue } from './submission-queue'
import { MaintenanceQueue } from './maintenance-queue'
import { runDeploymentTests } from './deployment-tests'

type Phase = 'idle' | 'preparing' | 'practicing' | 'saving' | 'testing' | 'error'
interface Connection {
  connectionId: string
  epoch: number
  info: Schema<'Info'>
}
interface Archive {
  handle: string
  sha256: string
  bytes: number
}
export interface StudentView extends AdmissionFacts {
  loading: boolean
  version: string
  computerName: string
  phase: Phase
  records: StudentRecord[]
  exams: Schema<'StudentExam'>[]
  player: { exam: Schema<'StudentExam'>; baseUrl: string } | null
  testPlayer: {
    baseUrl: string
    lease: Schema<'TaskLease'>
    signal: AbortSignal
    finish(archive: Blob): void
    fail(error: Error): void
  } | null
  testCase: string | null
  error: string | null
}

export class StudentController {
  private view: StudentView = {
    loading: true,
    active: false,
    initialized: false,
    binding: null,
    connected: false,
    state: null,
    version: '',
    computerName: '',
    phase: 'idle',
    records: [],
    exams: [],
    player: null,
    testPlayer: null,
    testCase: null,
    error: null
  }
  private readonly listeners = new Set<() => void>()
  private connection: Connection | null = null
  private readonly oldConnections = new Map<string, Connection>()
  private readonly transport: LabTransport
  private readonly queue: SubmissionQueue
  private readonly maintenance: MaintenanceQueue
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private pollRunning = false
  private rebinding = false
  private commandsPending = false
  private generation = 0
  private reconnectFailures = 0
  private revoked = false
  private intent: PracticeIntent | null = null
  private intentCreated = 0
  private position: { pageIndex: number | null; stepIndex: number | null } = {
    pageIndex: null,
    stepIndex: null
  }
  private readonly requests = new Set<AbortController>()
  private unsubscribe: (() => void) | undefined

  constructor(private readonly host: LabHost) {
    this.transport = {
      request: async (connectionId, operationId, input, signal) => {
        const requestId = crypto.randomUUID()
        const cancel = (): void => {
          void host.invoke('transport.cancel', requestId)
        }
        signal?.throwIfAborted()
        signal?.addEventListener('abort', cancel, { once: true })
        try {
          return await host.invoke('transport.request', {
            connectionId,
            operationId,
            input,
            requestId
          })
        } finally {
          signal?.removeEventListener('abort', cancel)
        }
      }
    }
    this.queue = new SubmissionQueue({
      list: () => host.invoke('records.list'),
      save: (record) => host.invoke('records.cas', record),
      canQuery: () => this.ready(),
      canUpload: (record) =>
        this.ready() && record.originalBinding.contextId === this.view.binding?.contextId,
      query: async (record, signal) => {
        let connection = this.connection!
        if (record.originalBinding.contextId !== this.view.binding?.contextId) {
          connection =
            this.oldConnections.get(record.originalBinding.contextId) ??
            (await host.invoke<Connection>('binding.connect', record.originalBinding.contextId))
          this.oldConnections.set(record.originalBinding.contextId, connection)
          const state = await this.client(connection).request<Schema<'StudentState'>>(
            'getStudentState',
            {},
            signal
          )
          if (state.availability !== 'ready' || state.releaseVersion !== this.view.version)
            throw new Error('原服务暂不允许核对回执')
        }
        return this.client(connection).request(
          'getStudentSubmissionsSubmissionIdReceipt',
          {
            path: { submissionId: record.submissionId }
          },
          signal
        )
      },
      upload: async (record, signal) => {
        const connection = this.connection!
        const archive = await host.invoke<Archive>('records.uploadHandle', {
          id: record.submissionId,
          connectionId: connection.connectionId
        })
        return this.client(connection).request(
          'putStudentSubmissionsSubmissionId',
          {
            path: { submissionId: record.submissionId },
            archive
          },
          signal
        )
      },
      changed: () => {
        void this.refreshRecords().catch((error) => this.fail(error))
      }
    })
    this.maintenance = new MaintenanceQueue({
      host,
      request: (operation, input, signal) => this.client().request(operation, input, signal),
      admitted: () =>
        admission(this.view) === 'maintenance' &&
        this.view.connected &&
        this.view.phase === 'idle' &&
        !this.view.player,
      busy: (busy) => this.setPhase(busy ? 'testing' : 'idle'),
      test: async (lease, signal, progress) => {
        const connection = this.connection!
        try {
          return await runDeploymentTests(
            {
              host,
              connectionId: connection.connectionId,
              request: (operation, input, signal) =>
                this.client(connection).request(operation, input, signal),
              status: (testCase) => this.update({ testCase }),
              play: (baseUrl, lease, signal) =>
                new Promise<Blob>((resolve, reject) => {
                  signal.throwIfAborted()
                  let settled = false
                  const finish = (archive?: Blob, error?: Error): void => {
                    if (settled) return
                    settled = true
                    signal.removeEventListener('abort', cancel)
                    this.update({ testPlayer: null })
                    if (archive) resolve(archive)
                    else reject(error ?? new Error('Deployment playback stopped'))
                  }
                  const cancel = (): void =>
                    finish(undefined, new Error('Deployment lease stopped'))
                  signal.addEventListener('abort', cancel, { once: true })
                  this.update({
                    testPlayer: {
                      baseUrl,
                      lease,
                      signal,
                      finish: (archive) => finish(archive),
                      fail: (error) => finish(undefined, error)
                    }
                  })
                })
            },
            lease,
            signal,
            progress
          )
        } finally {
          this.update({ testPlayer: null, testCase: null })
        }
      },
      changed: () => {
        void this.refreshRecords().catch((error) => this.fail(error))
      }
    })
  }

  getSnapshot = (): StudentView => this.view
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private update(next: Partial<StudentView>): void {
    this.view = { ...this.view, ...next }
    for (const listener of this.listeners) listener()
  }
  private fail(error: unknown): void {
    this.update({ error: error instanceof Error ? error.message : String(error) })
  }
  private client(connection = this.connection!): LabClient {
    if (!connection) throw new Error('服务尚未连接')
    return new LabClient(connection.connectionId, this.transport)
  }
  private ready(): boolean {
    return admission(this.view) === 'ready'
  }

  async start(): Promise<void> {
    this.unsubscribe = this.host.onEvent((event) => {
      if (event.type === 'startup-command') void this.commands().catch((error) => this.fail(error))
      if (event.type === 'close-blocked') this.fail(String(event.value))
    })
    try {
      const startup = await this.host.invoke<{
        version: string
        computerName: string
        initializationError: string | null
      }>('startup.status')
      this.update({
        version: startup.version,
        computerName: startup.computerName,
        initialized: !startup.initializationError,
        error: startup.initializationError
      })
      await this.commands()
    } catch (error) {
      this.fail(error)
    } finally {
      this.update({ loading: false })
      await this.poll()
    }
  }
  async stop(): Promise<void> {
    this.stopped = true
    this.generation++
    clearTimeout(this.timer)
    this.unsubscribe?.()
    this.queue.suspend('shutdown')
    this.maintenance.suspend()
    for (const request of this.requests) request.abort()
    await Promise.all([this.queue.settle(), this.maintenance.settle()])
    await this.disconnect()
  }
  async activate(code: string): Promise<void> {
    const result = await this.host.invoke<LicenseActivationResult>('license.activate', code)
    if (!result.activated)
      throw new Error(result.reason === 'expired' ? '许可已到期' : '激活码无效')
    await this.refresh()
  }
  private async commands(): Promise<void> {
    this.commandsPending = true
    if (this.rebinding) return
    this.rebinding = true
    this.generation++
    clearTimeout(this.timer)
    try {
      this.queue.suspend('rebind')
      this.maintenance.suspend()
      await Promise.all([this.queue.settle(), this.maintenance.settle()])
      do {
        this.commandsPending = false
        const results =
          await this.host.invoke<Array<{ type?: string; error?: string }>>('startup.commands')
        if (results.some((result) => result.type === 'enroll' && !result.error)) {
          this.revoked = false
          this.reconnectFailures = 0
        }
        const failure = results.find((result) => result.error)
        if (failure) this.update({ error: failure.error })
        if (results.length) await this.disconnect()
      } while (this.commandsPending && !this.stopped)
    } finally {
      this.rebinding = false
      if (!this.stopped)
        this.timer = setTimeout(() => {
          void this.poll()
        }, 0)
    }
  }
  private async disconnect(): Promise<void> {
    const connections = [
      ...this.oldConnections.values(),
      ...(this.connection ? [this.connection] : [])
    ]
    this.connection = null
    this.oldConnections.clear()
    for (const connection of connections)
      await this.host.invoke('connections.close', connection.connectionId)
    this.update({ connected: false })
  }
  async refresh(): Promise<void> {
    this.revoked = false
    this.reconnectFailures = 0
    this.queue.refresh()
    this.maintenance.refresh()
    clearTimeout(this.timer)
    await this.poll()
  }
  private async poll(): Promise<void> {
    if (this.stopped || this.rebinding || this.pollRunning) return
    const generation = this.generation
    this.pollRunning = true
    let delay = 5000
    try {
      const license = await this.host.invoke<LicenseStatus>('license.status')
      if (generation !== this.generation) return
      this.update({ active: license.state === 'active' })
      if (!this.view.active || !this.view.initialized) return
      const serverConfigured = await this.host.invoke<boolean>('binding.configured')
      if (generation !== this.generation) return
      this.update({ serverConfigured })
      const binding = await this.host.invoke<BindingSummary | null>('binding.summary')
      if (generation !== this.generation) return
      this.update({ binding })
      if (!binding || this.revoked) return
      if (!this.connection) {
        const opened = await this.host.invoke<Connection>('binding.connect')
        if (generation !== this.generation) {
          await this.host.invoke('connections.close', opened.connectionId)
          return
        }
        this.connection = opened
        this.update({ state: null })
        await this.queue.recover(binding.contextId)
      }
      const connection = this.connection
      const runtime =
        await this.host.invoke<
          Pick<Schema<'Heartbeat'>, 'runtimeId' | 'runtimeGeneration' | 'sequence'>
        >('binding.runtime')
      const records = await this.host.invoke<StudentRecord[]>('records.list')
      const heartbeat: Schema<'Heartbeat'> = {
        ...runtime,
        activationState: 'active',
        phase:
          this.view.phase === 'idle' && binding.maintenanceLocked
            ? 'maintenance-idle'
            : this.view.phase,
        currentPractice:
          this.intent && this.view.phase === 'practicing'
            ? {
                submissionId: this.intent.submissionId,
                examId: this.intent.examId,
                candidate: this.intent.candidate,
                ...this.position
              }
            : null,
        submissionSummary: summarize(records),
        lastError: null
      }
      const state = await this.client(connection).request<Schema<'HeartbeatResponse'>>(
        'postStudentHeartbeat',
        { body: heartbeat }
      )
      if (connection !== this.connection || this.stopped || generation !== this.generation) return
      if (!state.heartbeatAccepted)
        throw new Error('另一个实例已接管此计算机，请关闭旧实例后重新启动')
      const prior = this.view.state
      if (
        prior &&
        (state.modeRevision < prior.modeRevision || state.device.revision < prior.device.revision)
      )
        return
      const observed = await this.host.invoke<BindingSummary>('binding.observe', {
        contextId: binding.contextId,
        epoch: connection.epoch,
        state
      })
      if (generation !== this.generation || connection !== this.connection) return
      this.update({ state, binding: observed, connected: true, records })
      this.reconnectFailures = 0
      if (this.ready()) {
        this.queue.resume()
        void this.queue.pump().catch((error) => this.fail(error))
        if (!this.view.player) await this.loadExams()
      } else this.queue.suspend(admission(this.view))
      if (['maintenance', 'ready'].includes(admission(this.view)))
        void this.maintenance
          .pump(binding.contextId, runtime.runtimeId)
          .catch((error) => this.fail(error))
    } catch (error) {
      if (generation !== this.generation) return
      const code = error instanceof RemoteError ? error.code : null
      if (code === 'AUTH_REQUIRED' || code === 'TOKEN_REVOKED' || code === 'TOKEN_EXPIRED')
        this.revoked = true
      this.queue.suspend('offline')
      this.maintenance.suspend()
      this.update({ connected: false })
      this.fail(error)
      await this.disconnect()
      delay = Math.max(
        [1000, 2000, 5000, 10000][Math.min(this.reconnectFailures++, 3)],
        error instanceof RemoteError ? (error.retryAfter ?? 0) * 1000 : 0
      )
    } finally {
      this.pollRunning = false
      if (generation !== this.generation) {
        if (!this.stopped && !this.rebinding)
          this.timer = setTimeout(() => {
            void this.poll()
          }, 0)
      } else {
        const gate = admission(this.view)
        if (gate !== 'ready') this.queue.suspend(gate)
        if (gate !== 'maintenance') this.maintenance.suspend()
        if (
          ['activation-required', 'version-mismatch'].includes(gate) &&
          this.view.phase !== 'saving'
        )
          await this.exitPractice()
        if (this.view.active && this.view.initialized)
          await this.host.invoke(
            'window.maintenance',
            this.view.binding?.maintenanceLocked === true && !this.view.player
          )
        this.pollRunning = false
        if (!this.stopped)
          this.timer = setTimeout(() => {
            void this.poll()
          }, delay)
      }
    }
  }

  async loadExams(): Promise<void> {
    if (!this.ready()) return
    const connection = this.connection!,
      items: Schema<'StudentExam'>[] = []
    let cursor: string | null = null
    do {
      const page: Schema<'StudentExamList'> = await this.client(connection).request(
        'getStudentExams',
        { query: { cursor: cursor ?? undefined, limit: 100 } }
      )
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor && this.connection === connection && this.ready())
    if (this.connection === connection && this.ready()) this.update({ exams: items })
  }
  async refreshRecords(): Promise<void> {
    if (!this.view.active || !this.view.initialized) return
    this.update({ records: await this.host.invoke('records.list') })
  }
  async enroll(file: string, fingerprint: string): Promise<void> {
    if (admission(this.view) !== 'unbound') throw new Error('当前状态不允许入网')
    await this.host.invoke('binding.enroll', { file, fingerprint })
    // Enrollment may replace the credential context or target server. Close the previous
    // connection before polling the newly accepted configuration.
    await this.disconnect()
    await this.refresh()
  }
  async retry(id: string): Promise<void> {
    await this.queue.retry(id)
  }
  async exportRecords(ids: string[]): Promise<void> {
    if (!canViewRecords(this.view)) throw new Error('当前状态不允许导出')
    await this.host.invoke('records.export', ids)
  }
  async prepare(exam: Schema<'StudentExam'>): Promise<void> {
    if (!this.ready() || this.view.phase !== 'idle') throw new Error('当前状态不允许开始练习')
    const connection = this.connection!,
      abort = new AbortController()
    this.requests.add(abort)
    await this.setPhase('preparing')
    try {
      const archive = await this.client(connection).request<Archive>(
        'getStudentExamsExamIdArchive',
        { path: { examId: exam.examId } },
        abort.signal
      )
      const baseUrl = await this.host.invoke<string>('cache.prepare', {
        handle: archive.handle,
        sha256: exam.archiveSha256
      })
      if (connection !== this.connection || !this.ready()) {
        await this.host.invoke('cache.release', baseUrl)
        throw new Error('准入状态已变化，请重新选择试卷')
      }
      this.update({ player: { exam, baseUrl }, error: null })
    } catch (error) {
      await this.setPhase('idle')
      throw error
    } finally {
      this.requests.delete(abort)
    }
  }
  beforeStart: NonNullable<ExamPlayerProps['beforeStart']> = async ({ candidate, signal }) => {
    if (!this.ready() || !this.view.player) throw new Error('当前状态不允许开始练习')
    const connection = this.connection!,
      state = this.view.state!,
      exam = this.view.player.exam
    if (
      !this.intent ||
      JSON.stringify(candidate) !== JSON.stringify(this.intent.candidate) ||
      performance.now() - this.intentCreated > 25000
    ) {
      this.intent = {
        submissionId: crypto.randomUUID(),
        examId: exam.examId,
        candidate,
        binding: this.view.binding!
      }
      this.intentCreated = performance.now()
      await this.host.invoke('practice.persist', this.intent)
    }
    const start = performance.now()
    const grant = await this.client(connection).request<Schema<'PracticeGrant'>>(
      'putStudentPracticesSubmissionId',
      {
        path: { submissionId: this.intent.submissionId },
        body: { examId: exam.examId, archiveSha256: exam.archiveSha256, candidate }
      },
      signal
    )
    signal.throwIfAborted()
    const remaining =
      Date.parse(grant.startBefore) -
      Date.parse(grant.grantedAt) -
      (performance.now() - this.intentCreated) -
      (performance.now() - start)
    if (
      !this.ready() ||
      connection !== this.connection ||
      state.modeRevision !== this.view.state?.modeRevision ||
      grant.modeRevision !== this.view.state.modeRevision ||
      remaining < 1000
    )
      throw new Error('练习许可已失效，请重试')
    return { submissionId: this.intent.submissionId }
  }
  finish: ExamPlayerProps['onFinish'] = async (archive) => {
    if (!this.intent) throw new Error('练习身份缺失')
    await this.setPhase('saving')
    const bytes = await archive.arrayBuffer()
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (byte) => byte.toString(16).padStart(2, '0')
    ).join('')
    const handle = await this.host.invoke<string>('records.begin', {
      intent: this.intent,
      sha256,
      bytes: bytes.byteLength
    })
    for (let offset = 0, sequence = 0; offset < bytes.byteLength; offset += 1024 * 1024, sequence++)
      await this.host.invoke('records.chunk', {
        handle,
        sequence,
        bytes: new Uint8Array(bytes.slice(offset, offset + 1024 * 1024))
      })
    await this.host.invoke('records.finish', { handle, sha256 })
    await this.refreshRecords().catch((error) => this.fail(error))
    void this.queue.pump().catch((error) => this.fail(error))
  }
  phaseChanged: NonNullable<ExamPlayerProps['onPhaseChange']> = (event) => {
    this.position = { pageIndex: event.pageIndex, stepIndex: event.stepIndex }
    void this.setPhase(event.phase === 'complete' ? 'idle' : event.phase).catch((error) =>
      this.fail(error)
    )
  }
  private async setPhase(phase: Phase): Promise<void> {
    this.update({ phase })
    await this.host.invoke('foreground.set', phase)
  }
  async exitPractice(): Promise<void> {
    if (this.view.phase === 'saving') return
    if (this.view.player) await this.host.invoke('cache.release', this.view.player.baseUrl)
    this.intent = null
    this.update({ player: null })
    if (this.view.active && this.view.initialized) await this.setPhase('idle')
  }
}

export function summarize(records: StudentRecord[]): Schema<'SubmissionSummary'> {
  const incomplete = records.filter((record) => !record.receipt)
  return {
    waitingFirstUpload: incomplete.filter(
      (record) => record.resultKnowledge === 'never-sent' && record.archivePresent
    ).length,
    unconfirmed: incomplete.filter((record) => record.resultKnowledge === 'unknown').length,
    failed: incomplete.filter((record) => record.lastError || record.state === 'manual-resolution')
      .length
  }
}
