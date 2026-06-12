/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { validateExamPackage } from '../../shared/validation'
import type { ExamPackage } from '../../shared/types'
import { ensureDir, copyDirRecursive, computeEid, getExamsPath, getTemplatesPath } from '../utils'
import { getVersionFilePath, getCurrentVersion, writeVersionFile } from '../utils/version'

async function importBundledExams(): Promise<void> {
  const examsPath = getExamsPath()

  const bundledSourceDir = app.isPackaged
    ? join(process.resourcesPath, 'exams')
    : join(app.getAppPath(), 'exams')
  if (!existsSync(bundledSourceDir)) return

  const entries = readdirSync(bundledSourceDir, { withFileTypes: true }).filter((e) =>
    e.isDirectory()
  )
  for (const entry of entries) {
    const examJsonPath = join(bundledSourceDir, entry.name, 'exam.json')
    if (!existsSync(examJsonPath)) continue
    try {
      const raw = readFileSync(examJsonPath, 'utf-8')
      const pkg = JSON.parse(raw)
      const errors = validateExamPackage(pkg)
      if (errors.length > 0) continue

      const sourceDir = join(bundledSourceDir, entry.name)
      const examId = computeEid(pkg as ExamPackage)
      const targetDir = join(examsPath, examId)
      ensureDir(targetDir)
      writeFileSync(join(targetDir, 'exam.json'), raw)
      const mediaDir = join(sourceDir, 'media')
      if (existsSync(mediaDir)) {
        copyDirRecursive(mediaDir, join(targetDir, 'media'))
      }
    } catch (err) {
      console.error(`导入预置考试失败: ${entry.name}`, err)
    }
  }
}

async function importBundledTemplates(): Promise<void> {
  const templatesPath = getTemplatesPath()

  const bundledDir = app.isPackaged
    ? join(process.resourcesPath, 'templates')
    : join(app.getAppPath(), 'templates')
  if (!existsSync(bundledDir)) return

  const entries = readdirSync(bundledDir, { withFileTypes: true }).filter((e) => e.isDirectory())
  for (const entry of entries) {
    const srcDir = join(bundledDir, entry.name)
    const tmplJson = join(srcDir, 'template.json')
    if (!existsSync(tmplJson)) continue
    const tplId = randomUUID()
    const targetDir = join(templatesPath, tplId)
    ensureDir(targetDir)
    copyFileSync(tmplJson, join(targetDir, 'template.json'))
    const mediaDir = join(srcDir, 'media')
    if (existsSync(mediaDir)) {
      copyDirRecursive(mediaDir, join(targetDir, 'media'))
    }
    const chunkDir = join(srcDir, 'chunk')
    if (existsSync(chunkDir)) {
      copyDirRecursive(chunkDir, join(targetDir, 'chunk'))
    }
  }
}

export async function initializeBundledData(): Promise<void> {
  if (existsSync(getVersionFilePath())) return

  const examsInitFlag = join(getExamsPath(), 'initialized')
  const templatesInitFlag = join(getTemplatesPath(), 'initialized')
  if (existsSync(examsInitFlag) || existsSync(templatesInitFlag)) return

  await importBundledExams()
  await importBundledTemplates()
  writeVersionFile(getCurrentVersion())
}
