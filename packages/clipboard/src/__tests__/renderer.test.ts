import { afterEach, describe, expect, it, vi } from 'vitest'

describe('renderer clipboard', () => {
  afterEach(() => {
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('reads image bytes through the preload bridge', async () => {
    const readImage = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
    setBridge(readImage)
    const { imageClipboard } = await import('../renderer')

    await expect(imageClipboard.readImage()).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(readImage).toHaveBeenCalledOnce()
  })

  it('returns null when the clipboard contains no image', async () => {
    setBridge(vi.fn().mockResolvedValue(null))
    const { imageClipboard } = await import('../renderer')

    await expect(imageClipboard.readImage()).resolves.toBeNull()
  })
})

function setBridge(readImage: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { imageClipboard: { readImage } }
  })
}
