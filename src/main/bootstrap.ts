/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { STARTUP_CHANNELS } from '@ls101/core-types'
import { registerBuiltinFileStoreScheme, registerFileStoreScheme } from '@ls101/file-store/main'
import type { Logger } from '@ls101/logger/main'
import { installSourceMapSupport } from './source-map-support'
import { createMainWindow } from './window'
import { registerWindowControlHandlers } from './window-controls'

installSourceMapSupport()
registerFileStoreScheme()
registerBuiltinFileStoreScheme()
registerWindowControlHandlers()

interface StartupResult {
  ok: boolean
  message?: string
}

let applicationInitialized = false
let logger: Logger | null = null
let startupResult: Promise<StartupResult> | null = null

process.on('uncaughtExceptionMonitor', (error) => {
  if (logger) logger.errorSync('Main process uncaught exception', error)
  else console.error('Main process uncaught exception', error)
})

ipcMain.handle(STARTUP_CHANNELS.whenReady, async () => {
  if (!startupResult) throw new Error('应用启动尚未开始')
  const result = await startupResult
  if (!result.ok) throw new Error(result.message ?? '应用初始化失败')
})

app.on('browser-window-created', (_event, window) => {
  optimizer.watchWindowShortcuts(window)
})

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

app.on('activate', () => {
  if (applicationInitialized && BrowserWindow.getAllWindows().length === 0) {
    createMainWindow(() => logger)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function startApplication(): void {
  electronApp.setAppUserModelId('io.github.zzsqjdhqgb.cyez-ls101')

  let resolveStartup: (result: StartupResult) => void = () => undefined
  startupResult = new Promise((resolve) => {
    resolveStartup = resolve
  })

  const window = createMainWindow(() => logger)
  window.once('ready-to-show', () => {
    void initializeApplication().then(resolveStartup)
  })
}

async function initializeApplication(): Promise<StartupResult> {
  try {
    const application = await import('./index')
    logger = await application.initializeApplication()
    applicationInitialized = true
    return { ok: true }
  } catch (error) {
    handleApplicationInitializationError(error)
    return { ok: false, message: errorMessage(error) }
  }
}

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
