/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcRenderer } from 'electron'

export function createDevBridge(): {
  dev: {
    isDev: () => Promise<boolean>
    resetData: () => Promise<void>
    openDataFolder: () => Promise<void>
    setDevToolsEnabled: (enabled: boolean) => Promise<void>
    removeFileAssociations: () => Promise<boolean>
    resetFileAssociationCache: () => Promise<boolean>
    getResetFailedPaths: () => Promise<string[]>
    confirmHardReset: () => Promise<void>
    checkUpdateNotification: () => Promise<{
      previousVersion: string
      currentVersion: string
    } | null>
    checkResetRequired: () => Promise<boolean>
  }
} {
  return {
    dev: {
      isDev: (): Promise<boolean> => ipcRenderer.invoke('dev:isDev'),
      resetData: (): Promise<void> => ipcRenderer.invoke('dev:resetData'),
      openDataFolder: (): Promise<void> => ipcRenderer.invoke('dev:openDataFolder'),
      setDevToolsEnabled: (enabled: boolean): Promise<void> =>
        ipcRenderer.invoke('dev:setDevToolsEnabled', enabled),
      removeFileAssociations: (): Promise<boolean> =>
        ipcRenderer.invoke('dev:removeFileAssociations'),
      resetFileAssociationCache: (): Promise<boolean> =>
        ipcRenderer.invoke('dev:resetFileAssociationCache'),
      getResetFailedPaths: (): Promise<string[]> => ipcRenderer.invoke('dev:getResetFailedPaths'),
      confirmHardReset: (): Promise<void> => ipcRenderer.invoke('dev:confirmHardReset'),
      checkUpdateNotification: (): Promise<{
        previousVersion: string
        currentVersion: string
      } | null> => ipcRenderer.invoke('dev:checkUpdateNotification'),
      checkResetRequired: (): Promise<boolean> => ipcRenderer.invoke('dev:checkResetRequired')
    }
  }
}
