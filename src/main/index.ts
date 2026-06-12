/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/index.ts
import process from 'node:process'
process.stdout.setDefaultEncoding('utf-8')
process.stderr.setDefaultEncoding('utf-8')

import { app, BrowserWindow, protocol, ipcMain } from 'electron'
import {
  ensureDir,
  getExamsPath,
  getSubmissionsPath,
  getTemplatesPath,
  getDraftsPath,
  getGradingPath
} from './utils'
import { existsSync } from 'node:fs'

// IPC 处理器注册（side-effect imports）
import './ipc/exam'
import './ipc/submission'
import './ipc/template'
import {
  registerDraftManageHandlers,
  registerDraftExportHandlers,
  registerDraftTransferHandlers
} from './ipc/draft'
import { registerGradingHandlers } from './ipc/grading'
import { registerDevHandlers } from './ipc/dev'
import { registerWindowIpcHandlersOnce } from './ipc/window'
import './ipc/app'

// 提取后的模块
import { createWindow } from './app/create-window'
import { initializeBundledData } from './app/initialize'
import {
  getStoredVersion,
  getCurrentVersion,
  writeVersionFile,
  writeUpdateNotificationFlag,
  writeResetRequiredFlag
} from './utils/version'
import { registerExamResourceProtocol } from './protocols/exam-resource'
import { registerDraftResourceProtocol } from './protocols/draft-resource'
import { registerGradingResourceProtocol } from './protocols/grading-resource'
import { registerAppResourceProtocol } from './protocols/app-resource'
import { registerFileAssociations, resolveFileType } from './utils/file-association'
import type { FileType } from '../shared/file-types'
import { getMainWindow } from './win'
import { isExpired, getExpirationMessage } from './license'
import { registerLicenseHandlers } from './ipc/license'
import {
  getCacheClearFlagPath,
  clearSessionData,
  deepRemove,
  isDev,
  triggerHardReset
} from './services/dev-service'
;(() => {
  const flagPath = getCacheClearFlagPath()
  if (!existsSync(flagPath)) return

  const failed = deepRemove(app.getPath('userData'))
  if (failed.length > 0) {
    console.warn('[clear] 以下文件未能删除:', failed)
  }
})()

const gotTheLock = app.requestSingleInstanceLock()

let pendingOpenFile: { path: string; type: FileType } | null = null
let isClearingCache = false
let pendingResetFailedPaths: string[] | null = null

export function getIsClearingCache(): boolean {
  return isClearingCache
}

export function getAndClearPendingResetFailedPaths(): string[] {
  const paths = pendingResetFailedPaths || []
  pendingResetFailedPaths = null
  return paths
}

function setPendingOpenFile(filePath: string): void {
  const fileType = resolveFileType(filePath)
  if (fileType) {
    pendingOpenFile = { path: filePath, type: fileType }
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:open-file', pendingOpenFile)
      win.focus()
    }
  }
}

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  setPendingOpenFile(filePath)
})

app.on('second-instance', (_event, argv) => {
  for (const arg of argv.slice(1)) {
    if (resolveFileType(arg)) {
      setPendingOpenFile(arg)
      break
    }
  }
  const win = getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

function processArgvFile(): void {
  const args = process.argv.slice(app.isPackaged ? 1 : 2)
  for (const arg of args) {
    if (resolveFileType(arg)) {
      pendingOpenFile = { path: arg, type: resolveFileType(arg)! }
      break
    }
  }
}

if (!gotTheLock) {
  app.quit()
} else {
  startApp()
}

function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'exam-resource',
      privileges: {
        bypassCSP: true,
        stream: true,
        standard: true,
        supportFetchAPI: true,
        secure: true
      }
    },
    {
      scheme: 'grading-resource',
      privileges: {
        bypassCSP: true,
        stream: true,
        standard: true,
        supportFetchAPI: true,
        secure: true
      }
    },
    {
      scheme: 'app-resource',
      privileges: {
        bypassCSP: true,
        stream: true,
        standard: true,
        supportFetchAPI: true,
        secure: true
      }
    },
    {
      scheme: 'draft-resource',
      privileges: {
        bypassCSP: true,
        stream: true,
        standard: true,
        supportFetchAPI: true,
        secure: true
      }
    }
  ])
}

function registerAllIpcHandlers(): void {
  registerDraftManageHandlers()
  registerDraftExportHandlers()
  registerDraftTransferHandlers()
  registerGradingHandlers()
  registerDevHandlers()
  registerWindowIpcHandlersOnce()
  registerLicenseHandlers()
}

function recreateDataDirs(): void {
  ensureDir(getExamsPath())
  ensureDir(getSubmissionsPath())
  ensureDir(getTemplatesPath())
  ensureDir(getDraftsPath())
  ensureDir(getGradingPath())
}

export async function performSoftReset(): Promise<void> {
  if (!isDev()) {
    triggerHardReset()
    return
  }

  isClearingCache = true
  pendingResetFailedPaths = []

  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  })

  await new Promise((resolve) => setTimeout(resolve, 800))

  clearSessionData()

  const failed = deepRemove(app.getPath('userData'))

  recreateDataDirs()

  if (failed.length > 0) {
    pendingResetFailedPaths = failed
  }

  await initializeBundledData()

  createWindow()

  isClearingCache = false
}

function startApp(): void {
  app.whenReady().then(async () => {
    if (isExpired()) {
      const { dialog } = await import('electron')
      dialog.showErrorBox('试用期已到期', getExpirationMessage())
      app.quit()
      return
    }

    recreateDataDirs()

    await initializeBundledData()

    registerExamResourceProtocol()
    registerDraftResourceProtocol()
    registerGradingResourceProtocol()
    registerAppResourceProtocol()
    registerAllIpcHandlers()

    ipcMain.handle('app:getPendingOpenFile', () => {
      const file = pendingOpenFile
      pendingOpenFile = null
      return file
    })

    const storedVersion = getStoredVersion()
    const currentVersion = getCurrentVersion()

    if (storedVersion === null) {
      writeResetRequiredFlag()
    } else if (storedVersion !== currentVersion) {
      writeUpdateNotificationFlag(storedVersion)
      writeVersionFile(currentVersion)
    }

    createWindow()

    registerFileAssociations()
    processArgvFile()
  })

  app.on('window-all-closed', () => {
    if (isClearingCache) return
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

registerPrivilegedSchemes()
