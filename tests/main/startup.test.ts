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
  createMainWindow: vi.fn(),
  initializeDataDirectory: vi.fn<() => Promise<string>>(),
  initializeLegacyData: vi.fn().mockResolvedValue(undefined),
  hasPendingLegacyCleanup: vi.fn(() => false),
  recoverDataDirectory: vi.fn<() => Promise<never>>(),
  registerFileStore: vi.fn(),
  showErrorBox: vi.fn()
}))

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showErrorBox: mocks.showErrorBox },
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
  registerBuiltinFileStore: vi.fn(),
  registerBuiltinFileStoreScheme: vi.fn(),
  registerFileStore: mocks.registerFileStore,
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
vi.mock('../../src/main/window', () => ({ createMainWindow: mocks.createMainWindow }))
vi.mock('../../src/main/window-controls', () => ({ registerWindowControlHandlers: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.app.requestSingleInstanceLock.mockReturnValue(true)
  mocks.app.whenReady.mockReturnValue(Promise.resolve())
  mocks.initializeDataDirectory.mockResolvedValue('/data')
  mocks.recoverDataDirectory.mockReturnValue(new Promise<never>(() => undefined))
})

describe('application startup error handling', () => {
  it('waits for the licensed renderer flow before initializing legacy data', async () => {
    await import('../../src/main/index')

    await vi.waitFor(() => expect(mocks.createMainWindow).toHaveBeenCalledOnce())
    expect(mocks.initializeLegacyData).not.toHaveBeenCalled()
  })

  it('uses data-directory recovery only when data-directory initialization fails', async () => {
    const failure = new Error('data directory unavailable')
    mocks.initializeDataDirectory.mockRejectedValue(failure)

    await import('../../src/main/index')

    await vi.waitFor(() => {
      expect(mocks.recoverDataDirectory).toHaveBeenCalledWith('/user-data', failure)
    })
    expect(mocks.registerFileStore).not.toHaveBeenCalled()
    expect(mocks.showErrorBox).not.toHaveBeenCalled()
  })

  it('reports failures after data-directory initialization as application startup errors', async () => {
    const failure = new Error('file store registration failed')
    mocks.registerFileStore.mockImplementation(() => {
      throw failure
    })

    await import('../../src/main/index')

    await vi.waitFor(() => {
      expect(mocks.showErrorBox).toHaveBeenCalledWith('应用启动失败', failure.message)
    })
    expect(mocks.recoverDataDirectory).not.toHaveBeenCalled()
    expect(mocks.app.exit).toHaveBeenCalledWith(1)
  })
})
