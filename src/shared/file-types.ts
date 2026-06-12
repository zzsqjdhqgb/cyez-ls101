/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

export interface FileTypeConfig {
  extension: string
  description: string
  filterName: string
  mimeType: string
}

export const FILE_TYPES = {
  exam: {
    extension: 'cyexam',
    description: 'CYEZ 考试包',
    filterName: 'CYEZ 考试包',
    mimeType: 'application/x-cyez-exam'
  },
  template: {
    extension: 'cytmpl',
    description: 'CYEZ 模板包',
    filterName: 'CYEZ 模板包',
    mimeType: 'application/x-cyez-template'
  },
  draft: {
    extension: 'cydraft',
    description: 'CYEZ 草稿包',
    filterName: 'CYEZ 草稿包',
    mimeType: 'application/x-cyez-draft'
  },
  submission: {
    extension: 'cysubm',
    description: 'CYEZ 作答包',
    filterName: 'CYEZ 作答包',
    mimeType: 'application/x-cyez-submission'
  },
  grading: {
    extension: 'cygrade',
    description: 'CYEZ 批改记录包',
    filterName: 'CYEZ 批改记录包',
    mimeType: 'application/x-cyez-grading'
  }
} as const satisfies Record<string, FileTypeConfig>

export type FileType = keyof typeof FILE_TYPES

export interface PendingOpenFile {
  path: string
  type: FileType
}

export function getFileFilter(type: FileType): { name: string; extensions: string[] } {
  const config = FILE_TYPES[type]
  return {
    name: `${config.filterName} (*.${config.extension})`,
    extensions: [config.extension]
  }
}

export function getExtension(type: FileType): string {
  return FILE_TYPES[type].extension
}

export function getTypeByExtension(ext: string): FileType | null {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  for (const [key, config] of Object.entries(FILE_TYPES)) {
    if (config.extension === normalized) return key as FileType
  }
  return null
}
