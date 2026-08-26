import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const webContentsOn = new Map<string, (...args: unknown[]) => void>()
  const webContentsOnce = new Map<string, () => void>()
  const windowOnce = new Map<string, () => void>()
  let destroyed = false
  let visible = false
  const webContents = {
    getURL: vi.fn(() => 'file:///app/index.html'),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) =>
      webContentsOn.set(event, listener)
    ),
    once: vi.fn((event: string, listener: () => void) => webContentsOnce.set(event, listener)),
    setWindowOpenHandler: vi.fn()
  }
  const window = {
    isDestroyed: vi.fn(() => destroyed),
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
      destroyed = false
      visible = false
      webContentsOn.clear()
      webContentsOnce.clear()
      windowOnce.clear()
    },
    setDestroyed: (value: boolean) => {
      destroyed = value
    },
    setVisible: (value: boolean) => {
      visible = value
    },
    webContentsOn,
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

  it('reports shown without showing again when the window became visible before the callback', async () => {
    const lifecycleEvents: string[] = []
    const { createMainWindow } = await import('../../src/main/window')

    createMainWindow(undefined, (event) => lifecycleEvents.push(event))
    mocks.webContentsOnce.get('dom-ready')?.()
    mocks.setVisible(true)

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(mocks.window.show).not.toHaveBeenCalled()
    expect(lifecycleEvents).toEqual(['renderer-dom-ready', 'shown'])
  })

  it('reports a terminal event when the window is destroyed before DOM readiness', async () => {
    const lifecycleEvents: string[] = []
    const { createMainWindow } = await import('../../src/main/window')

    createMainWindow(undefined, (event) => lifecycleEvents.push(event))
    mocks.setDestroyed(true)
    mocks.windowOnce.get('closed')?.()

    expect(mocks.window.show).not.toHaveBeenCalled()
    expect(lifecycleEvents).toEqual(['destroyed-before-shown'])
  })

  it('reports a terminal event and prevents showing when the initial renderer load fails', async () => {
    const lifecycleEvents: string[] = []
    const { createMainWindow } = await import('../../src/main/window')

    createMainWindow(undefined, (event) => lifecycleEvents.push(event))
    mocks.webContentsOn.get('did-fail-load')?.({}, -2, 'failed', 'file:///app/index.html', true)
    mocks.webContentsOnce.get('dom-ready')?.()

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(mocks.window.show).not.toHaveBeenCalled()
    expect(lifecycleEvents).toEqual(['load-failed-before-shown', 'renderer-dom-ready'])
  })
})
