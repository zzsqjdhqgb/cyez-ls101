/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcRenderer, IpcRendererEvent } from 'electron'

export function createWindowBridge(): {
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
  }
} {
  return {
    window: {
      minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
      maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
      close: (): Promise<void> => ipcRenderer.invoke('window:close'),
      isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
      onMaximizeChange: (callback: (isMaximized: boolean) => void): (() => void) => {
        const handler = (_event: IpcRendererEvent, isMaximized: boolean): void =>
          callback(isMaximized)
        ipcRenderer.on('window:maximize-change', handler)
        return () => {
          ipcRenderer.removeListener('window:maximize-change', handler)
        }
      }
    }
  }
}
