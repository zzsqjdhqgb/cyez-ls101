/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/preload/index.d.ts
import type {
  ExamPackage,
  ExamListItem,
  StudentInfo,
  SubmissionItem,
  TemplateListItem,
  DraftListItem,
  DraftView,
  GradingListItem,
  GradingBatch,
  GradingInfoItem,
  SettlementRecord
} from '../renderer/src/types'
import type { PendingOpenFile, FileType } from '../shared/file-types'

declare global {
  interface Window {
    electronAPI: {
      exam: {
        list: () => Promise<ExamListItem[]>
        load: (examId: string) => Promise<ExamPackage>
        import: () => Promise<{ success: boolean; examId?: string; error?: string }>
        export: (examId: string) => Promise<void>
        delete: (examId: string) => Promise<{ success: boolean }>
      }
      submission: {
        create: (examId: string, student: StudentInfo) => Promise<string>
        saveRecord: (
          submissionId: string,
          recordIndex: number,
          buffer: ArrayBuffer
        ) => Promise<void>
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
      template: {
        list: (devMode?: boolean) => Promise<TemplateListItem[]>
        import: () => Promise<{ success: boolean; error?: string }>
        export: (templateId: string) => Promise<void>
        delete: (templateId: string) => Promise<{ success: boolean }>
      }
      draft: {
        create: (templateId: string) => Promise<string>
        list: () => Promise<DraftListItem[]>
        load: (draftId: string) => Promise<DraftView>
        updateText: (draftId: string, id: string, value: string) => Promise<void>
        updateTitle: (draftId: string, title: string) => Promise<void>
        uploadFile: (draftId: string, id: string) => Promise<void>
        uploadClipboardImage: (
          draftId: string,
          id: string,
          data: string,
          ext: string
        ) => Promise<void>
        removeFile: (draftId: string, id: string) => Promise<void>
        delete: (draftId: string) => Promise<{ success: boolean }>
        exportExam: (draftId: string) => Promise<{ success: boolean; error?: string }>
        importDraft: () => Promise<void>
        exportDraft: (draftId: string) => Promise<void>
        onExportProgress: (
          callback: (progress: { step: string; current: number; total: number }) => void
        ) => () => void
      }
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
        getGradingHtml: (
          rid: string
        ) => Promise<{ success: boolean; html?: string; error?: string }>
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
      dev: {
        isDev: () => Promise<boolean>
        resetData: () => Promise<void>
        openDataFolder: () => Promise<void>
        setDevToolsEnabled: (enabled: boolean) => Promise<void>
        removeFileAssociations: () => Promise<boolean>
        resetFileAssociationCache: () => Promise<boolean>
        getResetFailedPaths: () => Promise<string[]>
        confirmHardReset: () => Promise<void>
        checkUpdateNotification: () => Promise<{
          previousVersion: string
          currentVersion: string
        } | null>
        checkResetRequired: () => Promise<boolean>
      }
      app: {
        getVersion: () => Promise<string>
        getPendingOpenFile: () => Promise<PendingOpenFile | null>
        onOpenFile: (callback: (file: PendingOpenFile) => void) => () => void
        importOpenedFile: (
          filePath: string,
          fileType: FileType
        ) => Promise<{ success: boolean; error?: string }>
      }
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
      }
      license: {
        isExpired: () => Promise<boolean>
        validateCode: (code: string) => Promise<boolean>
        activate: (code: string) => Promise<void>
        hasStoredLicense: () => Promise<boolean>
        verifyStored: (code: string) => Promise<boolean>
      }
    }
  }
}
