/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/shared/types/template.ts — 模板领域类型

export interface EditableDataItem {
  type: 'text' | 'file'
  id: string
  description: string
  fileName?: string
}

export interface ChunkEntry {
  chunkid: string
  file: string
}

export interface ExamTemplate {
  examData: Record<string, unknown>
  editableData: EditableDataItem[]
  chunks?: ChunkEntry[]
  dev?: boolean
}

export interface TemplateListItem {
  id: string
  title: string
  description?: string
  createdAt: string
  dev?: boolean
}
