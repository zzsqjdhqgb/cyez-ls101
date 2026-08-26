import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: {
    exit: vi.fn(),
    getAppPath: vi.fn(() => '/app'),
    getPath: vi.fn(() => '/user-data'),
    getVersion: vi.fn(() => '0.0.0-local.test'),
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve())
  },
  ipcMain: { handle: vi.fn() },
  logger: {
    error: vi.fn(),
    errorSync: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  },
  mainWindow: {},
  createMainWindow: vi.fn(),
  initializeDataDirectory: vi.fn<() => Promise<string>>(),
  initializeLegacyData: vi.fn().mockResolvedValue(undefined),
  hasPendingLegacyCleanup: vi.fn(() => false),
  recoverDataDirectory: vi.fn<() => Promise<never>>(),
  registerFileStoreHandlers: vi.fn(),
  registerFileStoreProtocol: vi.fn(),
  registerBuiltinFileStoreProtocol: vi.fn(),
  showErrorBox: vi.fn(),
  windowShown: vi.fn()
}))

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showErrorBox: mocks.showErrorBox },
  ipcMain: mocks.ipcMain,
  safeStorage: { setUsePlainTextEncryption: vi.fn() }
}))

vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() }
}))

vi.mock('@ls101/logger/main', () => {
  return {
    createConsoleLogger: vi.fn(() => mocks.logger),
    createMainLogger: vi.fn(async () => mocks.logger),
    registerRendererLogger: vi.fn()
  }
})

vi.mock('@ls101/config-store/main', () => ({ registerConfigStore: vi.fn() }))
vi.mock('@ls101/airouter/main', () => ({ registerAIRouter: vi.fn() }))
vi.mock('@ls101/clipboard/main', () => ({ registerClipboard: vi.fn() }))
vi.mock('@ls101/file-dialog/main', () => ({ registerFileDialog: vi.fn() }))
vi.mock('@ls101/file-store/main', () => ({
  registerBuiltinFileStoreHandlers: vi.fn(),
  registerBuiltinFileStoreProtocol: mocks.registerBuiltinFileStoreProtocol,
  registerBuiltinFileStoreScheme: vi.fn(),
  registerFileStoreHandlers: mocks.registerFileStoreHandlers,
  registerFileStoreProtocol: mocks.registerFileStoreProtocol,
  registerFileStoreScheme: vi.fn()
}))
vi.mock('../../src/main/app-info', () => ({ registerAppInfoHandlers: vi.fn() }))
vi.mock('../../src/main/data-directory', () => ({
  initializeDataDirectory: mocks.initializeDataDirectory,
  recoverDataDirectory: mocks.recoverDataDirectory,
  registerDataDirectoryHandlers: vi.fn()
}))
vi.mock('../../src/main/license', () => ({ registerLicenseHandlers: vi.fn() }))
vi.mock('../../src/main/legacy-data', () => ({
  LegacyDataService: vi.fn(function LegacyDataServiceMock() {
    return {
      hasPendingCleanup: mocks.hasPendingLegacyCleanup,
      initialize: mocks.initializeLegacyData
    }
  }),
  registerLegacyDataHandlers: vi.fn()
}))
vi.mock('../../src/main/source-map-support', () => ({ installSourceMapSupport: vi.fn() }))
vi.mock('../../src/main/window', () => ({ createMainWindow: mocks.createMainWindow }))
vi.mock('../../src/main/window-controls', () => ({ registerWindowControlHandlers: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.app.requestSingleInstanceLock.mockReturnValue(true)
  mocks.app.whenReady.mockReturnValue(Promise.resolve())
  mocks.initializeDataDirectory.mockResolvedValue('/data')
  mocks.recoverDataDirectory.mockReturnValue(new Promise<never>(() => undefined))
  mocks.createMainWindow.mockImplementation(
    (_logger: unknown, onLifecycleEvent?: (event: string) => void) => {
      queueMicrotask(() => {
        mocks.windowShown()
        onLifecycleEvent?.('shown')
      })
      return mocks.mainWindow
    }
  )
})

describe('application startup error handling', () => {
  it('creates the window before loading application services and initializes immediately', async () => {
    await import('../../src/main/bootstrap')

    await vi.waitFor(() => expect(mocks.createMainWindow).toHaveBeenCalledOnce())
    expect(mocks.registerFileStoreProtocol).toHaveBeenCalledOnce()
    expect(mocks.registerBuiltinFileStoreProtocol).toHaveBeenCalledOnce()
    expect(mocks.registerFileStoreProtocol.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createMainWindow.mock.invocationCallOrder[0]
    )
    await vi.waitFor(() => expect(mocks.initializeDataDirectory).toHaveBeenCalledOnce())
    expect(mocks.createMainWindow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.initializeDataDirectory.mock.invocationCallOrder[0]
    )
    await vi.waitFor(() => expect(mocks.registerFileStoreHandlers).toHaveBeenCalledOnce())
    expect(mocks.windowShown.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerFileStoreHandlers.mock.invocationCallOrder[0]
    )
    expect(mocks.initializeLegacyData).not.toHaveBeenCalled()

    await vi.waitFor(() => {
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Main startup milestone',
        expect.objectContaining({ milestone: 'application-initialized' })
      )
    })
    const milestones = mocks.logger.info.mock.calls
      .filter(([message]) => message === 'Main startup milestone')
      .map(([, context]) => context as { elapsedMs: number; milestone: string })
    expect(milestones.map(({ milestone }) => milestone)).toEqual(
      expect.arrayContaining([
        'bootstrap-loaded',
        'electron-ready',
        'asset-protocols-registered',
        'window-created',
        'application-initialization-started',
        'application-module-imported',
        'application-initialized'
      ])
    )
    expect(milestones.every(({ elapsedMs }) => elapsedMs >= 0)).toBe(true)
  })

  it('uses data-directory recovery only when data-directory initialization fails', async () => {
    const failure = new Error('data directory unavailable')
    mocks.initializeDataDirectory.mockRejectedValue(failure)

    await import('../../src/main/bootstrap')
    await vi.waitFor(() => expect(mocks.createMainWindow).toHaveBeenCalledOnce())

    await vi.waitFor(() => {
      expect(mocks.recoverDataDirectory).toHaveBeenCalledWith('/user-data', failure)
    })
    expect(mocks.registerFileStoreHandlers).not.toHaveBeenCalled()
    expect(mocks.showErrorBox).not.toHaveBeenCalled()
  })

  it('reports failures after data-directory initialization as application startup errors', async () => {
    const failure = new Error('file store registration failed')
    mocks.registerFileStoreHandlers.mockImplementation(() => {
      throw failure
    })

    await import('../../src/main/bootstrap')
    await vi.waitFor(() => expect(mocks.createMainWindow).toHaveBeenCalledOnce())

    await vi.waitFor(() => {
      expect(mocks.showErrorBox).toHaveBeenCalledWith('应用启动失败', failure.message)
    })
    expect(mocks.recoverDataDirectory).not.toHaveBeenCalled()
    expect(mocks.app.exit).toHaveBeenCalledWith(1)
  })
})
