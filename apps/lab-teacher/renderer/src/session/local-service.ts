import { useEffect, useSyncExternalStore } from 'react'
import type { LocalServiceStatus } from '@ls101/lab-desktop-host'
import { describeLabError } from '@ls101/lab-renderer'

export interface LocalServiceState {
  /** Most recent observation from the unprivileged status channel. */
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
  private checkWork: Promise<void> | null = null
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
   * Serialize observations and mutations so an earlier status cannot overwrite a completed action.
   * Only mutations use the administrator helper; status reads never request elevation.
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
    // The connection page and dialog can mount together (also under StrictMode).
    return (this.checkWork ??= this.enqueue(async () => {
      this.update({ busy: true, error: null })
      try {
        const status = await this.host.invoke<LocalServiceStatus>('localService.status')
        this.update({ status, busy: false, notice: null })
      } catch (reason) {
        this.update({ status: null, busy: false, error: describeLabError(reason).message })
      }
    }).finally(() => {
      this.checkWork = null
    }))
  }

  invoke(operation: string, input?: unknown): Promise<void> {
    return this.enqueue(async () => {
      this.update({ busy: true, error: null, notice: null })
      try {
        const result = await this.host.invoke<unknown>(`localService.${operation}`, input)
        this.update(this.settle(operation, input, result))
      } catch (reason) {
        // A failed mutation may have completed partially. Require a fresh check before editing.
        this.update({ status: null, busy: false, error: describeLabError(reason).message })
      }
    })
  }

  private read<T>(operation: string): Promise<T | null> {
    return this.enqueue(async () => {
      this.update({ busy: true, error: null })
      try {
        return await this.host.invoke<T>(`localService.${operation}`)
      } catch (reason) {
        this.update({ error: describeLabError(reason).message })
        return null
      } finally {
        this.update({ busy: false })
      }
    })
  }

  logs(): Promise<string | null> {
    return this.read<string>('logs')
  }

  selectBackup(): Promise<string | null> {
    return this.read<string>('selectBackup')
  }

  private settle(operation: string, input: unknown, result: unknown): Partial<LocalServiceState> {
    if (isStatus(result))
      return {
        status: {
          ...result,
          autostart: result.autostart ?? this.state.status?.autostart ?? false,
          settings: result.settings ?? null
        },
        busy: false,
        notice: null
      }

    const current = this.state.status
    if (operation === 'updateSettings' && current?.settings) {
      const settings = result as { name: string; baseUrl: string; revision: number }
      return {
        status: {
          ...current,
          info: current.info ? { ...current.info, name: settings.name } : null,
          settings: { ...current.settings, ...settings }
        },
        busy: false,
        notice: '服务信息已保存。'
      }
    }
    if (operation === 'changePassword' && current?.settings) {
      return {
        status: {
          ...current,
          settings: {
            ...current.settings,
            securityRevision: (result as { revision: number }).revision
          }
        },
        busy: false,
        notice: '管理密码已修改，已登录的教师端需要重新连接。'
      }
    }
    if (operation === 'autostart' && current) {
      return { status: { ...current, autostart: Boolean(input) }, busy: false }
    }
    if (operation === 'configure' && current && input && typeof input === 'object') {
      const port = (input as { port?: unknown }).port
      if (typeof port === 'number') return { status: { ...current, port }, busy: false }
    }
    if (['start', 'stop', 'install', 'upgrade', 'restore', 'recover-restore'].includes(operation)) {
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
  start: '已发送启动请求',
  stop: '已发送停止请求',
  install: '安装完成',
  upgrade: '升级完成',
  restore: '备份恢复完成',
  'recover-restore': '中断的数据目录切换已恢复'
}

export const localServiceStore = new LocalServiceStore(window.lab)

export interface LocalServiceController extends LocalServiceState {
  check(): Promise<void>
  invoke(operation: string, input?: unknown): Promise<void>
  logs(): Promise<string | null>
  selectBackup(): Promise<string | null>
}

export function useLocalService(): LocalServiceController {
  useEffect(() => {
    void localServiceStore.check()
  }, [])
  const state = useSyncExternalStore(localServiceStore.subscribe, localServiceStore.getSnapshot)

  return {
    ...state,
    check: () => localServiceStore.check(),
    invoke: (operation, input) => localServiceStore.invoke(operation, input),
    logs: () => localServiceStore.logs(),
    selectBackup: () => localServiceStore.selectBackup()
  }
}
