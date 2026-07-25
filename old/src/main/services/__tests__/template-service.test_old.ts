/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { validateTemplate, loadMergedTemplate } from '../template-service'
import type { ExamTemplate } from '../../../shared/types'

describe('validateTemplate', () => {
  describe('placeholder validation', () => {
    it('detects referenced placeholder not in editableData', () => {
      const template: ExamTemplate = {
        examData: { title: '{{missingId}}' },
        editableData: []
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.some((e) => e.includes('占位符 missingId 被引用但未在可编辑数据中定义'))).toBe(
        true
      )
    })

    it('detects editableData item not referenced by any placeholder', () => {
      const template: ExamTemplate = {
        examData: { title: 'No Placeholders Here' },
        editableData: [{ type: 'text', id: 'unused', description: 'Unused' }]
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.some((e) => e.includes('可编辑数据项 unused 未被任何占位符引用'))).toBe(true)
    })

    it('accepts valid placeholder references', () => {
      const template: ExamTemplate = {
        examData: { title: '{{validId}}', text: 'Some {{validId}} content' },
        editableData: [{ type: 'text', id: 'validId', description: 'Valid' }]
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.filter((e) => e.includes('占位符') || e.includes('未被')).length).toBe(0)
    })
  })

  describe('duplicate id detection', () => {
    it('detects duplicate editableData ids', () => {
      const template: ExamTemplate = {
        examData: { title: '{{dup}}' },
        editableData: [
          { type: 'text', id: 'dup', description: 'First' },
          { type: 'text', id: 'dup', description: 'Second' }
        ]
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.some((e) => e.includes('可编辑数据 id 重复: dup'))).toBe(true)
    })
  })

  describe('file path validation', () => {
    it('rejects file path without media/ prefix', () => {
      const template: ExamTemplate = {
        examData: { title: '{{file1}}', questions: [{ type: 'image', src: 'bad/path.png' }] },
        editableData: [{ type: 'file', id: 'file1', description: 'File', fileName: 'bad/path.png' }]
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.some((e) => e.includes('文件路径不合法'))).toBe(true)
    })

    it('rejects file path with .. traversal', () => {
      const template: ExamTemplate = {
        examData: {
          title: '{{file1}}',
          questions: [{ type: 'image', src: 'media/../secret.png' }]
        },
        editableData: [
          { type: 'file', id: 'file1', description: 'File', fileName: 'media/../secret.png' }
        ]
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.some((e) => e.includes('文件路径不合法'))).toBe(true)
    })

    it('accepts valid media/ path', () => {
      const template: ExamTemplate = {
        examData: { title: '{{file1}}', questions: [{ type: 'image', src: 'media/photo.png' }] },
        editableData: [
          { type: 'file', id: 'file1', description: 'File', fileName: 'media/photo.png' }
        ]
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.filter((e) => e.includes('文件路径不合法')).length).toBe(0)
    })

    it('detects file reference not in template files', () => {
      const template: ExamTemplate = {
        examData: { questions: [{ type: 'image', src: 'media/missing.png' }] },
        editableData: []
      }
      const errors = validateTemplate(template, new Set())
      expect(
        errors.some((e) => e.includes('题目数据引用的文件 media/missing.png 未在模板中定义'))
      ).toBe(true)
    })

    it('detects defined file not referenced in exam data', () => {
      const template: ExamTemplate = {
        examData: {},
        editableData: [
          { type: 'file', id: 'file1', description: 'File', fileName: 'media/unused.png' }
        ]
      }
      const existingFiles = new Set<string>(['media/unused.png'])
      const errors = validateTemplate(template, existingFiles)
      expect(errors.some((e) => e.includes('未被题目数据引用'))).toBe(true)
    })
  })

  describe('audio node validation', () => {
    it('detects audio node without text', () => {
      const template: ExamTemplate = {
        examData: { questions: [{ type: 'audio', src: 'media/test.wav' }] },
        editableData: []
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.some((e) => e.includes('音频节点缺少 text 属性'))).toBe(true)
    })

    it('detects audio node with empty src', () => {
      const template: ExamTemplate = {
        examData: { questions: [{ type: 'audio', text: 'hello', src: '' }] },
        editableData: []
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.some((e) => e.includes('音频节点的 src 不能为空'))).toBe(true)
    })

    it('accepts audio node with both text and src', () => {
      const template: ExamTemplate = {
        examData: { questions: [{ type: 'audio', text: 'hello', src: 'media/test.wav' }] },
        editableData: []
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.filter((e) => e.includes('音频')).length).toBe(0)
    })
  })

  describe('deep string search', () => {
    it('finds placeholders in nested objects', () => {
      const template: ExamTemplate = {
        examData: {
          questions: [
            {
              content: [{ type: 'text', text: 'Hello {{name}}' }]
            }
          ]
        },
        editableData: [{ type: 'text', id: 'name', description: 'Name' }]
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.length).toBe(0)
    })

    it('finds placeholders in arrays', () => {
      const template: ExamTemplate = {
        examData: {
          items: ['{{item1}}', '{{item2}}']
        },
        editableData: [
          { type: 'text', id: 'item1', description: 'Item 1' },
          { type: 'text', id: 'item2', description: 'Item 2' }
        ]
      }
      const errors = validateTemplate(template, new Set())
      expect(errors.length).toBe(0)
    })
  })

  describe('fileName conflict', () => {
    it('detects fileName conflict with existing files', () => {
      const template: ExamTemplate = {
        examData: { title: '{{file1}}', questions: [{ type: 'image', src: 'media/photo.png' }] },
        editableData: [
          { type: 'file', id: 'file1', description: 'File', fileName: 'media/photo.png' }
        ]
      }
      const existingFiles = new Set(['media/photo.png'])
      const errors = validateTemplate(template, existingFiles)
      expect(errors.some((e) => e.includes('文件名冲突: media/photo.png'))).toBe(true)
    })
  })
})

function makeTempDir(): string {
  const dir = join(tmpdir(), `template-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function makeTemplate(
  dir: string,
  data: {
    examData?: Record<string, unknown>
    editableData?: unknown[]
    chunks?: unknown[]
  } = {}
): void {
  writeFileSync(
    join(dir, 'template.json'),
    JSON.stringify(
      {
        examData: data.examData ?? {},
        editableData: data.editableData ?? [],
        ...(data.chunks ? { chunks: data.chunks } : {})
      },
      null,
      2
    )
  )
}

describe('loadMergedTemplate', () => {
  it('returns template as-is when no chunks', () => {
    const dir = makeTempDir()
    try {
      makeTemplate(dir, {
        examData: { title: 'Test', questions: [{ id: '1', content: [] }] },
        editableData: [{ type: 'text', id: 't1', description: 'Desc' }]
      })
      const { template, errors } = loadMergedTemplate(dir)
      expect(errors).toHaveLength(0)
      expect((template.examData as Record<string, unknown>).title).toBe('Test')
      expect(template.editableData).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merges questions from chunk', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: {
          title: 'Exam',
          questions: [{ id: 'q1', content: [{ type: 'text', text: 'hello' }] }]
        },
        editableData: [],
        chunks: [{ chunkid: '01', file: 'chunk/extra.json' }]
      })
      writeFileSync(
        join(dir, 'chunk/extra.json'),
        JSON.stringify({
          examData: { questions: [{ id: 'q2', content: [{ type: 'text', text: 'world' }] }] },
          editableData: []
        })
      )
      const { template, errors } = loadMergedTemplate(dir)
      expect(errors).toHaveLength(0)
      const questions = (template.examData as Record<string, unknown>).questions as Record<
        string,
        unknown
      >[]
      expect(questions).toHaveLength(2)
      expect(questions.map((q) => q.id)).toEqual(['q1', 'q2'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merges editableData from chunk', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: { title: 'Exam' },
        editableData: [{ type: 'text', id: 'main_item', description: 'Main' }],
        chunks: [{ chunkid: '01', file: 'chunk/extra.json' }]
      })
      writeFileSync(
        join(dir, 'chunk/extra.json'),
        JSON.stringify({
          examData: {},
          editableData: [{ type: 'text', id: 'chunk_item', description: 'Chunk' }]
        })
      )
      const { template, errors } = loadMergedTemplate(dir)
      expect(errors).toHaveLength(0)
      expect(template.editableData).toHaveLength(2)
      expect(template.editableData.map((e) => e.id)).toEqual(['main_item', 'chunk_item'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merges gradingInfo from chunk', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: {
          title: 'Exam',
          questions: [],
          gradingInfo: [
            { id: 0, recordIndices: [1], problemInfo: 'p1', gradingInfo: 'g1', fullScore: 5 }
          ]
        },
        editableData: [],
        chunks: [{ chunkid: '01', file: 'chunk/extra.json' }]
      })
      writeFileSync(
        join(dir, 'chunk/extra.json'),
        JSON.stringify({
          examData: {
            gradingInfo: [
              { id: 1, recordIndices: [2], problemInfo: 'p2', gradingInfo: 'g2', fullScore: 10 }
            ]
          },
          editableData: []
        })
      )
      const { template, errors } = loadMergedTemplate(dir)
      expect(errors).toHaveLength(0)
      const gradingInfo = (template.examData as Record<string, unknown>).gradingInfo as Record<
        string,
        unknown
      >[]
      expect(gradingInfo).toHaveLength(2)
      expect(gradingInfo.map((g) => g.id)).toEqual([0, 1])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports question id conflict', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: { title: 'Exam', questions: [{ id: 'q1', content: [] }] },
        editableData: [],
        chunks: [{ chunkid: '01', file: 'chunk/conflict.json' }]
      })
      writeFileSync(
        join(dir, 'chunk/conflict.json'),
        JSON.stringify({
          examData: { questions: [{ id: 'q1', content: [{ type: 'text', text: 'dup' }] }] },
          editableData: []
        })
      )
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('q1') && e.includes('冲突'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports editableData id conflict', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: { title: 'Exam' },
        editableData: [{ type: 'text', id: 'same_id', description: 'Main' }],
        chunks: [{ chunkid: '01', file: 'chunk/conflict.json' }]
      })
      writeFileSync(
        join(dir, 'chunk/conflict.json'),
        JSON.stringify({
          examData: {},
          editableData: [{ type: 'text', id: 'same_id', description: 'Chunk' }]
        })
      )
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('same_id') && e.includes('冲突'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports gradingInfo id conflict', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: {
          title: 'Exam',
          gradingInfo: [{ id: 0, recordIndices: [1], problemInfo: 'p', gradingInfo: 'g', fullScore: 5 }]
        },
        editableData: [],
        chunks: [{ chunkid: '01', file: 'chunk/conflict.json' }]
      })
      writeFileSync(
        join(dir, 'chunk/conflict.json'),
        JSON.stringify({
          examData: {
            gradingInfo: [
              { id: 0, recordIndices: [2], problemInfo: 'p2', gradingInfo: 'g2', fullScore: 10 }
            ]
          },
          editableData: []
        })
      )
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('0') && e.includes('冲突'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports non-array field conflict (title)', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: { title: 'Main Title' },
        editableData: [],
        chunks: [{ chunkid: '01', file: 'chunk/conflict.json' }]
      })
      writeFileSync(
        join(dir, 'chunk/conflict.json'),
        JSON.stringify({
          examData: { title: 'Chunk Title' },
          editableData: []
        })
      )
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('title') && e.includes('冲突'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('allows non-array field defined only in chunk', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: { title: 'Exam' },
        editableData: [],
        chunks: [{ chunkid: '01', file: 'chunk/extra.json' }]
      })
      writeFileSync(
        join(dir, 'chunk/extra.json'),
        JSON.stringify({
          examData: { instructions: 'Read carefully' },
          editableData: []
        })
      )
      const { template, errors } = loadMergedTemplate(dir)
      expect(errors).toHaveLength(0)
      expect((template.examData as Record<string, unknown>).instructions).toBe('Read carefully')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports chunk file not found', () => {
    const dir = makeTempDir()
    try {
      makeTemplate(dir, {
        examData: { title: 'Exam' },
        editableData: [],
        chunks: [{ chunkid: '01', file: 'chunk/missing.json' }]
      })
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('不存在'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports chunk file with chunks property', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: { title: 'Exam' },
        editableData: [],
        chunks: [{ chunkid: '01', file: 'chunk/bad.json' }]
      })
      writeFileSync(
        join(dir, 'chunk/bad.json'),
        JSON.stringify({
          examData: {},
          editableData: [],
          chunks: [{ chunkid: 'x', file: 'chunk/nested.json' }]
        })
      )
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('不允许包含 chunks'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports chunk file with invalid JSON', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: { title: 'Exam' },
        editableData: [],
        chunks: [{ chunkid: '01', file: 'chunk/bad.json' }]
      })
      writeFileSync(join(dir, 'chunk/bad.json'), '{invalid json')
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('解析失败'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merges chunks in chunkid order', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: { title: 'Exam', questions: [{ id: 'main', content: [] }] },
        editableData: [],
        chunks: [
          { chunkid: '02', file: 'chunk/second.json' },
          { chunkid: '01', file: 'chunk/first.json' },
          { chunkid: '03', file: 'chunk/third.json' }
        ]
      })
      writeFileSync(
        join(dir, 'chunk/first.json'),
        JSON.stringify({
          examData: { questions: [{ id: 'chunk1', content: [] }] },
          editableData: []
        })
      )
      writeFileSync(
        join(dir, 'chunk/second.json'),
        JSON.stringify({
          examData: { questions: [{ id: 'chunk2', content: [] }] },
          editableData: []
        })
      )
      writeFileSync(
        join(dir, 'chunk/third.json'),
        JSON.stringify({
          examData: { questions: [{ id: 'chunk3', content: [] }] },
          editableData: []
        })
      )
      const { template, errors } = loadMergedTemplate(dir)
      expect(errors).toHaveLength(0)
      const questions = (template.examData as Record<string, unknown>).questions as Record<
        string,
        unknown
      >[]
      expect(questions.map((q) => q.id)).toEqual(['main', 'chunk1', 'chunk2', 'chunk3'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports missing template.json', () => {
    const dir = makeTempDir()
    try {
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('未找到 template.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports invalid chunk path outside chunk/', () => {
    const dir = makeTempDir()
    try {
      makeTemplate(dir, {
        examData: { title: 'Exam' },
        editableData: [],
        chunks: [{ chunkid: '01', file: '../evil.json' }]
      })
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('路径不合法'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports duplicate chunkid', () => {
    const dir = makeTempDir()
    try {
      mkdirSync(join(dir, 'chunk'))
      makeTemplate(dir, {
        examData: { title: 'Exam' },
        editableData: [],
        chunks: [
          { chunkid: 'dup', file: 'chunk/a.json' },
          { chunkid: 'dup', file: 'chunk/b.json' }
        ]
      })
      writeFileSync(join(dir, 'chunk/a.json'), JSON.stringify({ examData: {}, editableData: [] }))
      writeFileSync(join(dir, 'chunk/b.json'), JSON.stringify({ examData: {}, editableData: [] }))
      const { errors } = loadMergedTemplate(dir)
      expect(errors.some((e) => e.includes('chunkid 重复'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
