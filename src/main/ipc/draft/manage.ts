/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcMain, dialog } from 'electron'
import { getMainWindow } from '../../win'
import { getDraftsPath, getTemplatesPath } from '../../utils'
import {
  createDraft,
  listDrafts,
  loadDraft,
  updateText,
  updateTitle,
  uploadFile,
  uploadClipboardImage,
  removeFile,
  deleteDraft
} from '../../services/draft-service'

export function registerDraftManageHandlers(): void {
  ipcMain.handle('draft:create', async (_event, templateId: string) => {
    return createDraft(getTemplatesPath(), getDraftsPath(), templateId)
  })

  ipcMain.handle('draft:list', async () => {
    return listDrafts(getDraftsPath())
  })

  ipcMain.handle('draft:load', async (_event, draftId: string) => {
    return loadDraft(getDraftsPath(), draftId)
  })

  ipcMain.handle('draft:updateText', async (_event, draftId: string, id: string, value: string) => {
    updateText(getDraftsPath(), draftId, id, value)
  })

  ipcMain.handle('draft:updateTitle', async (_event, draftId: string, title: string) => {
    updateTitle(getDraftsPath(), draftId, title)
  })

  ipcMain.handle('draft:uploadFile', async (_event, draftId: string, id: string) => {
    const win = getMainWindow()
    if (!win) return
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择文件',
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return
    uploadFile(getDraftsPath(), draftId, id, filePaths[0])
  })

  ipcMain.handle(
    'draft:uploadClipboardImage',
    async (_event, draftId: string, id: string, base64Data: string, ext: string) => {
      uploadClipboardImage(getDraftsPath(), draftId, id, base64Data, ext)
    }
  )

  ipcMain.handle('draft:removeFile', async (_event, draftId: string, id: string) => {
    removeFile(getDraftsPath(), draftId, id)
  })

  ipcMain.handle('draft:delete', async (_event, draftId: string) => {
    return deleteDraft(getDraftsPath(), draftId)
  })
}
