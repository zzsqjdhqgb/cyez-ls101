import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LICENSE_CHANNELS } from '@ls101/core-types'

type IpcHandler = (...args: unknown[]) => unknown

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  const windows: Array<{
    focus: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
    options: Record<string, unknown>
    webContents: {
      on: ReturnType<typeof vi.fn>
      setWindowOpenHandler: ReturnType<typeof vi.fn>
    }
  }> = []
  const BrowserWindow = Object.assign(
    vi.fn(function BrowserWindow(options: Record<string, unknown>) {
      const window = {
        destroy: vi.fn(),
        focus: vi.fn(),
        isDestroyed: vi.fn(() => false),
        loadFile: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
        once: vi.fn(),
        options,
        show: vi.fn(),
        webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() }
      }
      windows.push(window)
      return window
    }),
    { fromWebContents: vi.fn(() => null) }
  )
  return {
    app: {
      exit: vi.fn(),
      getAppPath: vi.fn(() => '/app'),
      isPackaged: false,
      relaunch: vi.fn()
    },
    handlers,
    BrowserWindow,
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler))
    },
    windows
  }
})

vi.mock('electron', () => ({
  app: electronMocks.app,
  BrowserWindow: electronMocks.BrowserWindow,
  ipcMain: electronMocks.ipcMain
}))

import { registerLicenseHandlers } from '../../src/main/license'

let directories: string[]

beforeEach(() => {
  directories = []
  electronMocks.handlers.clear()
  electronMocks.app.exit.mockClear()
  electronMocks.app.getAppPath.mockClear()
  electronMocks.app.relaunch.mockClear()
  electronMocks.BrowserWindow.mockClear()
  electronMocks.BrowserWindow.fromWebContents.mockClear()
  electronMocks.windows.length = 0
  vi.useFakeTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('license IPC', () => {
  it('opens the bundled activation guide in a sandboxed application window', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ls101-license-ipc-'))
    directories.push(directory)
    registerLicenseHandlers({ storagePath: path.join(directory, 'license.json') })

    const openGuide = electronMocks.handlers.get(LICENSE_CHANNELS.openActivationGuide)
    expect(openGuide).toBeDefined()

    await expect(openGuide!({ sender: {} })).resolves.toBeUndefined()

    expect(electronMocks.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '软件激活方式意见征集',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          partition: 'license-activation-guide',
          sandbox: true,
          webSecurity: true
        }
      })
    )
    expect(electronMocks.windows[0]?.loadFile).toHaveBeenCalledWith(
      path.join('/app', 'docs', 'license-activation.html')
    )
    expect(electronMocks.windows[0]?.webContents.setWindowOpenHandler).toHaveBeenCalledOnce()

    const navigationHandler = electronMocks.windows[0]?.webContents.on.mock.calls.find(
      ([event]) => event === 'will-navigate'
    )?.[1] as ((event: { preventDefault(): void }, url: string) => void) | undefined
    expect(navigationHandler).toBeDefined()

    const externalNavigation = { preventDefault: vi.fn() }
    navigationHandler!(externalNavigation, 'https://example.com/')
    expect(externalNavigation.preventDefault).toHaveBeenCalledOnce()

    const internalNavigation = { preventDefault: vi.fn() }
    navigationHandler!(
      internalNavigation,
      `${new URL('file:///app/docs/license-activation.html').href}#compare`
    )
    expect(internalNavigation.preventDefault).not.toHaveBeenCalled()

    await expect(openGuide!({ sender: {} })).resolves.toBeUndefined()
    expect(electronMocks.BrowserWindow).toHaveBeenCalledOnce()
    expect(electronMocks.windows[0]?.focus).toHaveBeenCalledOnce()
  })

  it('deletes the receipt and relaunches after replying', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ls101-license-ipc-'))
    directories.push(directory)
    const storagePath = path.join(directory, 'license.json')
    await writeFile(storagePath, '{}', 'utf8')
    registerLicenseHandlers({ storagePath })

    const deactivate = electronMocks.handlers.get(LICENSE_CHANNELS.deactivate)
    expect(deactivate).toBeDefined()

    await expect(deactivate!()).resolves.toBeUndefined()
    await expect(readFile(storagePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(electronMocks.app.relaunch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)

    expect(electronMocks.app.relaunch).toHaveBeenCalledTimes(1)
    expect(electronMocks.app.exit).toHaveBeenCalledWith(0)
  })
})
