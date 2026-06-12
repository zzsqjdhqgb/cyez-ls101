/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcMain, app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { importExam } from '../services/exam-service'
import { importTemplate } from '../services/template-service'
import { importSubmissions } from '../services/grading-service'
import { importDraftFromZip } from '../services/draft-service'
import { getExamsPath, getTemplatesPath, getDraftsPath, getGradingPath } from '../utils'
import type { FileType } from '../../shared/file-types'
import { getMainWindow } from '../win'

ipcMain.handle('app:getVersion', () => {
  return app.getVersion()
})

ipcMain.handle('app:importOpenedFile', async (_event, filePath: string, fileType: FileType) => {
  const tempDir = join(app.getPath('temp'), `open-${fileType}-${randomUUID()}`)
  try {
    switch (fileType) {
      case 'exam':
        return importExam(getExamsPath(), filePath, tempDir)
      case 'template':
        return importTemplate(getTemplatesPath(), filePath, tempDir)
      case 'draft':
        return importDraftFromZip(getDraftsPath(), filePath, tempDir)
      case 'submission': {
        const win = getMainWindow()
        const result = importSubmissions(getGradingPath(), filePath, (current, total) => {
          win?.webContents.send('grading:import-progress', { current, total })
        })
        return result
      }
      case 'grading':
        return { success: false, error: '批改记录包暂不支持直接导入' }
      default:
        return { success: false, error: `未知文件类型: ${fileType}` }
    }
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})
