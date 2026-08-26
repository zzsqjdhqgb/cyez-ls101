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
  mainWindow: { once: vi.fn() },
  createMainWindow: vi.fn(),
  initializeDataDirectory: vi.fn<() => Promise<string>>(),
  initializeLegacyData: vi.fn().mockResolvedValue(undefined),
  hasPendingLegacyCleanup: vi.fn(() => false),
  recoverDataDirectory: vi.fn<() => Promise<never>>(),
  registerFileStoreHandlers: vi.fn(),
  registerFileStoreProtocol: vi.fn(),
  registerBuiltinFileStoreProtocol: vi.fn(),
  showErrorBox: vi.fn()
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
  const logger = {
    error: vi.fn(),
    errorSync: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
  return {
    createConsoleLogger: vi.fn(() => logger),
    createMainLogger: vi.fn(async () => logger),
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

let readyToShow: (() => void) | null = null

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.app.requestSingleInstanceLock.mockReturnValue(true)
  mocks.app.whenReady.mockReturnValue(Promise.resolve())
  mocks.initializeDataDirectory.mockResolvedValue('/data')
  mocks.recoverDataDirectory.mockReturnValue(new Promise<never>(() => undefined))
  readyToShow = null
  mocks.mainWindow.once.mockImplementation((event: string, listener: () => void) => {
    if (event === 'ready-to-show') readyToShow = listener
  })
  mocks.createMainWindow.mockReturnValue(mocks.mainWindow)
})

describe('application startup error handling', () => {
  it('creates the window before loading application services', async () => {
    await import('../../src/main/bootstrap')

    await vi.waitFor(() => expect(mocks.createMainWindow).toHaveBeenCalledOnce())
    expect(mocks.registerFileStoreProtocol).toHaveBeenCalledOnce()
    expect(mocks.registerBuiltinFileStoreProtocol).toHaveBeenCalledOnce()
    expect(mocks.registerFileStoreProtocol.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createMainWindow.mock.invocationCallOrder[0]
    )
    expect(mocks.initializeDataDirectory).not.toHaveBeenCalled()

    readyToShow?.()
    await vi.waitFor(() => expect(mocks.initializeDataDirectory).toHaveBeenCalledOnce())
    expect(mocks.initializeLegacyData).not.toHaveBeenCalled()
  })

  it('uses data-directory recovery only when data-directory initialization fails', async () => {
    const failure = new Error('data directory unavailable')
    mocks.initializeDataDirectory.mockRejectedValue(failure)

    await import('../../src/main/bootstrap')
    await vi.waitFor(() => expect(mocks.createMainWindow).toHaveBeenCalledOnce())
    readyToShow?.()

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
    readyToShow?.()

    await vi.waitFor(() => {
      expect(mocks.showErrorBox).toHaveBeenCalledWith('应用启动失败', failure.message)
    })
    expect(mocks.recoverDataDirectory).not.toHaveBeenCalled()
    expect(mocks.app.exit).toHaveBeenCalledWith(1)
  })
})
