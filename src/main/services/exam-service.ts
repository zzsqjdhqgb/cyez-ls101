/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/services/exam-service.ts
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { validateExamPackage } from '../../shared/validation'
import type { ExamListItem } from '../../shared/types'
import {
  ensureDir,
  copyDirRecursive,
  computeEid,
  prefixContentNodesForExam,
  validateExamResources
} from '../utils'

export function listExams(examsPath: string): ExamListItem[] {
  if (!existsSync(examsPath)) return []
  const entries = readdirSync(examsPath, { withFileTypes: true })
  const exams: ExamListItem[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const examJsonPath = join(examsPath, entry.name, 'exam.json')
    if (!existsSync(examJsonPath)) continue
    try {
      const raw = readFileSync(examJsonPath, 'utf-8')
      const pkg = JSON.parse(raw)
      const stat = statSync(join(examsPath, entry.name))
      exams.push({
        id: entry.name,
        title: pkg.title || '未命名考试',
        questionCount: Array.isArray(pkg.questions) ? pkg.questions.length : 0,
        importedAt: stat.mtime.toISOString()
      })
    } catch {
      console.warn(`跳过无效考试目录: ${entry.name}`)
    }
  }
  exams.sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
  return exams
}

export function loadExam(examsPath: string, examId: string): Record<string, unknown> {
  const examDir = join(examsPath, examId)
  const examJsonPath = join(examDir, 'exam.json')
  if (!existsSync(examJsonPath)) throw new Error(`考试 ${examId} 不存在`)

  const raw = readFileSync(examJsonPath, 'utf-8')
  const examPackage: Record<string, unknown> = JSON.parse(raw)
  const errors = validateExamPackage(examPackage)
  if (errors.length > 0) throw new Error(`试卷格式不合法：${errors[0].message}`)

  const questions = examPackage.questions as Record<string, unknown>[]
  const missing = validateExamResources(examDir, questions)
  if (missing.length > 0) throw new Error(`缺少资源文件：${missing.join(', ')}`)

  examPackage.questions = questions.map((q) => ({
    ...q,
    content: prefixContentNodesForExam((q.content as Record<string, unknown>[]) ?? [], examId)
  }))
  return examPackage
}

export function importExam(
  examsPath: string,
  zipPath: string,
  tempDir: string
): { success: boolean; examId?: string; error?: string } {
  try {
    ensureDir(tempDir)
    const zip = new AdmZip(zipPath)
    zip.extractAllTo(tempDir, true)

    let examJsonDir = tempDir
    if (!existsSync(join(tempDir, 'exam.json'))) {
      const subDirs = readdirSync(tempDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      if (subDirs.length === 1 && existsSync(join(tempDir, subDirs[0].name, 'exam.json'))) {
        examJsonDir = join(tempDir, subDirs[0].name)
      }
    }

    const examJsonPath = join(examJsonDir, 'exam.json')
    if (!existsSync(examJsonPath)) return { success: false, error: '未找到 exam.json' }

    const raw = readFileSync(examJsonPath, 'utf-8')
    const examPackage = JSON.parse(raw)
    const errors = validateExamPackage(examPackage)
    if (errors.length > 0) return { success: false, error: `试卷格式不合法：${errors[0].message}` }

    const questions = examPackage.questions as Record<string, unknown>[]
    const missing = validateExamResources(examJsonDir, questions)
    if (missing.length > 0) return { success: false, error: `缺少资源文件：${missing.join(', ')}` }

    const examId = computeEid(examPackage)
    const targetDir = join(examsPath, examId)
    ensureDir(targetDir)
    writeFileSync(join(targetDir, 'exam.json'), raw)
    const mediaDir = join(examJsonDir, 'media')
    if (existsSync(mediaDir)) copyDirRecursive(mediaDir, join(targetDir, 'media'))

    rmSync(tempDir, { recursive: true, force: true })
    console.log(`导入考试成功: ${examId} - ${examPackage.title}`)
    return { success: true, examId }
  } catch (err) {
    console.error('导入考试失败:', err)
    return { success: false, error: String(err) }
  }
}

export function exportExam(
  examsPath: string,
  examId: string
): { buffer: Buffer; defaultName: string } {
  const examDir = join(examsPath, examId)
  if (!existsSync(examDir)) throw new Error(`考试 ${examId} 不存在`)

  let defaultName = '考试'
  try {
    const raw = readFileSync(join(examDir, 'exam.json'), 'utf-8')
    const pkg = JSON.parse(raw)
    defaultName = pkg.title || '考试'
  } catch {
    /* ignore */
  }

  const zip = new AdmZip()
  const files = readdirSync(examDir, { recursive: true, withFileTypes: true })
  for (const file of files) {
    if (file.isFile()) {
      const fullPath = join(file.parentPath ?? examDir, file.name)
      const relative = fullPath.replace(examDir + '/', '').replace(examDir + '\\', '')
      zip.addLocalFile(fullPath, '', relative.replace(/\\/g, '/'))
    }
  }
  const buffer = zip.toBuffer()
  return { buffer, defaultName }
}

export function deleteExam(examsPath: string, examId: string): { success: boolean } {
  const examDir = join(examsPath, examId)
  if (!existsSync(examDir)) return { success: false }
  rmSync(examDir, { recursive: true, force: true })
  return { success: true }
}
