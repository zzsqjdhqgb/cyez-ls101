/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/shared/types/exam.ts — 考试领域类型

export type ContentNode =
  | { type: 'text'; text: string; bold?: boolean; size?: 'small' | 'normal' | 'large' }
  | { type: 'image'; src: string; width?: string; height?: string }
  | { type: 'video'; src: string }
  | { type: 'audio'; src: string; text: string }
  | { type: 'quad-image'; images: [string, string, string, string]; width?: string }

export type TimeControl =
  | { type: 'countdown'; seconds: number }
  | { type: 'record'; duration: number; recordIndex?: number }
  | { type: 'content-controlled' }

export interface Question {
  id: string
  content: ContentNode[]
  time: TimeControl
  statusText?: string
}

export interface GradingInfoItem {
  id: number
  recordIndices: number[]
  problemInfo: string
  gradingInfo: string
  fullScore?: number
  scoreOptions?: number[]
}

export interface ExamPackage {
  title: string
  questions: Question[]
  gradingInfo?: GradingInfoItem[]
}

export interface ExamListItem {
  id: string
  title: string
  questionCount: number
  importedAt: string
}
