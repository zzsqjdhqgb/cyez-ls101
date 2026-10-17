// 主进程业务服务装配：在数据目录就绪、启动窗口显示后，为渲染进程集中注册 IPC 处理器；
// 各服务的数据目录与后台工作线程地址都由 index.ts 在调用时传入，这里不解析路径。
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
import { registerReportExportHandlers } from './report-export'

/** 汇总服务注册所需的目录、日志与后台工作线程入口。 */
interface ApplicationServiceOptions {
  builtinDataDirectory: string
  dataDirectory: string
  isLocalIntegrationTest: boolean
  logger: Logger
  userDataDirectory: string
  workerUrls: ApplicationWorkerUrls
}

/** 在目录准备完成后，为渲染进程集中注册业务服务。 */
export function registerApplicationServices(options: ApplicationServiceOptions): void {
  const {
    builtinDataDirectory,
    dataDirectory,
    isLocalIntegrationTest,
    logger,
    userDataDirectory,
    workerUrls
  } = options
  // 旧数据服务与目录切换共用清理状态，归档未完成时阻止更换数据位置。
  // 归档的哈希校验与文件搬运交给工作线程，避免长时间占用主进程事件循环。
  const legacyDataService = new LegacyDataService(
    userDataDirectory,
    dataDirectory,
    createWorkerLegacyArchiveOperations(workerUrls.legacyData)
  )

  // 业务数据与内置资源各用一个目录；配置与 AI 服务跟随业务数据目录。
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
  // 剪贴板、文件对话框、报告导出与应用信息不依赖数据目录，注册时无需传入路径。
  registerClipboard()
  registerFileDialog()
  registerReportExportHandlers()
  registerAppInfoHandlers()
  registerLicenseHandlers(createLicenseOptions(userDataDirectory, isLocalIntegrationTest))
  // 目录切换在此只登记迁移计划并重启应用，实际的复制与校验在下次启动执行。
  registerDataDirectoryHandlers(userDataDirectory, dataDirectory, {
    isLegacyCleanupPending: () => legacyDataService.hasPendingCleanup()
  })
  registerLegacyDataHandlers(legacyDataService)
  registerRendererLogger(logger)
}

/** 许可证凭据固定保存在用户目录；仅本地集成测试允许注入验证码和时间。 */
function createLicenseOptions(
  userDataDirectory: string,
  isLocalIntegrationTest: boolean
): LicenseServiceOptions {
  const options: LicenseServiceOptions = {
    storagePath: join(userDataDirectory, LICENSE_RECEIPT_FILENAME)
  }
  if (!isLocalIntegrationTest) return options

  // 测试可注入验证码哈希；未注入时沿用 license-service 内置的哈希。
  const expectedCodeHash = process.env['LS101_LICENSE_TEST_CODE_HASH']
  if (expectedCodeHash) options.expectedCodeHash = expectedCodeHash

  // 固定时钟便于稳定验证许可证有效期，同时拒绝无效的测试时间。
  const fixedNow = process.env['LS101_LICENSE_TEST_NOW']
  if (fixedNow) {
    const fixedTime = Date.parse(fixedNow)
    if (!Number.isFinite(fixedTime)) throw new Error('LS101_LICENSE_TEST_NOW is invalid')
    options.now = () => new Date(fixedTime)
  }

  return options
}
