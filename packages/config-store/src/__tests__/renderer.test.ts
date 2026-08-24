import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_STORE_CHANNELS } from '../shared/constants'

describe('renderer config store', () => {
  afterEach(() => {
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('derives scopes and sends structured locations', async () => {
    const invoke = vi.fn().mockResolvedValue({ version: 1 })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { configStore: { invoke } }
    })
    const { configStore } = await import('../renderer')
    const appearance = configStore.scope('appearance').scope('desktop')

    await appearance.read('settings')

    expect(invoke).toHaveBeenCalledWith(CONFIG_STORE_CHANNELS.read, {
      scope: ['appearance', 'desktop'],
      key: 'settings'
    })
  })

  it('rejects invalid scopes and keys before IPC', async () => {
    const invoke = vi.fn()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { configStore: { invoke } }
    })
    const { configStore } = await import('../renderer')

    expect(() => configStore.scope('../appearance')).toThrow('Invalid config-store scope segment')
    await expect(configStore.scope('appearance').read('../settings')).rejects.toThrow(
      'Invalid config-store key'
    )
    expect(invoke).not.toHaveBeenCalled()
  })
})
