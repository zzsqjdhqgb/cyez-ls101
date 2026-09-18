import { registerAIRouter } from '@ls101/airouter/main'
import { registerClipboard } from '@ls101/clipboard/main'
import { registerConfigStore } from '@ls101/config-store/main'
import { registerFileDialog } from '@ls101/file-dialog/main'
import { registerBuiltinFileStoreHandlers, registerFileStoreHandlers } from '@ls101/file-store/main'
import { registerRendererLogger, type Logger } from '@ls101/logger/main'
import { join } from 'node:path'
import { registerAppInfoHandlers } from './app-info'
import type { ApplicationWorkerUrls } from './application-worker-urls'
import { registerDataDirectoryHandlers } from './data-directory'
import { createWorkerLegacyArchiveOperations } from './legacy-data-archive-client'
import { LegacyDataService, registerLegacyDataHandlers } from './legacy-data'
import { registerLicenseHandlers } from './license'
import { LICENSE_RECEIPT_FILENAME, type LicenseServiceOptions } from './license-service'

interface ApplicationServiceOptions {
  builtinDataDirectory: string
  dataDirectory: string
  isLocalIntegrationTest: boolean
  logger: Logger
  userDataDirectory: string
  workerUrls: ApplicationWorkerUrls
}

export function registerApplicationServices(options: ApplicationServiceOptions): void {
  const {
    builtinDataDirectory,
    dataDirectory,
    isLocalIntegrationTest,
    logger,
    userDataDirectory,
    workerUrls
  } = options
  const legacyDataService = new LegacyDataService(
    userDataDirectory,
    dataDirectory,
    createWorkerLegacyArchiveOperations(workerUrls.legacyData)
  )

  registerFileStoreHandlers({ baseDir: dataDirectory })
  registerBuiltinFileStoreHandlers({ baseDir: builtinDataDirectory })
  registerConfigStore({ baseDir: dataDirectory })
  registerAIRouter({
    baseDir: dataDirectory,
    workerUrls: {
      pocketTts: workerUrls.pocketTts,
      pronunciationAssessment: workerUrls.pronunciationAssessment,
      speechRecognition: workerUrls.speechRecognition
    }
  })
  registerClipboard()
  registerFileDialog()
  registerAppInfoHandlers()
  registerLicenseHandlers(createLicenseOptions(userDataDirectory, isLocalIntegrationTest))
  registerDataDirectoryHandlers(userDataDirectory, dataDirectory, {
    isLegacyCleanupPending: () => legacyDataService.hasPendingCleanup()
  })
  registerLegacyDataHandlers(legacyDataService)
  registerRendererLogger(logger)
}

function createLicenseOptions(
  userDataDirectory: string,
  isLocalIntegrationTest: boolean
): LicenseServiceOptions {
  const options: LicenseServiceOptions = {
    storagePath: join(userDataDirectory, LICENSE_RECEIPT_FILENAME)
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
