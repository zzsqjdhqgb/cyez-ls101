/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/shared/types/submission.ts — 作答领域类型

export interface StudentInfo {
  name: string
  studentId: string
}

export interface SubmissionMeta {
  student: StudentInfo
  examId: string
  submittedAt: string
}

export interface SubmissionItem {
  id: string
  student: StudentInfo
  examTitle: string
  submittedAt: string
  recordingCount: number
}
