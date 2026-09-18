import { useSyncExternalStore } from 'react'
import type { LocalServiceStatus } from '@ls101/lab-desktop-host'
import { describeLabError } from '@ls101/lab-renderer'

export interface LocalServiceState {
  /** Last explicitly checked status. Never read automatically: every check prompts for elevation. */
  status: LocalServiceStatus | null
  busy: boolean
  error: string | null
  /** Result of the last successful operation, when the new state cannot be derived locally. */
  notice: string | null
}

const EMPTY: LocalServiceState = { status: null, busy: false, error: null, notice: null }

function isStatus(value: unknown): value is LocalServiceStatus {
  return Boolean(value && typeof value === 'object' && 'state' in value)
}

export class LocalServiceStore {
  private state: LocalServiceState = EMPTY
  private readonly listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly host: { invoke<T = unknown>(c: string, input?: unknown): Promise<T> }
  ) {}

  getSnapshot = (): LocalServiceState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(change: Partial<LocalServiceState>): void {
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }

  /**
   * Privileged helper operations run one at a time: the host rejects concurrent requests with
   * LOCAL_OPERATION_BUSY and each one raises its own elevation prompt.
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  check(): Promise<void> {
    return this.enqueue(async () => {
      this.update({ busy: true, error: null })
      try {
        const status = await this.host.invoke<LocalServiceStatus>('localService.status')
        this.update({ status, busy: false, notice: null })
      } catch (reason) {
        this.update({ busy: false, error: describeLabError(reason).message })
      }
    })
  }

  invoke(operation: string, input?: unknown): Promise<void> {
    return this.enqueue(async () => {
      this.update({ busy: true, error: null, notice: null })
      try {
        const result = await this.host.invoke<unknown>(`localService.${operation}`, input)
        this.update(this.settle(operation, input, result))
      } catch (reason) {
        this.update({ busy: false, error: describeLabError(reason).message })
      }
    })
  }

  logs(): Promise<string> {
    return this.enqueue(() => this.host.invoke<string>('localService.logs'))
  }

  selectBackup(): Promise<string> {
    return this.enqueue(() => this.host.invoke<string>('localService.selectBackup'))
  }

  private settle(operation: string, input: unknown, result: unknown): Partial<LocalServiceState> {
    if (isStatus(result)) return { status: result, busy: false, notice: null }

    const current = this.state.status
    if (operation === 'start' && current) {
      return { status: { ...current, state: 'running' }, busy: false }
    }
    if (operation === 'stop' && current) {
      return { status: { ...current, state: 'stopped' }, busy: false }
    }
    if (operation === 'autostart' && current) {
      return { status: { ...current, autostart: Boolean(input) }, busy: false }
    }
    if (operation === 'configure' && current && input && typeof input === 'object') {
      const port = (input as { port?: unknown }).port
      if (typeof port === 'number') return { status: { ...current, port }, busy: false }
    }
    if (['install', 'upgrade', 'restore', 'recover-restore'].includes(operation)) {
      return {
        status: null,
        busy: false,
        notice: `${RESULT_NOTICES[operation]}，请点击「检查本机状态」确认当前状态。`
      }
    }
    return { busy: false }
  }
}

const RESULT_NOTICES: Record<string, string> = {
  install: '安装完成',
  upgrade: '升级完成',
  restore: '备份恢复完成',
  'recover-restore': '中断的数据目录切换已恢复'
}

export const localServiceStore = new LocalServiceStore(window.lab)

export interface LocalServiceController extends LocalServiceState {
  check(): Promise<void>
  invoke(operation: string, input?: unknown): Promise<void>
  logs(): Promise<string>
  selectBackup(): Promise<string>
}

export function useLocalService(): LocalServiceController {
  const state = useSyncExternalStore(localServiceStore.subscribe, localServiceStore.getSnapshot)

  return {
    ...state,
    check: () => localServiceStore.check(),
    invoke: (operation, input) => localServiceStore.invoke(operation, input),
    logs: () => localServiceStore.logs(),
    selectBackup: () => localServiceStore.selectBackup()
  }
}
