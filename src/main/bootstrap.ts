/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { STARTUP_CHANNELS } from '@ls101/core-types'
import {
  registerBuiltinFileStoreProtocol,
  registerBuiltinFileStoreScheme,
  registerFileStoreProtocol,
  registerFileStoreScheme
} from '@ls101/file-store/main'
import type { Logger } from '@ls101/logger/main'
import { installSourceMapSupport } from './source-map-support'
import { createMainWindow } from './window'
import type { MainWindowLifecycleEvent } from './window'
import { registerWindowControlHandlers } from './window-controls'

// 轻量启动入口先创建窗口，再动态加载完整业务模块；日志就绪前暂存启动里程碑。
const mainStartupStartedAt = performance.now()
const pendingStartupMilestones: MainStartupMilestoneEntry[] = []

// 自定义协议的 scheme 必须在 Electron ready 前注册，协议处理器稍后再绑定。
installSourceMapSupport()
registerFileStoreScheme()
registerBuiltinFileStoreScheme()
registerWindowControlHandlers()

/** 启动结果同时供渲染进程就绪检查和资源协议解析目录使用。 */
type StartupResult =
  | { ok: true; dataDirectory: string; builtinDataDirectory: string }
  | { ok: false; message: string }

let applicationInitialized = false
let logger: Logger | null = null
let startupResult: Promise<StartupResult> | null = null

type MainStartupMilestone =
  | 'bootstrap-loaded'
  | 'electron-ready'
  | 'asset-protocols-registered'
  | 'window-created'
  | 'renderer-dom-ready'
  | 'window-ready-to-show'
  | 'window-shown'
  | 'window-destroyed-before-shown'
  | 'window-load-failed-before-shown'
  | 'application-initialization-started'
  | 'application-module-imported'
  | 'application-initialized'

type MainStartupMilestoneEntry = {
  milestone: MainStartupMilestone
  elapsedMs: number
}

recordMainStartupMilestone('bootstrap-loaded')

// 只监测并记录未捕获异常，不改变 Node.js 默认的异常退出行为。
process.on('uncaughtExceptionMonitor', (error) => {
  if (logger) logger.errorSync('Main process uncaught exception', error)
  else console.error('Main process uncaught exception', error)
})

// 渲染进程可提前请求就绪状态，等待同一个初始化结果后继续加载业务。
ipcMain.handle(STARTUP_CHANNELS.whenReady, async () => {
  if (!startupResult) throw new Error('应用启动尚未开始')
  const result = await startupResult
  if (!result.ok) throw new Error(result.message ?? '应用初始化失败')
})

app.on('browser-window-created', (_event, window) => {
  optimizer.watchWindowShortcuts(window)
})

// 保持单实例运行，后续实例只唤起已有窗口。
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(startApplication).catch(handleApplicationInitializationError)
}

// macOS 关闭所有窗口后应用仍可存活，激活时只在业务初始化完成后重建窗口。
app.on('activate', () => {
  if (applicationInitialized && BrowserWindow.getAllWindows().length === 0) {
    createMainWindow(() => logger)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** 建立共享就绪信号、绑定资源协议，并让窗口显示与业务初始化协同推进。 */
function startApplication(): void {
  recordMainStartupMilestone('electron-ready')
  electronApp.setAppUserModelId('io.github.zzsqjdhqgb.cyez-ls101')

  let resolveStartup: (result: StartupResult) => void = () => undefined
  startupResult = new Promise((resolve) => {
    resolveStartup = resolve
  })
  let resolveWindowShown: () => void = () => undefined
  let rejectWindowShown: (error: Error) => void = () => undefined
  const windowShown = new Promise<void>((resolve, reject) => {
    resolveWindowShown = resolve
    rejectWindowShown = reject
  })
  // 先挂接拒绝处理，避免业务模块尚未开始等待窗口时出现未处理的拒绝。
  void windowShown.catch(() => undefined)

  // 协议可先注册；实际资源请求会等待初始化完成后取得最终目录。
  registerFileStoreProtocol({
    baseDir: () => initializedDataDirectory('application')
  })
  registerBuiltinFileStoreProtocol({
    baseDir: () => initializedDataDirectory('builtin')
  })
  recordMainStartupMilestone('asset-protocols-registered')

  createMainWindow(
    () => logger,
    (event) => {
      recordMainWindowLifecycleEvent(event)
      if (event === 'shown') resolveWindowShown()
      if (event === 'destroyed-before-shown') {
        rejectWindowShown(new Error('主窗口在启动界面显示前已关闭'))
      }
      if (event === 'load-failed-before-shown') {
        rejectWindowShown(new Error('启动界面加载失败'))
      }
    }
  )
  recordMainStartupMilestone('window-created')
  recordMainStartupMilestone('application-initialization-started')
  void initializeApplication(windowShown).then(resolveStartup)
}

/** 加载完整主进程模块，将初始化成功或失败收敛为可共享的结果。 */
async function initializeApplication(waitForWindowShown: Promise<void>): Promise<StartupResult> {
  try {
    await waitForIntegrationStartupDelay()
    const application = await import('./index')
    recordMainStartupMilestone('application-module-imported')
    const initialized = await application.initializeApplication({ waitForWindowShown })
    logger = initialized.logger
    flushMainStartupMilestones()
    recordMainStartupMilestone('application-initialized')
    applicationInitialized = true
    return {
      ok: true,
      dataDirectory: initialized.dataDirectory,
      builtinDataDirectory: initialized.builtinDataDirectory
    }
  } catch (error) {
    handleApplicationInitializationError(error)
    return { ok: false, message: errorMessage(error) }
  }
}

/** 将窗口生命周期事件转换为统一的主进程启动里程碑。 */
function recordMainWindowLifecycleEvent(event: MainWindowLifecycleEvent): void {
  const milestone: Record<MainWindowLifecycleEvent, MainStartupMilestone> = {
    'renderer-dom-ready': 'renderer-dom-ready',
    'ready-to-show': 'window-ready-to-show',
    shown: 'window-shown',
    'destroyed-before-shown': 'window-destroyed-before-shown',
    'load-failed-before-shown': 'window-load-failed-before-shown'
  }
  recordMainStartupMilestone(milestone[event])
}

/** 用相对启动时间记录里程碑，日志服务未创建时先保存在内存中。 */
function recordMainStartupMilestone(milestone: MainStartupMilestone): void {
  const entry = {
    milestone,
    elapsedMs: Math.max(0, Math.round((performance.now() - mainStartupStartedAt) * 10) / 10)
  }
  if (logger) logger.info('Main startup milestone', entry)
  else pendingStartupMilestones.push(entry)
}

/** 日志服务就绪后按原顺序补写早期启动记录。 */
function flushMainStartupMilestones(): void {
  if (!logger) return
  pendingStartupMilestones.splice(0).forEach((entry) => {
    logger?.info('Main startup milestone', entry)
  })
}

/** 仅在集成测试中模拟慢启动，延迟上限为 30 秒。 */
async function waitForIntegrationStartupDelay(): Promise<void> {
  if (process.env['LS101_INTEGRATION_TEST'] !== '1') return
  const milliseconds = Number(process.env['LS101_INTEGRATION_STARTUP_DELAY_MS'] ?? 0)
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return
  await new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, 30_000)))
}

/** 资源协议通过启动结果获取目录，避免使用尚未准备好的路径。 */
async function initializedDataDirectory(kind: 'application' | 'builtin'): Promise<string> {
  if (!startupResult) throw new Error('应用启动尚未开始')
  const result = await startupResult
  if (!result.ok) throw new Error(result.message)
  return kind === 'application' ? result.dataDirectory : result.builtinDataDirectory
}

/** 启动失败时同步记录错误并显示原生提示，随后以失败状态退出。 */
function handleApplicationInitializationError(error: unknown): void {
  const message = errorMessage(error)
  if (logger) logger.errorSync('Failed to initialize application', error)
  else console.error('Failed to initialize application', error)
  dialog.showErrorBox('应用启动失败', message)
  app.exit(1)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
