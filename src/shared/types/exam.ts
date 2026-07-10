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
  | { type: 'countdown'; seconds: number; focusId?: number; pageRange?: [number, number] }
  | {
      type: 'record'
      duration: number
      recordIndex?: number
      focusId?: number
      pageRange?: [number, number]
    }
  | { type: 'content-controlled'; focusId?: number; pageRange?: [number, number] }

export interface ChoiceQuestion {
  id: number
  stem: string
  options: [string, string, string, string]
  answer: string
}

export interface ChoicePage {
  questions: ChoiceQuestion[]
}

export interface Question {
  id: string
  content: ContentNode[]
  time: TimeControl | TimeControl[]
  statusText?: string
  choicePages?: ChoicePage[]
}

export interface RecordingGradingInfoItem {
  id: number
  recordIndices: number[]
  problemInfo: string
  gradingInfo: string
  fullScore?: number
  scoreOptions?: number[]
}

export interface ChoiceGradingInfoItem {
  choiceId: number
  fullScore: number
  problemInfo?: string
}

export type GradingInfoItem = RecordingGradingInfoItem | ChoiceGradingInfoItem

export interface ExamPackage {
  title: string
  questions: Question[]
  gradingInfo?: GradingInfoItem[]
  choiceOnly?: boolean
}

export interface ExamListItem {
  id: string
  title: string
  questionCount: number
  importedAt: string
}
