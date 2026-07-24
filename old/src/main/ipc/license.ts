/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcMain } from 'electron'
import {
  isExpired,
  validateInvitationCode,
  saveLicense,
  hasStoredLicense,
  verifyStoredLicense
} from '../license'

export function registerLicenseHandlers(): void {
  ipcMain.handle('license:isExpired', () => {
    return isExpired()
  })

  ipcMain.handle('license:validateCode', (_event, code: string) => {
    return validateInvitationCode(code)
  })

  ipcMain.handle('license:activate', (_event, code: string) => {
    saveLicense(code)
  })

  ipcMain.handle('license:hasStoredLicense', () => {
    return hasStoredLicense()
  })

  ipcMain.handle('license:verifyStored', (_event, code: string) => {
    return verifyStoredLicense(code)
  })
}
