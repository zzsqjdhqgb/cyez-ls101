/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/ipc/exam.ts
import { ipcMain, dialog, app } from 'electron'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getMainWindow } from '../win'
import { getExamsPath } from '../utils'
import { listExams, loadExam, importExam, exportExam, deleteExam } from '../services/exam-service'
import { getFileFilter, getExtension } from '../../shared/file-types'

ipcMain.handle('exam:list', async () => {
  return listExams(getExamsPath())
})

ipcMain.handle('exam:load', async (_event, examId: string) => {
  return loadExam(getExamsPath(), examId)
})

ipcMain.handle('exam:import', async () => {
  const win = getMainWindow()
  if (!win) return { success: false, error: '主窗口未就绪' }
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '导入考试',
    filters: [getFileFilter('exam')],
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return { success: false, error: '已取消' }

  const tempDir = join(app.getPath('temp'), `exam-import-${randomUUID()}`)
  try {
    return importExam(getExamsPath(), filePaths[0], tempDir)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

ipcMain.handle('exam:export', async (_event, examId: string) => {
  const win = getMainWindow()
  if (!win) return
  try {
    const { buffer, defaultName } = exportExam(getExamsPath(), examId)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出考试',
      defaultPath: `${defaultName}.${getExtension('exam')}`,
      filters: [getFileFilter('exam')]
    })
    if (canceled || !filePath) return
    writeFileSync(filePath, buffer)
  } catch (err) {
    dialog.showErrorBox('导出失败', String(err))
  }
})

ipcMain.handle('exam:delete', async (_event, examId: string) => {
  const win = getMainWindow()
  if (!win) return { success: false }
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '确认删除',
    message: '确定要删除该考试吗？所有相关录音也将被删除。',
    buttons: ['取消', '删除'],
    defaultId: 0
  })
  if (response !== 1) return { success: false }
  return deleteExam(getExamsPath(), examId)
})
