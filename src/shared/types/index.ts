/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/shared/types/index.ts — 统一导出所有共享类型

export type {
  ContentNode,
  TimeControl,
  Question,
  GradingInfoItem,
  ExamPackage,
  ExamListItem
} from './exam'

export type { StudentInfo, SubmissionMeta, SubmissionItem } from './submission'

export type { EditableDataItem, ChunkEntry, ExamTemplate, TemplateListItem } from './template'

export type { DraftListItem, DraftView } from './draft'

export type {
  GradingScoreEntry,
  GradingStatus,
  GradingRecord,
  GradingBatch,
  GradingListItem,
  SettlementRecord
} from './grading'
