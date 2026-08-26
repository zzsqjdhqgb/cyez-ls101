import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const webContentsOnce = new Map<string, () => void>()
  const windowOnce = new Map<string, () => void>()
  let visible = false
  const webContents = {
    getURL: vi.fn(() => 'file:///app/index.html'),
    on: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => webContentsOnce.set(event, listener)),
    setWindowOpenHandler: vi.fn()
  }
  const window = {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => visible),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    on: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => windowOnce.set(event, listener)),
    show: vi.fn(() => {
      visible = true
    }),
    webContents
  }
  return {
    BrowserWindow: vi.fn(function BrowserWindowMock() {
      return window
    }),
    reset: () => {
      visible = false
      webContentsOnce.clear()
      windowOnce.clear()
    },
    webContentsOnce,
    window,
    windowOnce
  }
})

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/app'), isPackaged: true },
  BrowserWindow: mocks.BrowserWindow,
  Menu: { setApplicationMenu: vi.fn() },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../../src/main/window-controls', () => ({ bindWindowControlEvents: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reset()
  delete process.env['ELECTRON_RENDERER_URL']
})

describe('main window startup visibility', () => {
  it('shows on the event-loop turn after the renderer DOM is ready', async () => {
    const lifecycleEvents: string[] = []
    const { createMainWindow } = await import('../../src/main/window')

    createMainWindow(undefined, (event) => lifecycleEvents.push(event))
    expect(mocks.window.show).not.toHaveBeenCalled()

    mocks.webContentsOnce.get('dom-ready')?.()
    expect(lifecycleEvents).toEqual(['renderer-dom-ready'])
    expect(mocks.window.show).not.toHaveBeenCalled()

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(mocks.window.show).toHaveBeenCalledOnce()
    expect(lifecycleEvents).toEqual(['renderer-dom-ready', 'shown'])

    mocks.windowOnce.get('ready-to-show')?.()
    expect(lifecycleEvents).toEqual(['renderer-dom-ready', 'shown', 'ready-to-show'])
  })
})
