/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcRenderer, IpcRendererEvent } from 'electron'
import type { DraftListItem, DraftView } from '../../renderer/src/types'

export function createDraftBridge(): {
  draft: {
    create: (templateId: string) => Promise<string>
    list: () => Promise<DraftListItem[]>
    load: (draftId: string) => Promise<DraftView>
    updateText: (draftId: string, id: string, value: string) => Promise<void>
    updateTitle: (draftId: string, title: string) => Promise<void>
    uploadFile: (draftId: string, id: string) => Promise<void>
    uploadClipboardImage: (draftId: string, id: string, data: string, ext: string) => Promise<void>
    removeFile: (draftId: string, id: string) => Promise<void>
    delete: (draftId: string) => Promise<{ success: boolean }>
    exportExam: (draftId: string) => Promise<{ success: boolean; error?: string }>
    importDraft: () => Promise<void>
    exportDraft: (draftId: string) => Promise<void>
    onExportProgress: (
      callback: (progress: { step: string; current: number; total: number }) => void
    ) => () => void
  }
} {
  return {
    draft: {
      create: (templateId: string): Promise<string> =>
        ipcRenderer.invoke('draft:create', templateId),
      list: (): Promise<DraftListItem[]> => ipcRenderer.invoke('draft:list'),
      load: (draftId: string): Promise<DraftView> => ipcRenderer.invoke('draft:load', draftId),
      updateText: (draftId: string, id: string, value: string): Promise<void> =>
        ipcRenderer.invoke('draft:updateText', draftId, id, value),
      updateTitle: (draftId: string, title: string): Promise<void> =>
        ipcRenderer.invoke('draft:updateTitle', draftId, title),
      uploadFile: (draftId: string, id: string): Promise<void> =>
        ipcRenderer.invoke('draft:uploadFile', draftId, id),
      uploadClipboardImage: (
        draftId: string,
        id: string,
        data: string,
        ext: string
      ): Promise<void> => ipcRenderer.invoke('draft:uploadClipboardImage', draftId, id, data, ext),
      removeFile: (draftId: string, id: string): Promise<void> =>
        ipcRenderer.invoke('draft:removeFile', draftId, id),
      delete: (draftId: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('draft:delete', draftId),
      exportExam: (draftId: string): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('draft:exportExam', draftId),
      importDraft: (): Promise<void> => ipcRenderer.invoke('draft:import'),
      exportDraft: (draftId: string): Promise<void> =>
        ipcRenderer.invoke('draft:exportDraft', draftId),
      onExportProgress: (
        callback: (progress: { step: string; current: number; total: number }) => void
      ): (() => void) => {
        const handler = (
          _event: IpcRendererEvent,
          progress: { step: string; current: number; total: number }
        ): void => callback(progress)
        ipcRenderer.on('draft:exportExam-progress', handler)
        return () => {
          ipcRenderer.removeListener('draft:exportExam-progress', handler)
        }
      }
    }
  }
}
