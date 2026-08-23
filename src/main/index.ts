import { app, BrowserWindow, dialog, safeStorage } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerConfigStore } from '@ls101/config-store/main'
import { registerAIRouter } from '@ls101/airouter/main'
import { registerClipboard } from '@ls101/clipboard/main'
import { registerFileDialog } from '@ls101/file-dialog/main'
import {
  registerBuiltinFileStore,
  registerBuiltinFileStoreScheme,
  registerFileStore,
  registerFileStoreScheme
} from '@ls101/file-store/main'
import { join } from 'node:path'
import { registerAppInfoHandlers } from './app-info'
import {
  initializeDataDirectory,
  recoverDataDirectory,
  registerDataDirectoryHandlers
} from './data-directory'
import { registerLicenseHandlers } from './license'
import { LICENSE_RECEIPT_FILENAME, type LicenseServiceOptions } from './license-service'
import { createMainWindow } from './window'
import { registerWindowControlHandlers } from './window-controls'

registerFileStoreScheme()
registerBuiltinFileStoreScheme()
let applicationInitialized = false

async function initializeApplication(): Promise<void> {
  electronApp.setAppUserModelId('io.github.zzsqjdhqgb.cyez-ls101')

  const isLocalIntegrationTest =
    process.env['LS101_INTEGRATION_TEST'] === '1' &&
    (!app.isPackaged || app.getVersion().includes('-local.'))

  if (process.platform === 'linux' && isLocalIntegrationTest) {
    safeStorage.setUsePlainTextEncryption(true)
  }

  const userDataDir = app.getPath('userData')
  let dataDir: string
  try {
    dataDir = await initializeDataDirectory(userDataDir)
  } catch (error) {
    console.error('Failed to initialize application data directory', error)
    return recoverDataDirectory(userDataDir, error)
  }
  registerFileStore({ baseDir: dataDir })
  registerBuiltinFileStore({
    baseDir: app.isPackaged
      ? join(process.resourcesPath, 'builtin')
      : join(app.getAppPath(), 'resources', 'builtin')
  })
  registerConfigStore({ baseDir: dataDir })
  registerAIRouter({ baseDir: dataDir })
  registerClipboard()
  registerFileDialog()
  registerAppInfoHandlers()
  registerLicenseHandlers(createLicenseOptions(userDataDir, isLocalIntegrationTest))
  registerDataDirectoryHandlers(userDataDir, dataDir)
  registerWindowControlHandlers()

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createMainWindow()
  applicationInitialized = true

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
}

function createLicenseOptions(
  userDataDir: string,
  isLocalIntegrationTest: boolean
): LicenseServiceOptions {
  const options: LicenseServiceOptions = {
    storagePath: join(userDataDir, LICENSE_RECEIPT_FILENAME)
  }
  if (!isLocalIntegrationTest) return options

  const expectedCodeHash = process.env['LS101_LICENSE_TEST_CODE_HASH']
  if (expectedCodeHash) options.expectedCodeHash = expectedCodeHash

  const fixedNow = process.env['LS101_LICENSE_TEST_NOW']
  if (fixedNow) {
    const fixedTime = Date.parse(fixedNow)
    if (!Number.isFinite(fixedTime)) throw new Error('LS101_LICENSE_TEST_NOW is invalid')
    options.now = () => new Date(fixedTime)
  }

  return options
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  void app.whenReady().then(initializeApplication).catch(handleApplicationInitializationError)
}

app.on('window-all-closed', () => {
  if (applicationInitialized && process.platform !== 'darwin') {
    app.quit()
  }
})

function handleApplicationInitializationError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error('Failed to initialize application', error)
  dialog.showErrorBox('应用启动失败', message)
  app.exit(1)
}
