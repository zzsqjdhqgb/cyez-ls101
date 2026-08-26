import { app, safeStorage } from 'electron'
import { createConsoleLogger, createMainLogger, type Logger } from '@ls101/logger/main'
import { join } from 'node:path'

export interface ApplicationInitialization {
  logger: Logger
  dataDirectory: string
  builtinDataDirectory: string
}

interface ApplicationInitializationOptions {
  waitForWindowShown?: Promise<void>
}

export async function initializeApplication(
  options: ApplicationInitializationOptions = {}
): Promise<ApplicationInitialization> {
  const userDataDir = app.getPath('userData')
  const applicationLoggerTask = initializeApplicationLogger()
  const dataDirectoryTask = initializeApplicationDataDirectory(userDataDir)
  const applicationServicesTask = settled(
    (options.waitForWindowShown ?? Promise.resolve()).then(() => import('./application-services'))
  )
  const applicationLogger = await applicationLoggerTask
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

  const dataDirectoryResult = await dataDirectoryTask
  if (!dataDirectoryResult.ok) {
    applicationLogger.error(
      'Failed to initialize application data directory',
      dataDirectoryResult.error
    )
    return dataDirectoryResult.module.recoverDataDirectory(userDataDir, dataDirectoryResult.error)
  }
  const dataDir = dataDirectoryResult.dataDirectory
  const builtinDataDir = app.isPackaged
    ? join(process.resourcesPath, 'builtin')
    : join(app.getAppPath(), 'resources', 'builtin')
  const applicationServicesResult = await applicationServicesTask
  if (!applicationServicesResult.ok) throw applicationServicesResult.error
  applicationServicesResult.value.registerApplicationServices({
    builtinDataDirectory: builtinDataDir,
    dataDirectory: dataDir,
    isLocalIntegrationTest,
    logger: applicationLogger,
    userDataDirectory: userDataDir,
    workerUrls: {
      legacyData: new URL('./legacy-data-worker.js', import.meta.url),
      pocketTts: new URL('./pocket-tts-worker.js', import.meta.url),
      pronunciationAssessment: new URL('./pronunciation-assessment-worker.js', import.meta.url),
      speechRecognition: new URL('./qwen3-asr-worker.js', import.meta.url)
    }
  })
  return {
    logger: applicationLogger,
    dataDirectory: dataDir,
    builtinDataDirectory: builtinDataDir
  }
}

type DataDirectoryModule = typeof import('./data-directory')

type DataDirectoryInitialization =
  | { ok: true; dataDirectory: string; module: DataDirectoryModule }
  | { ok: false; error: unknown; module: DataDirectoryModule }

async function initializeApplicationDataDirectory(
  userDataDirectory: string
): Promise<DataDirectoryInitialization> {
  const module = await import('./data-directory')
  try {
    return {
      ok: true,
      dataDirectory: await module.initializeDataDirectory(userDataDirectory),
      module
    }
  } catch (error) {
    return { ok: false, error, module }
  }
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }

function settled<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  )
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
