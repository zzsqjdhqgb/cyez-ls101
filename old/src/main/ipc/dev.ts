/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcMain, app } from 'electron'
import { isDev, openDataFolder } from '../services/dev-service'
import { removeFileAssociations, resetFileAssociationCache } from '../utils/file-association'
import {
  checkAndClearUpdateNotificationFlag,
  checkAndClearResetRequiredFlag
} from '../utils/version'

let devToolsEnabled = !app.isPackaged

export function isDevToolsEnabled(): boolean {
  return devToolsEnabled
}

export function registerDevHandlers(): void {
  ipcMain.handle('dev:isDev', () => {
    return isDev()
  })

  ipcMain.handle('dev:setDevToolsEnabled', (_event, enabled: boolean) => {
    devToolsEnabled = enabled
  })

  ipcMain.handle('dev:resetData', async () => {
    const { performSoftReset } = await import('../index')
    await performSoftReset()
  })

  ipcMain.handle('dev:getResetFailedPaths', async () => {
    const { getAndClearPendingResetFailedPaths } = await import('../index')
    return getAndClearPendingResetFailedPaths()
  })

  ipcMain.handle('dev:openDataFolder', () => {
    openDataFolder()
  })

  ipcMain.handle('dev:removeFileAssociations', () => {
    return removeFileAssociations()
  })

  ipcMain.handle('dev:confirmHardReset', async () => {
    const { writeFlagAndExit } = await import('../services/dev-service')
    writeFlagAndExit()
  })

  ipcMain.handle('dev:resetFileAssociationCache', () => {
    return resetFileAssociationCache()
  })

  ipcMain.handle('dev:checkUpdateNotification', () => {
    return checkAndClearUpdateNotificationFlag()
  })

  ipcMain.handle('dev:checkResetRequired', () => {
    return checkAndClearResetRequiredFlag()
  })
}
