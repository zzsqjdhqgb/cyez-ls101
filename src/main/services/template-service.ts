/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/services/template-service.ts
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import type { ExamTemplate, ChunkEntry } from '../../shared/types'
import { ensureDir, copyDirRecursive } from '../utils'

function isValidMediaPathFormat(p: string): boolean {
  const normalized = p.replace(/\\/g, '/')
  return (
    normalized.startsWith('media/') && !normalized.includes('..') && !normalized.startsWith('/')
  )
}

function isValidChunkPath(p: string): boolean {
  const normalized = p.replace(/\\/g, '/')
  return (
    normalized.startsWith('chunk/') && !normalized.includes('..') && !normalized.startsWith('/')
  )
}

export function validateChunks(
  template: ExamTemplate,
  dirPath: string,
  errors: string[]
): ChunkEntry[] {
  const validChunks: ChunkEntry[] = []
  const seenChunkIds = new Set<string>()

  for (const chunk of template.chunks || []) {
    if (!chunk.chunkid || !chunk.file) {
      errors.push(`chunk 条目缺少 chunkid 或 file`)
      continue
    }
    if (seenChunkIds.has(chunk.chunkid)) {
      errors.push(`chunkid 重复: ${chunk.chunkid}`)
      continue
    }
    seenChunkIds.add(chunk.chunkid)
    if (!isValidChunkPath(chunk.file)) {
      errors.push(`chunk 文件路径不合法: ${chunk.file}`)
      continue
    }
    const fullPath = join(dirPath, chunk.file)
    if (!existsSync(fullPath)) {
      errors.push(`chunk 文件不存在: ${chunk.file}`)
      continue
    }
    validChunks.push(chunk)
  }

  return validChunks
}

export function loadMergedTemplate(dirPath: string): {
  template: ExamTemplate
  errors: string[]
} {
  const errors: string[] = []
  const mainPath = join(dirPath, 'template.json')
  if (!existsSync(mainPath)) {
    return { template: { examData: {}, editableData: [] }, errors: ['未找到 template.json'] }
  }

  let mainTemplate: ExamTemplate
  try {
    mainTemplate = JSON.parse(readFileSync(mainPath, 'utf-8'))
  } catch {
    return { template: { examData: {}, editableData: [] }, errors: ['template.json 解析失败'] }
  }

  const chunks = mainTemplate.chunks
  if (!chunks || chunks.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { chunks: _, ...clean } = mainTemplate
    return { template: clean, errors }
  }

  const validChunks = validateChunks(mainTemplate, dirPath, errors)
  if (validChunks.length === 0 && chunks.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { chunks: _, ...clean } = mainTemplate
    return { template: clean, errors }
  }

  const sortedChunks = [...validChunks].sort((a, b) => a.chunkid.localeCompare(b.chunkid))
  const merged = mergeChunks(mainTemplate, sortedChunks, dirPath, errors)

  return { template: merged, errors }
}

function mergeChunks(
  base: ExamTemplate,
  chunks: ChunkEntry[],
  dirPath: string,
  errors: string[]
): ExamTemplate {
  const bExamData = base.examData as Record<string, unknown>
  const baseQuestions = (bExamData.questions as Record<string, unknown>[]) || []
  const baseGradingInfo = (bExamData.gradingInfo as Record<string, unknown>[]) || []
  const baseEditableData = base.editableData || []
  const baseExamDataKeys = new Set(Object.keys(bExamData))

  const mergedQuestions = [...baseQuestions.map(deepClone)]
  const mergedGradingInfo = [...baseGradingInfo.map(deepClone)]
  const mergedEditableData = baseEditableData.map((e) => ({ ...e }))
  const mergedExamDataExtra: Record<string, unknown> = {}
  for (const key of baseExamDataKeys) {
    if (key !== 'questions' && key !== 'gradingInfo') {
      mergedExamDataExtra[key] = deepClone(bExamData[key])
    }
  }

  const questionIds = new Set<string>(baseQuestions.map((q) => String(q.id)))
  const gradingInfoIds = new Set<number>(
    baseGradingInfo.map((g) => Number((g as Record<string, unknown>).id))
  )
  const editableIds = new Set<string>(baseEditableData.map((e) => e.id))

  for (const chunk of chunks) {
    let chunkData: ExamTemplate
    const chunkPath = join(dirPath, chunk.file)
    try {
      chunkData = JSON.parse(readFileSync(chunkPath, 'utf-8'))
    } catch {
      errors.push(`chunk ${chunk.chunkid}: 文件解析失败`)
      continue
    }

    if (chunkData.chunks) {
      errors.push(`chunk ${chunk.chunkid}: 子模板不允许包含 chunks 属性`)
    }

    const cExamData = chunkData.examData as Record<string, unknown> | undefined
    const chunkQuestions = (cExamData?.questions as Record<string, unknown>[]) || []
    const chunkGradingInfo = (cExamData?.gradingInfo as Record<string, unknown>[]) || []
    const chunkEditableData = chunkData.editableData || []

    for (const q of chunkQuestions) {
      const qId = String(q.id)
      if (questionIds.has(qId)) {
        errors.push(`chunk ${chunk.chunkid}: question id "${qId}" 与已有题目冲突`)
      } else {
        questionIds.add(qId)
        mergedQuestions.push(deepClone(q) as Record<string, unknown>)
      }
    }

    for (const g of chunkGradingInfo) {
      const gId = Number((g as Record<string, unknown>).id)
      if (gradingInfoIds.has(gId)) {
        errors.push(`chunk ${chunk.chunkid}: gradingInfo id ${gId} 与已有评分项冲突`)
      } else {
        gradingInfoIds.add(gId)
        mergedGradingInfo.push(deepClone(g) as Record<string, unknown>)
      }
    }

    for (const e of chunkEditableData) {
      if (editableIds.has(e.id)) {
        errors.push(`chunk ${chunk.chunkid}: editableData id "${e.id}" 与已有可编辑项冲突`)
      } else {
        editableIds.add(e.id)
        mergedEditableData.push({ ...e })
      }
    }

    if (cExamData) {
      for (const key of Object.keys(cExamData)) {
        if (key === 'questions' || key === 'gradingInfo') continue
        if (key in mergedExamDataExtra) {
          const baseVal = mergedExamDataExtra[key]
          const chunkVal = cExamData[key]
          if (JSON.stringify(baseVal) !== JSON.stringify(chunkVal)) {
            errors.push(`chunk ${chunk.chunkid}: examData.${key} 与主模板定义冲突`)
          }
        } else {
          mergedExamDataExtra[key] = deepClone(cExamData[key])
        }
      }
    }
  }

  const mergedExamData: Record<string, unknown> = {
    ...mergedExamDataExtra,
    questions: mergedQuestions
  }
  if (mergedGradingInfo.length > 0) {
    mergedExamData.gradingInfo = mergedGradingInfo
  }

  const result: ExamTemplate = {
    examData: mergedExamData,
    editableData: mergedEditableData
  }
  if ('dev' in base) {
    result.dev = base.dev
  }
  return result
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function validateTemplate(template: ExamTemplate, existingFiles: Set<string>): string[] {
  const errors: string[] = []

  const allIds = new Set<string>()
  const fileNames = new Set<string>(existingFiles)

  for (const item of template.editableData) {
    if (allIds.has(item.id)) errors.push(`可编辑数据 id 重复: ${item.id}`)
    allIds.add(item.id)
    if (item.type === 'file' && item.fileName) {
      if (!isValidMediaPathFormat(item.fileName)) {
        errors.push(`文件路径不合法: ${item.fileName}`)
      }
      if (fileNames.has(item.fileName)) errors.push(`文件名冲突: ${item.fileName}`)
      fileNames.add(item.fileName)
    }
  }

  const referencedPlaceholders = new Set<string>()
  const findPlaceholders = (text: string): void => {
    const regex = /\{\{([^}]+)\}\}/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      referencedPlaceholders.add(match[1])
    }
  }

  const deepSearchStrings = (obj: unknown): void => {
    if (typeof obj === 'string') {
      findPlaceholders(obj)
    } else if (Array.isArray(obj)) {
      for (const item of obj) deepSearchStrings(item)
    } else if (obj && typeof obj === 'object') {
      for (const val of Object.values(obj as Record<string, unknown>)) deepSearchStrings(val)
    }
  }
  deepSearchStrings(template.examData)

  const editableIds = new Set(template.editableData.map((e) => e.id))
  for (const id of referencedPlaceholders) {
    if (!editableIds.has(id)) errors.push(`占位符 ${id} 被引用但未在可编辑数据中定义`)
  }
  for (const id of editableIds) {
    if (!referencedPlaceholders.has(id)) errors.push(`可编辑数据项 ${id} 未被任何占位符引用`)
  }

  const allDefinedFiles = new Set<string>(existingFiles)
  for (const item of template.editableData) {
    if (item.type === 'file' && item.fileName) allDefinedFiles.add(item.fileName)
  }

  const referencedFiles = new Set<string>()
  const collectSrc = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach(collectSrc)
      return
    }
    const record = obj as Record<string, unknown>
    if (record.type !== 'audio') {
      if (typeof record.src === 'string') referencedFiles.add(record.src)
      if (Array.isArray(record.images)) {
        for (const img of record.images) {
          if (typeof img === 'string') referencedFiles.add(img)
        }
      }
    }
    for (const val of Object.values(record)) collectSrc(val)
  }
  collectSrc(template.examData)

  for (const file of referencedFiles) {
    if (!isValidMediaPathFormat(file)) errors.push(`题目数据引用的文件路径不合法: ${file}`)
    if (!allDefinedFiles.has(file)) errors.push(`题目数据引用的文件 ${file} 未在模板中定义`)
  }
  for (const file of allDefinedFiles) {
    if (!isValidMediaPathFormat(file)) errors.push(`模板中定义的文件路径不合法: ${file}`)
    if (!referencedFiles.has(file)) errors.push(`模板中的文件 ${file} 未被题目数据引用`)
  }

  const checkAudioNode = (obj: unknown): void => {
    if (Array.isArray(obj)) {
      obj.forEach(checkAudioNode)
      return
    }
    if (obj && typeof obj === 'object') {
      const record = obj as Record<string, unknown>
      if (record.type === 'audio') {
        if (typeof record.text !== 'string') {
          errors.push('音频节点缺少 text 属性')
        }
        if (typeof record.src !== 'string' || (record.src as string).trim().length === 0) {
          errors.push('音频节点的 src 不能为空')
        }
      }
      for (const val of Object.values(record)) checkAudioNode(val)
    }
  }
  checkAudioNode(template.examData)

  return errors
}

interface TemplateInfo {
  id: string
  title: string
  description?: string
  createdAt: string
  dev?: boolean
}

export function listTemplates(templatesPath: string, devMode?: boolean): TemplateInfo[] {
  if (!existsSync(templatesPath)) return []
  const entries = readdirSync(templatesPath, { withFileTypes: true }).filter((e) => e.isDirectory())
  const list: TemplateInfo[] = []
  for (const entry of entries) {
    const jsonPath = join(templatesPath, entry.name, 'template.json')
    if (!existsSync(jsonPath)) continue
    try {
      const { template } = loadMergedTemplate(join(templatesPath, entry.name))
      const title = (template.examData as Record<string, unknown>)?.title || '未命名模板'
      if (template.dev && !devMode) {
        continue
      }
      const stat = statSync(join(templatesPath, entry.name))
      list.push({
        id: entry.name,
        title: String(title),
        description: undefined,
        createdAt: stat.mtime.toISOString(),
        dev: template.dev || undefined
      })
    } catch {
      /* skip */
    }
  }
  return list
}

export function importTemplate(
  templatesPath: string,
  zipPath: string,
  tempDir: string
): { success: boolean; error?: string } {
  try {
    ensureDir(tempDir)
    new AdmZip(zipPath).extractAllTo(tempDir, true)

    let tmplDir = tempDir
    if (!existsSync(join(tempDir, 'template.json'))) {
      const subs = readdirSync(tempDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      if (subs.length === 1 && existsSync(join(tempDir, subs[0].name, 'template.json'))) {
        tmplDir = join(tempDir, subs[0].name)
      }
    }

    const jsonPath = join(tmplDir, 'template.json')
    if (!existsSync(jsonPath)) {
      rmSync(tempDir, { recursive: true, force: true })
      return { success: false, error: '未找到 template.json' }
    }

    const { template: mergedTemplate, errors: mergeErrors } = loadMergedTemplate(tmplDir)
    if (mergeErrors.length > 0) {
      rmSync(tempDir, { recursive: true, force: true })
      return { success: false, error: `模板合并失败:\n${mergeErrors.join('\n')}` }
    }

    const mediaDir = join(tmplDir, 'media')
    const existingFiles = new Set<string>()
    if (existsSync(mediaDir)) {
      for (const f of readdirSync(mediaDir)) {
        existingFiles.add(`media/${f}`)
      }
    }

    const validationErrors = validateTemplate(mergedTemplate, existingFiles)
    if (validationErrors.length > 0) {
      rmSync(tempDir, { recursive: true, force: true })
      return { success: false, error: `模板验证失败:\n${validationErrors.join('\n')}` }
    }

    const templateId = randomUUID()
    const targetDir = join(templatesPath, templateId)
    ensureDir(targetDir)
    writeFileSync(join(targetDir, 'template.json'), readFileSync(jsonPath))
    if (existsSync(mediaDir)) {
      copyDirRecursive(mediaDir, join(targetDir, 'media'))
    }
    const chunkDir = join(tmplDir, 'chunk')
    if (existsSync(chunkDir)) {
      copyDirRecursive(chunkDir, join(targetDir, 'chunk'))
    }

    rmSync(tempDir, { recursive: true, force: true })
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export function exportTemplate(
  templatesPath: string,
  templateId: string
): { buffer: Buffer; defaultName: string } {
  const tmplDir = join(templatesPath, templateId)
  if (!existsSync(tmplDir)) {
    throw new Error('模板不存在')
  }
  const zip = new AdmZip()
  const files = readdirSync(tmplDir, { recursive: true, withFileTypes: true })
  for (const file of files) {
    if (file.isFile()) {
      const fullPath = join(file.parentPath ?? tmplDir, file.name)
      const relative = fullPath.replace(tmplDir + '/', '').replace(tmplDir + '\\', '')
      zip.addLocalFile(fullPath, '', relative.replace(/\\/g, '/'))
    }
  }
  const buffer = zip.toBuffer()
  const defaultName = `模板_${templateId.substring(0, 8)}.zip`
  return { buffer, defaultName }
}

export function deleteTemplate(templatesPath: string, templateId: string): { success: boolean } {
  const dir = join(templatesPath, templateId)
  if (!existsSync(dir)) return { success: false }
  rmSync(dir, { recursive: true, force: true })
  return { success: true }
}
