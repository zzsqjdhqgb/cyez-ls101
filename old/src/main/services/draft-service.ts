/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/services/draft-service.ts
import {
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
  copyFileSync,
  mkdirSync
} from 'node:fs'
import { join, extname, basename, dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import type { DraftView } from '../../shared/types'
import { ensureDir, copyDirRecursive, isSafeMediaPath } from '../utils'
import { getTtsEngine } from '../tts/tts'
import { loadMergedTemplate } from './template-service'

export function createDraft(templatesPath: string, draftsPath: string, templateId: string): string {
  const templateDir = join(templatesPath, templateId)
  if (!existsSync(templateDir)) throw new Error('模板不存在')

  const draftId = randomUUID()
  const draftDir = join(draftsPath, draftId)
  ensureDir(draftDir)

  copyFileSync(join(templateDir, 'template.json'), join(draftDir, 'template.json'))
  const mediaDir = join(templateDir, 'media')
  if (existsSync(mediaDir)) {
    copyDirRecursive(mediaDir, join(draftDir, 'media'))
  }
  const chunkDir = join(templateDir, 'chunk')
  if (existsSync(chunkDir)) {
    copyDirRecursive(chunkDir, join(draftDir, 'chunk'))
  }

  ensureDir(join(draftDir, 'uploads'))

  const { template } = loadMergedTemplate(templateDir)
  const textValues: Record<string, string> = {}
  const fileValues: Record<string, string> = {}
  const fileOriginalNames: Record<string, string> = {}
  for (const item of template.editableData) {
    if (item.type === 'text') textValues[item.id] = ''
  }

  const draftState = {
    templateId,
    textValues,
    fileValues,
    fileOriginalNames,
    updatedAt: new Date().toISOString()
  }
  writeFileSync(join(draftDir, 'draftState.json'), JSON.stringify(draftState, null, 2))

  return draftId
}

export function listDrafts(
  draftsPath: string
): { id: string; templateId: string; title: string; updatedAt: string }[] {
  if (!existsSync(draftsPath)) return []
  const entries = readdirSync(draftsPath, { withFileTypes: true }).filter((e) => e.isDirectory())
  const list: { id: string; templateId: string; title: string; updatedAt: string }[] = []
  for (const entry of entries) {
    const statePath = join(draftsPath, entry.name, 'draftState.json')
    if (!existsSync(statePath)) continue
    try {
      const { template } = loadMergedTemplate(join(draftsPath, entry.name))
      const defaultTitle = (template.examData as Record<string, unknown>)?.title || '未命名试卷'
      const state = JSON.parse(readFileSync(statePath, 'utf-8'))
      const title = state.title?.trim() || defaultTitle
      list.push({
        id: entry.name,
        templateId: state.templateId,
        title,
        updatedAt: state.updatedAt || statSync(join(draftsPath, entry.name)).mtime.toISOString()
      })
    } catch {
      /* skip */
    }
  }
  return list
}

export function loadDraft(draftsPath: string, draftId: string): DraftView {
  const draftDir = join(draftsPath, draftId)
  if (!existsSync(draftDir)) throw new Error('草稿不存在')

  const { template } = loadMergedTemplate(draftDir)
  const defaultTitle = (template.examData as Record<string, unknown>)?.title || '未命名试卷'
  const state = JSON.parse(readFileSync(join(draftDir, 'draftState.json'), 'utf-8'))
  const title = state.title?.trim() || String(defaultTitle)

  return {
    id: draftId,
    templateId: state.templateId,
    title,
    editableItems: template.editableData,
    textValues: state.textValues ?? {},
    fileValues: state.fileValues ?? {},
    fileOriginalNames: state.fileOriginalNames ?? {}
  }
}

export function updateText(draftsPath: string, draftId: string, id: string, value: string): void {
  const statePath = join(draftsPath, draftId, 'draftState.json')
  const state = JSON.parse(readFileSync(statePath, 'utf-8'))
  state.textValues[id] = value
  state.updatedAt = new Date().toISOString()
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

export function updateTitle(draftsPath: string, draftId: string, title: string): void {
  const statePath = join(draftsPath, draftId, 'draftState.json')
  const state = JSON.parse(readFileSync(statePath, 'utf-8'))
  if (title.trim() === '') {
    delete state.title
  } else {
    state.title = title
  }
  state.updatedAt = new Date().toISOString()
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

export function uploadFile(
  draftsPath: string,
  draftId: string,
  id: string,
  filePath: string
): void {
  const draftDir = join(draftsPath, draftId)
  const uploadsDir = join(draftDir, 'uploads')
  ensureDir(uploadsDir)

  const hash = createHash('sha256')
    .update(filePath + Date.now().toString())
    .digest('hex')
    .substring(0, 12)
  const ext = extname(filePath)
  const newName = `${hash}${ext}`
  copyFileSync(filePath, join(uploadsDir, newName))

  const statePath = join(draftDir, 'draftState.json')
  const state = JSON.parse(readFileSync(statePath, 'utf-8'))
  state.fileValues[id] = newName
  if (!state.fileOriginalNames) state.fileOriginalNames = {}
  state.fileOriginalNames[id] = basename(filePath)
  state.updatedAt = new Date().toISOString()
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

export function uploadClipboardImage(
  draftsPath: string,
  draftId: string,
  id: string,
  base64Data: string,
  ext: string
): void {
  const draftDir = join(draftsPath, draftId)
  const uploadsDir = join(draftDir, 'uploads')
  ensureDir(uploadsDir)

  const hash = createHash('sha256')
    .update(id + Date.now().toString() + Math.random().toString())
    .digest('hex')
    .substring(0, 12)
  const newName = `${hash}.${ext}`

  const buffer = Buffer.from(base64Data, 'base64')
  writeFileSync(join(uploadsDir, newName), buffer)

  const statePath = join(draftDir, 'draftState.json')
  const state = JSON.parse(readFileSync(statePath, 'utf-8'))
  state.fileValues[id] = newName
  if (!state.fileOriginalNames) state.fileOriginalNames = {}
  state.fileOriginalNames[id] = `剪贴板图片_${hash.substring(0, 6)}.${ext}`
  state.updatedAt = new Date().toISOString()
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

export function removeFile(draftsPath: string, draftId: string, id: string): void {
  const draftDir = join(draftsPath, draftId)
  const statePath = join(draftDir, 'draftState.json')
  const state = JSON.parse(readFileSync(statePath, 'utf-8'))
  if (state.fileValues[id]) {
    const oldFile = join(draftDir, 'uploads', state.fileValues[id])
    if (existsSync(oldFile)) rmSync(oldFile)
    state.fileValues[id] = ''
    if (state.fileOriginalNames?.[id]) {
      state.fileOriginalNames[id] = ''
    }
    state.updatedAt = new Date().toISOString()
    writeFileSync(statePath, JSON.stringify(state, null, 2))
  }
}

export function deleteDraft(draftsPath: string, draftId: string): { success: boolean } {
  const dir = join(draftsPath, draftId)
  if (!existsSync(dir)) return { success: false }
  rmSync(dir, { recursive: true, force: true })
  return { success: true }
}

export async function exportExam(
  draftsPath: string,
  draftId: string,
  tempBaseDir: string,
  onProgress: (step: string, current: number, total: number) => void
): Promise<{ success: boolean; buffer?: Buffer; error?: string }> {
  const draftDir = join(draftsPath, draftId)
  if (!existsSync(draftDir)) {
    onProgress('草稿不存在', 0, 1)
    return { success: false, error: '草稿不存在' }
  }

  const { template } = loadMergedTemplate(draftDir)
  const state = JSON.parse(readFileSync(join(draftDir, 'draftState.json'), 'utf-8'))
  const textValues: Record<string, string> = state.textValues ?? {}
  const fileValues: Record<string, string> = state.fileValues ?? {}

  for (const item of template.editableData) {
    if (item.type === 'text' && !textValues[item.id]) {
      onProgress(`请填写 "${item.description}"`, 0, 1)
      return { success: false, error: `请填写 "${item.description}"` }
    }
    if (item.type === 'file' && !fileValues[item.id]) {
      onProgress(`请为 "${item.description}" 选择文件`, 0, 1)
      return { success: false, error: `请为 "${item.description}" 选择文件` }
    }
  }

  const defaultTitle = ((template.examData as Record<string, unknown>).title as string) || '试卷'
  const examTitle = state.title?.trim() || defaultTitle
  let totalSteps = 0

  try {
    const buildDir = join(tempBaseDir, `export-${randomUUID()}`)
    ensureDir(buildDir)
    const mediaDir = join(buildDir, 'media')
    ensureDir(mediaDir)

    onProgress('正在准备...', 1, totalSteps)

    const replacePlaceholders = (text: string): string =>
      text.replace(/\{\{([^}]+)\}\}/g, (_, id: string) => textValues[id] ?? '')

    const processObject = (obj: unknown): unknown => {
      if (typeof obj === 'string') return replacePlaceholders(obj)
      if (Array.isArray(obj)) return obj.map(processObject)
      if (obj && typeof obj === 'object') {
        const newObj: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
          newObj[key] = processObject(val)
        }
        return newObj
      }
      return obj
    }
    const finalExamData = processObject(template.examData) as Record<string, unknown>
    finalExamData.title = examTitle

    const srcMediaDir = join(draftDir, 'media')
    if (existsSync(srcMediaDir)) copyDirRecursive(srcMediaDir, mediaDir)

    onProgress('正在复制媒体文件...', 2, totalSteps)
    for (const item of template.editableData) {
      if (item.type === 'file' && item.fileName && fileValues[item.id]) {
        const srcFile = join(draftDir, 'uploads', fileValues[item.id])
        if (!existsSync(srcFile)) {
          onProgress(`文件缺失：${item.description}`, 0, 1)
          return {
            success: false,
            error: `文件缺失：${item.description} 对应的文件已丢失，请重新上传。`
          }
        }
        if (!isSafeMediaPath(buildDir, item.fileName)) {
          onProgress(`文件路径不合法：${item.fileName}`, 0, 1)
          return {
            success: false,
            error: `文件路径不合法：${item.fileName} 不允许的路径`
          }
        }
        const destFile = join(buildDir, item.fileName)
        mkdirSync(dirname(destFile), { recursive: true })
        copyFileSync(srcFile, destFile)
      }
    }

    const questions = finalExamData.questions as Record<string, unknown>[]
    const totalAudioNodes = questions.reduce((count, q) => {
      return (
        count +
        ((q.content as Record<string, unknown>[]) || []).filter((n) => n.type === 'audio').length
      )
    }, 0)
    totalSteps = totalAudioNodes + 3

    let processedAudioNodes = 0
    for (let qi = 0; qi < questions.length; qi++) {
      const content = questions[qi].content as Record<string, unknown>[]
      for (let ci = 0; ci < content.length; ci++) {
        const node = content[ci]
        if (node.type === 'audio') {
          const text = node.text as string
          let src = node.src as string

          if (src && !isSafeMediaPath(buildDir, src)) {
            onProgress(`音频路径不合法：${src}`, totalSteps, totalSteps)
            return { success: false, error: `音频路径不合法：${src}` }
          }
          if (!src || !existsSync(join(buildDir, src))) {
            const qId = questions[qi].id || `q${qi}`
            const fileName = `audio_${qId}_${ci}.wav`
            src = `media/${fileName}`
            const outPath = join(buildDir, src)
            mkdirSync(dirname(outPath), { recursive: true })

            const currentProgress = 3 + processedAudioNodes
            onProgress(
              `正在合成语音 ${processedAudioNodes + 1}/${totalAudioNodes}：${text.substring(0, 15)}...`,
              currentProgress,
              totalSteps
            )

            const ttsEngine = await getTtsEngine()
            try {
              await ttsEngine.synthesize(text, outPath)
            } catch (err) {
              onProgress('语音合成失败', currentProgress, totalSteps)
              return { success: false, error: `语音合成失败："${fileName}"：${err}` }
            }
            node.src = src
            processedAudioNodes++
          }
        }
      }
    }

    onProgress('正在打包...', totalSteps, totalSteps)
    writeFileSync(join(buildDir, 'exam.json'), JSON.stringify(finalExamData, null, 2))

    const zip = new AdmZip()
    const allFiles = readdirSync(buildDir, { recursive: true, withFileTypes: true })
    for (const f of allFiles) {
      if (f.isFile()) {
        const full = join(f.parentPath ?? buildDir, f.name)
        const rel = full.replace(buildDir + '/', '').replace(buildDir + '\\', '')
        zip.addLocalFile(full, '', rel.replace(/\\/g, '/'))
      }
    }
    const buffer = zip.toBuffer()
    rmSync(buildDir, { recursive: true, force: true })

    onProgress('导出完成', totalSteps, totalSteps)
    return { success: true, buffer }
  } catch (err) {
    onProgress('导出失败', totalSteps, totalSteps)
    return { success: false, error: String(err) }
  }
}

export function importDraftFromZip(
  draftsPath: string,
  zipPath: string,
  tempDir: string
): { success: boolean; error?: string } {
  try {
    ensureDir(tempDir)
    const zip = new AdmZip(zipPath)
    zip.extractAllTo(tempDir, true)

    if (
      !existsSync(join(tempDir, 'template.json')) ||
      !existsSync(join(tempDir, 'draftState.json'))
    ) {
      const subs = readdirSync(tempDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      if (subs.length === 1) {
        const possibleDir = join(tempDir, subs[0].name)
        if (
          existsSync(join(possibleDir, 'template.json')) &&
          existsSync(join(possibleDir, 'draftState.json'))
        ) {
          for (const entry of readdirSync(possibleDir, { withFileTypes: true })) {
            const src = join(possibleDir, entry.name)
            const dest = join(tempDir, entry.name)
            if (entry.isDirectory()) copyDirRecursive(src, dest)
            else copyFileSync(src, dest)
          }
        }
      }
    }

    if (
      !existsSync(join(tempDir, 'template.json')) ||
      !existsSync(join(tempDir, 'draftState.json'))
    ) {
      rmSync(tempDir, { recursive: true, force: true })
      return { success: false, error: '无效的草稿包，缺少 template.json 或 draftState.json' }
    }

    const draftId = randomUUID()
    const targetDir = join(draftsPath, draftId)
    ensureDir(targetDir)
    copyFileSync(join(tempDir, 'template.json'), join(targetDir, 'template.json'))
    copyFileSync(join(tempDir, 'draftState.json'), join(targetDir, 'draftState.json'))
    if (existsSync(join(tempDir, 'media'))) {
      copyDirRecursive(join(tempDir, 'media'), join(targetDir, 'media'))
    }
    if (existsSync(join(tempDir, 'chunk'))) {
      copyDirRecursive(join(tempDir, 'chunk'), join(targetDir, 'chunk'))
    }
    if (existsSync(join(tempDir, 'uploads'))) {
      copyDirRecursive(join(tempDir, 'uploads'), join(targetDir, 'uploads'))
    }

    rmSync(tempDir, { recursive: true, force: true })
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
