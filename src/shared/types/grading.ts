/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/shared/types/grading.ts — 批改领域类型

import type { StudentInfo } from './submission'

export interface GradingScoreEntry {
  gradingInfoId: number
  score: number
  comment: string
}

export type GradingStatus = 'ungraded' | 'grading' | 'completed'

export interface GradingRecord {
  rid: string
  status: GradingStatus
  student: StudentInfo
  examTitle: string
  eid: string
  scores: Record<number, GradingScoreEntry>
  totalScore?: number
  maxScore?: number
  batchId?: string
  gradedAt?: string
  submittedAt?: string
}

export interface GradingBatch {
  batchId: string
  gradedAt: string
  records: GradingRecord[]
}

export interface GradingListItem {
  rid: string
  studentName: string
  studentId: string
  examTitle: string
  status: GradingStatus
  totalScore?: number
  maxScore?: number
  eid: string
  submittedAt?: string
}

export interface SettlementRecord {
  rid: string
  studentName: string
  studentId: string
  examTitle: string
  gradedCount: number
  totalItems: number
  isFullyGraded: boolean
  status: 'canSettle' | 'grading' | 'ungraded'
}
