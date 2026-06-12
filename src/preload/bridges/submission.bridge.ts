/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcRenderer } from 'electron'
import type { StudentInfo, SubmissionItem } from '../../renderer/src/types'

export function createSubmissionBridge(): {
  submission: {
    create: (examId: string, student: StudentInfo) => Promise<string>
    saveRecord: (submissionId: string, recordIndex: number, buffer: ArrayBuffer) => Promise<void>
    list: (filter?: {
      studentId?: string
      name?: string
      examTitle?: string
    }) => Promise<SubmissionItem[]>
    delete: (submissionId: string) => Promise<{ success: boolean }>
    export: (submissionId: string) => Promise<void>
    exportMultiple: (ids: string[]) => Promise<void>
    deleteMultiple: (
      ids: string[]
    ) => Promise<{ success: boolean; deleted: string[]; notFound: string[] }>
  }
} {
  return {
    submission: {
      create: (examId: string, student: StudentInfo): Promise<string> =>
        ipcRenderer.invoke('submission:create', examId, student),
      saveRecord: (submissionId: string, recordIndex: number, buffer: ArrayBuffer): Promise<void> =>
        ipcRenderer.invoke('submission:saveRecord', submissionId, recordIndex, buffer),
      list: (filter?: {
        studentId?: string
        name?: string
        examTitle?: string
      }): Promise<SubmissionItem[]> => ipcRenderer.invoke('submission:list', filter),
      delete: (submissionId: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('submission:delete', submissionId),
      export: (submissionId: string): Promise<void> =>
        ipcRenderer.invoke('submission:export', submissionId),
      exportMultiple: (ids: string[]): Promise<void> =>
        ipcRenderer.invoke('submission:exportMultiple', ids),
      deleteMultiple: (
        ids: string[]
      ): Promise<{ success: boolean; deleted: string[]; notFound: string[] }> =>
        ipcRenderer.invoke('submission:deleteMultiple', ids)
    }
  }
}
