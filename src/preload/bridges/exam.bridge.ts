/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcRenderer } from 'electron'
import type { ExamListItem, ExamPackage } from '../../renderer/src/types'

export function createExamBridge(): {
  exam: {
    list: () => Promise<ExamListItem[]>
    load: (examId: string) => Promise<ExamPackage>
    import: () => Promise<{ success: boolean; examId?: string; error?: string }>
    export: (examId: string) => Promise<void>
    delete: (examId: string) => Promise<{ success: boolean }>
  }
} {
  return {
    exam: {
      list: (): Promise<ExamListItem[]> => ipcRenderer.invoke('exam:list'),
      load: (examId: string): Promise<ExamPackage> => ipcRenderer.invoke('exam:load', examId),
      import: (): Promise<{ success: boolean; examId?: string; error?: string }> =>
        ipcRenderer.invoke('exam:import'),
      export: (examId: string): Promise<void> => ipcRenderer.invoke('exam:export', examId),
      delete: (examId: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('exam:delete', examId)
    }
  }
}
