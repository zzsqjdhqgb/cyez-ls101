// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { LocalServiceStore } from '../local-service'

const running = {
  state: 'running',
  autostart: true,
  releaseVersion: '0.4.1',
  license: null,
  info: null,
  port: 8443,
  error: null,
  settings: { name: 'Lab', baseUrl: 'https://localhost:8443/', revision: 1, securityRevision: 1 }
}

function setup() {
  const invoke = vi.fn().mockResolvedValue(running)
  return { invoke, store: new LocalServiceStore({ invoke }) }
}

describe('local service state certainty', () => {
  it('requires a successful export and clears its UI receipt after purge', async () => {
    const { invoke, store } = setup()
    const exported = {
      directory: '/chosen/export',
      manifestSha256: 'a'.repeat(64),
      files: 1,
      bytes: 99
    }
    invoke.mockResolvedValueOnce(exported)
    await store.invoke('export-data')
    expect(store.getSnapshot().dataExport).toEqual(exported)
    invoke.mockResolvedValueOnce(null)
    await store.invoke('export-data')
    expect(store.getSnapshot().dataExport).toBeNull()
    invoke.mockResolvedValueOnce(exported)
    await store.invoke('export-data')
    invoke.mockRejectedValueOnce(new Error('ENOSPC'))
    await store.invoke('export-data')
    expect(store.getSnapshot().dataExport).toBeNull()
    invoke.mockResolvedValueOnce(exported)
    await store.invoke('export-data')
    invoke.mockResolvedValueOnce({ ...running, state: 'not-installed', autostart: false })
    await store.invoke('purge')
    expect(store.getSnapshot()).toMatchObject({
      dataExport: null,
      status: { state: 'not-installed' }
    })
    expect(store.getSnapshot().notice).toContain('重新安装并初始化')
  })
  it('requires verified stopped status after emergency stop and invalidates failures', async () => {
    const { invoke, store } = setup()
    invoke.mockResolvedValueOnce({ ...running, state: 'stopped', autostart: false })
    await store.invoke('force-stop')
    expect(store.getSnapshot()).toMatchObject({ status: { state: 'stopped', autostart: false } })
    expect(store.getSnapshot().notice).toContain('维护模式')
    invoke.mockRejectedValueOnce(new Error('LOCAL_FORCE_STOP_INCOMPLETE'))
    await store.invoke('force-stop')
    expect(store.getSnapshot()).toMatchObject({ status: null, notice: null })
    invoke.mockResolvedValueOnce(null)
    await store.invoke('force-stop')
    expect(store.getSnapshot().status).toBeNull()
    expect(store.getSnapshot().notice).toContain('尚未确认')
  })
  it('coalesces overlapping automatic and manual refreshes', async () => {
    const { invoke, store } = setup()
    const first = store.check()
    const second = store.check()
    expect(first).toBe(second)
    await Promise.all([first, second])
    expect(invoke).toHaveBeenCalledTimes(1)
    await store.check()
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('invalidates a previous running state when a new check fails', async () => {
    const { invoke, store } = setup()
    await store.check()
    invoke.mockRejectedValueOnce(new Error('LOCAL_CONTROL_UNAVAILABLE'))
    await store.check()
    expect(store.getSnapshot()).toMatchObject({ status: null, busy: false })
    expect(store.getSnapshot().error).toBeTruthy()
  })

  it('does not infer readiness from an acknowledged start request', async () => {
    const { invoke, store } = setup()
    await store.check()
    invoke.mockResolvedValueOnce(null)
    await store.invoke('start')
    expect(store.getSnapshot().status).toBeNull()
    expect(store.getSnapshot().notice).toContain('检查本机状态')
    invoke.mockResolvedValueOnce({ ...running, state: 'uninitialized', settings: null })
    await store.invoke('start')
    expect(store.getSnapshot().status?.state).toBe('uninitialized')
  })

  it('retains the OS startup setting when initialization returns only runtime status', async () => {
    const { invoke, store } = setup()
    await store.check()
    invoke.mockResolvedValueOnce({ state: 'running', info: null, port: 9000 })
    await store.invoke('initialize')
    expect(store.getSnapshot().status).toMatchObject({ autostart: true, port: 9000 })
  })

  it('reports log failures and releases busy state without an unhandled rejection', async () => {
    const { invoke, store } = setup()
    await store.check()
    invoke.mockRejectedValueOnce(new Error('LOCAL_HELPER_FAILED'))
    await expect(store.logs()).resolves.toBeNull()
    expect(store.getSnapshot()).toMatchObject({ busy: false, status: running })
    expect(store.getSnapshot().error).toBeTruthy()
  })

  it('requires checking again after a failed mutation', async () => {
    const { invoke, store } = setup()
    await store.check()
    invoke.mockRejectedValueOnce(new Error('REVISION_CONFLICT'))
    await store.invoke('updateSettings', { name: 'Changed', expectedRevision: 1 })
    expect(store.getSnapshot().status).toBeNull()
    expect(store.getSnapshot().error).toBeTruthy()
  })

  it('clears runtime settings when the service stops', async () => {
    const { invoke, store } = setup()
    await store.check()
    const { settings: _settings, ...stopped } = running
    invoke.mockResolvedValueOnce({ ...stopped, state: 'stopped' })
    await store.invoke('stop')
    expect(store.getSnapshot().status).toMatchObject({ state: 'stopped', settings: null })
  })
})
