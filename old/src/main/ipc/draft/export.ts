/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/ipc/draft/export.ts
import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureDir, getDraftsPath } from '../../utils'
import { exportExam } from '../../services/draft-service'
import { getFileFilter, getExtension } from '../../../shared/file-types'

export function registerDraftExportHandlers(): void {
  ipcMain.handle('draft:exportExam', async (event, draftId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      return { success: false, error: '无法获取窗口' }
    }

    const tempDir = join(app.getPath('temp'), `export-${randomUUID()}`)
    ensureDir(tempDir)

    try {
      const result = await exportExam(getDraftsPath(), draftId, tempDir, (step, current, total) => {
        win.webContents.send('draft:exportExam-progress', { step, current, total })
      })

      if (!result.success) {
        return result
      }

      if (!result.buffer) {
        return { success: false, error: '导出成功但未生成文件' }
      }

      const { filePath, canceled } = await dialog.showSaveDialog(win, {
        title: '导出渲染后的试卷',
        defaultPath: `试卷.${getExtension('exam')}`,
        filters: [getFileFilter('exam')]
      })
      if (canceled || !filePath) {
        return { success: false, error: '已取消' }
      }

      writeFileSync(filePath, result.buffer)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
}
