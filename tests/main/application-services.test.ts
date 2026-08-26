import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  legacyOperations: { archive: 'operations' },
  createWorkerLegacyArchiveOperations: vi.fn(),
  LegacyDataService: vi.fn(function LegacyDataServiceMock() {
    return { hasPendingCleanup: vi.fn(() => false) }
  }),
  registerAIRouter: vi.fn(),
  registerNoop: vi.fn()
}))

vi.mock('@ls101/airouter/main', () => ({ registerAIRouter: mocks.registerAIRouter }))
vi.mock('@ls101/clipboard/main', () => ({ registerClipboard: mocks.registerNoop }))
vi.mock('@ls101/config-store/main', () => ({ registerConfigStore: mocks.registerNoop }))
vi.mock('@ls101/file-dialog/main', () => ({ registerFileDialog: mocks.registerNoop }))
vi.mock('@ls101/file-store/main', () => ({
  registerBuiltinFileStoreHandlers: mocks.registerNoop,
  registerFileStoreHandlers: mocks.registerNoop
}))
vi.mock('@ls101/logger/main', () => ({ registerRendererLogger: mocks.registerNoop }))
vi.mock('../../src/main/app-info', () => ({ registerAppInfoHandlers: mocks.registerNoop }))
vi.mock('../../src/main/data-directory', () => ({
  registerDataDirectoryHandlers: mocks.registerNoop
}))
vi.mock('../../src/main/legacy-data-archive-client', () => ({
  createWorkerLegacyArchiveOperations: mocks.createWorkerLegacyArchiveOperations
}))
vi.mock('../../src/main/legacy-data', () => ({
  LegacyDataService: mocks.LegacyDataService,
  registerLegacyDataHandlers: mocks.registerNoop
}))
vi.mock('../../src/main/license', () => ({ registerLicenseHandlers: mocks.registerNoop }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkerLegacyArchiveOperations.mockReturnValue(mocks.legacyOperations)
})

describe('application service registration', () => {
  it('forwards all worker URLs to their owning services', async () => {
    const workerUrls = {
      legacyData: new URL('file:///workers/legacy-data-worker.js'),
      pocketTts: new URL('file:///workers/pocket-tts-worker.js'),
      pronunciationAssessment: new URL('file:///workers/pronunciation-assessment-worker.js'),
      speechRecognition: new URL('file:///workers/qwen3-asr-worker.js')
    }
    const { registerApplicationServices } = await import('../../src/main/application-services')

    registerApplicationServices({
      builtinDataDirectory: '/builtin',
      dataDirectory: '/data',
      isLocalIntegrationTest: false,
      logger: {} as never,
      userDataDirectory: '/user-data',
      workerUrls
    })

    expect(mocks.createWorkerLegacyArchiveOperations).toHaveBeenCalledWith(workerUrls.legacyData)
    expect(mocks.LegacyDataService).toHaveBeenCalledWith(
      '/user-data',
      '/data',
      mocks.legacyOperations
    )
    expect(mocks.registerAIRouter).toHaveBeenCalledWith({
      baseDir: '/data',
      workerUrls: {
        pocketTts: workerUrls.pocketTts,
        pronunciationAssessment: workerUrls.pronunciationAssessment,
        speechRecognition: workerUrls.speechRecognition
      }
    })
  })
})
