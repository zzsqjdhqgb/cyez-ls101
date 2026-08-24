import { afterEach, describe, expect, it, vi } from 'vitest'

describe('renderer file dialog', () => {
  afterEach(() => {
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('reads binary data through the preload bridge', async () => {
    const read = vi.fn().mockResolvedValue({
      name: 'package.bin',
      data: new Uint8Array([1, 2, 3])
    })
    setBridge({ read, write: vi.fn() })
    const { fileDialog } = await import('../renderer')
    const options = { filters: [{ name: 'Package', extensions: ['bin'] }] }

    await expect(fileDialog.readBinary(options)).resolves.toEqual({
      name: 'package.bin',
      data: new Uint8Array([1, 2, 3])
    })
    expect(read).toHaveBeenCalledWith(options)
  })

  it('preserves cancellation when reading text', async () => {
    const read = vi.fn().mockResolvedValue(null)
    setBridge({ read, write: vi.fn() })
    const { fileDialog } = await import('../renderer')

    await expect(fileDialog.readText()).resolves.toBeNull()
  })

  it('decodes valid UTF-8 and rejects invalid UTF-8', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        name: 'message.txt',
        data: new TextEncoder().encode('hello')
      })
      .mockResolvedValueOnce({ name: 'invalid.txt', data: new Uint8Array([0xff]) })
    setBridge({ read, write: vi.fn() })
    const { fileDialog } = await import('../renderer')

    await expect(fileDialog.readText()).resolves.toEqual({ name: 'message.txt', data: 'hello' })
    await expect(fileDialog.readText()).rejects.toThrow()
  })

  it('encodes text as UTF-8 before writing', async () => {
    const write = vi.fn().mockResolvedValue(true)
    setBridge({ read: vi.fn(), write })
    const { fileDialog } = await import('../renderer')
    const options = { defaultName: 'message.txt' }

    await expect(fileDialog.writeText('你好', options)).resolves.toBe(true)
    expect(write).toHaveBeenCalledWith(new TextEncoder().encode('你好'), options)
  })

  it('rejects invalid options before invoking the bridge', async () => {
    const read = vi.fn()
    const write = vi.fn()
    setBridge({ read, write })
    const { fileDialog } = await import('../renderer')

    expect(() =>
      fileDialog.readBinary({ filters: [{ name: 'JSON', extensions: ['.json'] }] })
    ).toThrow('Invalid file-dialog extension')
    expect(() => fileDialog.writeBinary(new Uint8Array(), { defaultName: '../data.json' })).toThrow(
      'File-dialog default name must be a filename without a path'
    )
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
})

function setBridge(fileDialog: {
  read: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
}) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fileDialog }
  })
}
