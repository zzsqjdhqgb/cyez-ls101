/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PendingOpenFile } from '../../shared/file-types'
import type { FileType } from '../../shared/file-types'

export function createAppBridge(): {
  app: {
    getVersion: () => Promise<string>
    getPendingOpenFile: () => Promise<PendingOpenFile | null>
    onOpenFile: (callback: (file: PendingOpenFile) => void) => () => void
    importOpenedFile: (
      filePath: string,
      fileType: FileType
    ) => Promise<{ success: boolean; error?: string }>
  }
} {
  return {
    app: {
      getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
      getPendingOpenFile: (): Promise<PendingOpenFile | null> =>
        ipcRenderer.invoke('app:getPendingOpenFile'),
      onOpenFile: (callback: (file: PendingOpenFile) => void): (() => void) => {
        const handler = (_event: IpcRendererEvent, file: PendingOpenFile): void => callback(file)
        ipcRenderer.on('app:open-file', handler)
        return () => {
          ipcRenderer.removeListener('app:open-file', handler)
        }
      },
      importOpenedFile: (
        filePath: string,
        fileType: FileType
      ): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('app:importOpenedFile', filePath, fileType)
    }
  }
}
