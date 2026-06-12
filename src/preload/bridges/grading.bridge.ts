/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  GradingListItem,
  GradingBatch,
  GradingInfoItem,
  SettlementRecord
} from '../../renderer/src/types'

export function createGradingBridge(): {
  grading: {
    importSubmissions: () => Promise<{
      success: boolean
      imported: number
      skipped: number
      failures: { student: string; reason: string }[]
      error?: string
    }>
    list: (filter?: {
      studentId?: string
      name?: string
      examTitle?: string
    }) => Promise<GradingListItem[]>
    startGrading: (rids: string[]) => Promise<{
      success: boolean
      firstItem: {
        rid: string
        gradingInfoItem: GradingInfoItem
        audioUrls: string[]
        existingScore?: { score: number; comment: string }
      } | null
      ungradedCount: number
      sessionCount: number
      eid: string
      needsSettlement?: boolean
      settlementRids?: string[]
      firstSubmissionUngradedCount?: number
      error?: string
    }>
    submitScore: (
      rid: string,
      gradingInfoId: number,
      score: number,
      comment: string
    ) => Promise<{
      success: boolean
      nextItem: {
        rid: string
        gradingInfoItem: GradingInfoItem
        audioUrls: string[]
        existingScore?: { score: number; comment: string }
      } | null
      settle: boolean
      currentSubmissionUngradedCount?: number
      error?: string
    }>
    pauseGrading: () => Promise<{ success: boolean }>
    finishGrading: () => Promise<{ success: boolean; settlementCount?: number }>
    getSettlementInfo: () => Promise<{ success: boolean; records: SettlementRecord[] }>
    settleNow: () => Promise<{ success: boolean; batchId?: string }>
    settleLater: () => Promise<{ success: boolean }>
    listBatches: () => Promise<GradingBatch[]>
    exportCsv: (batchId: string) => Promise<void>
    exportPdf: (batchId: string) => Promise<{
      success: boolean
      error?: string
      errorCount?: number
      pdfErrors?: { name: string; studentId: string; error: string }[]
    }>
    loadAudio: (rid: string, recordIndex: number) => Promise<string>
    speechToText: (rid: string, recordIndex: number) => Promise<string>
    getGradingHtml: (rid: string) => Promise<{ success: boolean; html?: string; error?: string }>
    onImportProgress: (
      callback: (progress: { current: number; total: number }) => void
    ) => () => void
    onPdfProgress: (
      callback: (progress: { current: number; total: number; step: string }) => void
    ) => () => void
    onPdfError: (
      callback: (error: { name: string; studentId: string; error: string }) => void
    ) => () => void
  }
} {
  return {
    grading: {
      importSubmissions: (): Promise<{
        success: boolean
        imported: number
        skipped: number
        failures: { student: string; reason: string }[]
        error?: string
      }> => ipcRenderer.invoke('grading:importSubmissions'),
      list: (filter?: {
        studentId?: string
        name?: string
        examTitle?: string
      }): Promise<GradingListItem[]> => ipcRenderer.invoke('grading:list', filter),
      startGrading: (
        rids: string[]
      ): Promise<{
        success: boolean
        firstItem: {
          rid: string
          gradingInfoItem: GradingInfoItem
          audioUrls: string[]
          existingScore?: { score: number; comment: string }
        } | null
        ungradedCount: number
        sessionCount: number
        eid: string
        needsSettlement?: boolean
        settlementRids?: string[]
        firstSubmissionUngradedCount?: number
        error?: string
      }> => ipcRenderer.invoke('grading:startGrading', rids),
      submitScore: (
        rid: string,
        gradingInfoId: number,
        score: number,
        comment: string
      ): Promise<{
        success: boolean
        nextItem: {
          rid: string
          gradingInfoItem: GradingInfoItem
          audioUrls: string[]
          existingScore?: { score: number; comment: string }
        } | null
        settle: boolean
        currentSubmissionUngradedCount?: number
        error?: string
      }> => ipcRenderer.invoke('grading:submitScore', rid, gradingInfoId, score, comment),
      pauseGrading: (): Promise<{ success: boolean }> => ipcRenderer.invoke('grading:pauseGrading'),
      finishGrading: (): Promise<{ success: boolean; settlementCount?: number }> =>
        ipcRenderer.invoke('grading:finishGrading'),
      getSettlementInfo: (): Promise<{ success: boolean; records: SettlementRecord[] }> =>
        ipcRenderer.invoke('grading:getSettlementInfo'),
      settleNow: (): Promise<{ success: boolean; batchId?: string }> =>
        ipcRenderer.invoke('grading:settleNow'),
      settleLater: (): Promise<{ success: boolean }> => ipcRenderer.invoke('grading:settleLater'),
      listBatches: (): Promise<GradingBatch[]> => ipcRenderer.invoke('grading:listBatches'),
      exportCsv: (batchId: string): Promise<void> =>
        ipcRenderer.invoke('grading:exportCsv', batchId),
      exportPdf: (
        batchId: string
      ): Promise<{
        success: boolean
        error?: string
        errorCount?: number
        pdfErrors?: { name: string; studentId: string; error: string }[]
      }> => ipcRenderer.invoke('grading:exportPdf', batchId),
      loadAudio: (rid: string, recordIndex: number): Promise<string> =>
        ipcRenderer.invoke('grading:loadAudio', rid, recordIndex),
      speechToText: (rid: string, recordIndex: number): Promise<string> =>
        ipcRenderer.invoke('grading:speechToText', rid, recordIndex),
      getGradingHtml: (rid: string): Promise<{ success: boolean; html?: string; error?: string }> =>
        ipcRenderer.invoke('grading:getGradingHtml', rid),
      onImportProgress: (
        callback: (progress: { current: number; total: number }) => void
      ): (() => void) => {
        const handler = (
          _event: IpcRendererEvent,
          progress: { current: number; total: number }
        ): void => callback(progress)
        ipcRenderer.on('grading:import-progress', handler)
        return () => {
          ipcRenderer.removeListener('grading:import-progress', handler)
        }
      },
      onPdfProgress: (
        callback: (progress: { current: number; total: number; step: string }) => void
      ): (() => void) => {
        const handler = (
          _event: IpcRendererEvent,
          progress: { current: number; total: number; step: string }
        ): void => callback(progress)
        ipcRenderer.on('grading:pdfProgress', handler)
        return () => {
          ipcRenderer.removeListener('grading:pdfProgress', handler)
        }
      },
      onPdfError: (
        callback: (error: { name: string; studentId: string; error: string }) => void
      ): (() => void) => {
        const handler = (
          _event: IpcRendererEvent,
          error: { name: string; studentId: string; error: string }
        ): void => callback(error)
        ipcRenderer.on('grading:pdfError', handler)
        return () => {
          ipcRenderer.removeListener('grading:pdfError', handler)
        }
      }
    }
  }
}
