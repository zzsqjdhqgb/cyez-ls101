/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/shared/types/draft.ts — 草稿领域类型

import type { EditableDataItem } from './template'

export interface DraftListItem {
  id: string
  templateId: string
  title: string
  updatedAt: string
}

export interface DraftView {
  id: string
  templateId: string
  title: string
  editableItems: EditableDataItem[]
  textValues: Record<string, string>
  fileValues: Record<string, string>
  fileOriginalNames: Record<string, string>
}
