import { app, safeStorage } from 'electron'
import {
  createConsoleLogger,
  createMainLogger,
  registerRendererLogger,
  type Logger
} from '@ls101/logger/main'
import { registerConfigStore } from '@ls101/config-store/main'
import { registerAIRouter } from '@ls101/airouter/main'
import { registerClipboard } from '@ls101/clipboard/main'
import { registerFileDialog } from '@ls101/file-dialog/main'
import { registerBuiltinFileStore, registerFileStore } from '@ls101/file-store/main'
import { join } from 'node:path'
import { registerAppInfoHandlers } from './app-info'
import {
  initializeDataDirectory,
  recoverDataDirectory,
  registerDataDirectoryHandlers
} from './data-directory'
import { LegacyDataService, registerLegacyDataHandlers } from './legacy-data'
import { registerLicenseHandlers } from './license'
import { LICENSE_RECEIPT_FILENAME, type LicenseServiceOptions } from './license-service'

export async function initializeApplication(): Promise<Logger> {
  const applicationLogger = await initializeApplicationLogger()
  applicationLogger.info('Application initialization started', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch
  })

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
    applicationLogger.error('Failed to initialize application data directory', error)
    return recoverDataDirectory(userDataDir, error)
  }
  const legacyDataService = new LegacyDataService(userDataDir, dataDir)
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
  registerDataDirectoryHandlers(userDataDir, dataDir, {
    isLegacyCleanupPending: () => legacyDataService.hasPendingCleanup()
  })
  registerLegacyDataHandlers(legacyDataService)
  registerRendererLogger(applicationLogger)
  return applicationLogger
}

async function initializeApplicationLogger(): Promise<Logger> {
  try {
    return await createMainLogger({ directory: app.getPath('logs') })
  } catch (error) {
    const fallback = createConsoleLogger()
    fallback.error('Persistent logger unavailable; using console-only logging', error)
    return fallback
  }
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
