/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/ipc/submission.ts
import { ipcMain, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import type { StudentInfo } from '../../shared/types'
import { getMainWindow } from '../win'
import { getExamsPath, getSubmissionsPath } from '../utils'
import {
  createSubmission,
  saveRecord,
  listSubmissions,
  deleteSubmission,
  exportSubmission,
  exportMultipleSubmissions,
  deleteMultipleSubmissions
} from '../services/submission-service'
import { getFileFilter, getExtension } from '../../shared/file-types'

ipcMain.handle('submission:create', async (_event, examId: string, student: StudentInfo) => {
  return createSubmission(getExamsPath(), getSubmissionsPath(), examId, student)
})

ipcMain.handle(
  'submission:saveRecord',
  async (_event, submissionId: string, recordIndex: number, buffer: ArrayBuffer) => {
    saveRecord(getSubmissionsPath(), submissionId, recordIndex, buffer)
  }
)

ipcMain.handle(
  'submission:list',
  async (_event, filter?: { studentId?: string; name?: string; examTitle?: string }) => {
    return listSubmissions(getExamsPath(), getSubmissionsPath(), filter)
  }
)

ipcMain.handle('submission:delete', async (_event, submissionId: string) => {
  return deleteSubmission(getSubmissionsPath(), submissionId)
})

ipcMain.handle('submission:export', async (_event, submissionId: string) => {
  const win = getMainWindow()
  if (!win) return
  try {
    const { buffer, defaultName } = exportSubmission(getSubmissionsPath(), submissionId)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出作答包',
      defaultPath: defaultName.replace(/\.zip$/i, `.${getExtension('submission')}`),
      filters: [getFileFilter('submission')]
    })
    if (canceled || !filePath) return
    writeFileSync(filePath, buffer)
  } catch (err) {
    dialog.showErrorBox('导出失败', String(err))
  }
})

ipcMain.handle('submission:exportMultiple', async (_event, submissionIds: string[]) => {
  const win = getMainWindow()
  if (!win) return
  try {
    const { buffer, defaultName } = exportMultipleSubmissions(getSubmissionsPath(), submissionIds)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '批量导出作答包',
      defaultPath: defaultName.replace(/\.zip$/i, `.${getExtension('submission')}`),
      filters: [getFileFilter('submission')]
    })
    if (canceled || !filePath) return
    writeFileSync(filePath, buffer)
  } catch (err) {
    dialog.showErrorBox('导出失败', String(err))
  }
})

ipcMain.handle('submission:deleteMultiple', async (_event, submissionIds: string[]) => {
  return deleteMultipleSubmissions(getSubmissionsPath(), submissionIds)
})
