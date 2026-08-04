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
    expect(draft.getAssetKey('cover.png')).toBe(
      'asset-key://v1/interfaces/drafts/draft-abc123/cover.png'
    )
  })

  it('reads assets and derives URLs directly from an asset key', async () => {
    const invoke = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { fileStore: { invoke } }
    })
    const { fileStore } = await import('../renderer')
    const key = fileStore.scope('interfaces').scope('drafts').getAssetKey('cover.png')

    await expect(fileStore.readAsset(key)).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(invoke).toHaveBeenCalledWith(FILE_STORE_CHANNELS.readAsset, {
      scope: ['interfaces', 'drafts'],
      filename: 'cover.png'
    })
    expect(fileStore.getAssetUrl(key)).toBe('asset://local/interfaces/drafts/cover.png')
  })

  it('serializes both sides of a text compare-and-swap request', async () => {
    const invoke = vi.fn().mockResolvedValue(true)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { fileStore: { invoke } }
    })
    const { fileStore } = await import('../renderer')
    const template = fileStore.scope('templates').scope('template-id')

    await expect(
      template.compareAndSwapText('template.json', { revision: 2 }, { revision: 3 })
    ).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith(
      FILE_STORE_CHANNELS.compareAndSwapText,
      { scope: ['templates', 'template-id'], filename: 'template.json' },
      '{"revision":2}',
      '{"revision":3}'
    )
  })

  it('rejects invalid asset keys before IPC', async () => {
    const invoke = vi.fn()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { fileStore: { invoke } }
    })
    const { fileStore } = await import('../renderer')

    await expect(fileStore.readAsset('asset-key://v1/interfaces/../secret.png')).rejects.toThrow(
      'Invalid asset key'
    )
    expect(() => fileStore.getAssetUrl('asset://local/interfaces/cover.png')).toThrow(
      'Invalid asset key'
    )
    expect(invoke).not.toHaveBeenCalled()
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
