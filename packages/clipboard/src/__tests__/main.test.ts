import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  readImage: vi.fn(),
  writeText: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: { readImage: electronMocks.readImage, writeText: electronMocks.writeText },
  ipcMain: { handle: electronMocks.handle }
}))

describe('main clipboard handler', () => {
  beforeEach(() => {
    vi.resetModules()
    electronMocks.handle.mockReset()
    electronMocks.readImage.mockReset()
    electronMocks.writeText.mockReset()
  })

  it('registers a fixed image-read handler and returns PNG bytes', async () => {
    electronMocks.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => new Uint8Array([1, 2, 3])
    })
    const { registerClipboard } = await import('../main')

    registerClipboard()
    registerClipboard()

    expect(electronMocks.handle).toHaveBeenCalledTimes(2)
    expect(electronMocks.handle).toHaveBeenCalledWith('clipboard:read-image', expect.any(Function))
    const handler = electronMocks.handle.mock.calls[0][1] as () => Uint8Array | null
    expect(handler()).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('writes text through the fixed clipboard handler', async () => {
    const { registerClipboard } = await import('../main')
    registerClipboard()

    const call = electronMocks.handle.mock.calls.find(
      ([channel]) => channel === 'clipboard:write-text'
    )
    const handler = call?.[1] as (_event: unknown, text: string) => void
    handler(undefined, '图片提示词')

    expect(electronMocks.writeText).toHaveBeenCalledWith('图片提示词')
  })

  it('returns null when the system clipboard has no image', async () => {
    electronMocks.readImage.mockReturnValue({
      isEmpty: () => true,
      toPNG: vi.fn()
    })
    const { registerClipboard } = await import('../main')
    registerClipboard()

    const handler = electronMocks.handle.mock.calls[0][1] as () => Uint8Array | null
    expect(handler()).toBeNull()
  })
})
