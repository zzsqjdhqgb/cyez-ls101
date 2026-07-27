import { afterEach, describe, expect, it, vi } from 'vitest'
import { FILE_STORE_CHANNELS } from '../shared/constants'

describe('renderer scoped store', () => {
  afterEach(() => {
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('derives scopes and sends structured locations', async () => {
    const invoke = vi.fn().mockResolvedValue(null)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { fileStore: { invoke } }
    })
    const { fileStore } = await import('../renderer')
    const draft = fileStore.scope('interfaces').scope('drafts').scope('draft-abc123')

    await draft.readText('manifest.json')

    expect(invoke).toHaveBeenCalledWith(FILE_STORE_CHANNELS.readText, {
      scope: ['interfaces', 'drafts', 'draft-abc123'],
      filename: 'manifest.json'
    })
    expect(draft.getAssetUrl('cover.png')).toBe(
      'asset://local/interfaces/drafts/draft-abc123/cover.png'
    )
  })

  it('rejects complex scope paths before IPC', async () => {
    const invoke = vi.fn()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { fileStore: { invoke } }
    })
    const { fileStore } = await import('../renderer')

    expect(() => fileStore.scope('interfaces/drafts')).toThrow('Invalid file-store scope segment')
    expect(invoke).not.toHaveBeenCalled()
  })
})
