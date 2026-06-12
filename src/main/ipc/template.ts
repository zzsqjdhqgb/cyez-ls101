/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/ipc/template.ts
import { ipcMain, dialog, app } from 'electron'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getTemplatesPath } from '../utils'
import { getMainWindow } from '../win'
import {
  listTemplates,
  importTemplate,
  exportTemplate,
  deleteTemplate
} from '../services/template-service'
import { getFileFilter, getExtension } from '../../shared/file-types'

ipcMain.handle('template:list', async (_event, devMode?: boolean) => {
  return listTemplates(getTemplatesPath(), devMode)
})

ipcMain.handle('template:import', async () => {
  const win = getMainWindow()
  if (!win) return { success: false, error: '窗口未就绪' }
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '导入模板',
    filters: [getFileFilter('template')],
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return { success: false, error: '已取消' }

  const tempDir = join(app.getPath('temp'), `tmpl-import-${randomUUID()}`)
  try {
    return importTemplate(getTemplatesPath(), filePaths[0], tempDir)
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }
})

ipcMain.handle('template:export', async (_event, templateId: string) => {
  const win = getMainWindow()
  if (!win) return
  try {
    const { buffer, defaultName } = exportTemplate(getTemplatesPath(), templateId)
    const { filePath } = await dialog.showSaveDialog(win, {
      title: '导出模板',
      defaultPath: defaultName.replace(/\.zip$/i, `.${getExtension('template')}`),
      filters: [getFileFilter('template')]
    })
    if (!filePath) return
    writeFileSync(filePath, buffer)
  } catch (err) {
    dialog.showErrorBox('导出失败', String(err))
  }
})

ipcMain.handle('template:delete', async (_event, templateId: string) => {
  return deleteTemplate(getTemplatesPath(), templateId)
})
