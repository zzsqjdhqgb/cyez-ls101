/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcRenderer } from 'electron'

export function createLicenseBridge(): {
  license: {
    isExpired: () => Promise<boolean>
    validateCode: (code: string) => Promise<boolean>
    activate: (code: string) => Promise<void>
    hasStoredLicense: () => Promise<boolean>
    verifyStored: (code: string) => Promise<boolean>
  }
} {
  return {
    license: {
      isExpired: (): Promise<boolean> => ipcRenderer.invoke('license:isExpired'),
      validateCode: (code: string): Promise<boolean> =>
        ipcRenderer.invoke('license:validateCode', code),
      activate: (code: string): Promise<void> => ipcRenderer.invoke('license:activate', code),
      hasStoredLicense: (): Promise<boolean> => ipcRenderer.invoke('license:hasStoredLicense'),
      verifyStored: (code: string): Promise<boolean> =>
        ipcRenderer.invoke('license:verifyStored', code)
    }
  }
}
