/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import type { GradingRecord, ExamPackage, StudentInfo, SubmissionMeta } from '../../../shared/types'
import { ensureDir, getGradingPath, computeEid } from '../../utils'

function getRecordsPath(): string {
  return join(getGradingPath(), 'records.json')
}

export function loadRecords(): Record<string, GradingRecord> {
  const p = getRecordsPath()
  if (!existsSync(p)) return {}
  return JSON.parse(readFileSync(p, 'utf-8'))
}

export function saveRecords(records: Record<string, GradingRecord>): void {
  writeFileSync(getRecordsPath(), JSON.stringify(records, null, 2))
}

export function computeRid(student: StudentInfo, eid: string, examPackage: ExamPackage): string {
  const content = JSON.stringify({
    name: student.name,
    studentId: student.studentId,
    eid,
    questions: examPackage.questions
  })
  return createHash('sha256').update(content).digest('hex')
}

export function loadExamPackage(rid: string): ExamPackage | null {
  const examJsonPath = join(getGradingPath(), rid, 'exam', 'exam.json')
  if (!existsSync(examJsonPath)) return null
  try {
    return JSON.parse(readFileSync(examJsonPath, 'utf-8'))
  } catch {
    return null
  }
}

export function getSubmissionMeta(rid: string): SubmissionMeta | undefined {
  const metaPath = join(getGradingPath(), rid, 'meta.json')
  if (!existsSync(metaPath)) return undefined
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'))
  } catch {
    return undefined
  }
}

function tryParseExamFromSubmissionDir(
  files: AdmZip.IZipEntry[],
  dirName: string
): ExamPackage | null {
  const examJsonEntry = files.find((f) => f.entryName === `${dirName}/exam/exam.json`)
  if (!examJsonEntry) return null
  try {
    return JSON.parse(examJsonEntry.getData().toString('utf-8'))
  } catch {
    return null
  }
}

export interface ImportResult {
  success: boolean
  imported: number
  skipped: number
  failures: { student: string; reason: string }[]
  error?: string
}

export function importSubmissions(
  gradingPath: string,
  zipPath: string,
  onProgress?: (current: number, total: number) => void
): ImportResult {
  const records = loadRecords()
  let imported = 0
  let skipped = 0
  const failures: { student: string; reason: string }[] = []

  try {
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()

    const submissionDirs = new Map<string, AdmZip.IZipEntry[]>()
    for (const entry of entries) {
      if (entry.isDirectory) continue
      const parts = entry.entryName.split('/')
      if (parts.length < 2) continue
      const dirName = parts[0]
      if (!submissionDirs.has(dirName)) submissionDirs.set(dirName, [])
      submissionDirs.get(dirName)!.push(entry)
    }

    const total = submissionDirs.size
    let current = 0

    for (const [dirName, files] of submissionDirs) {
      current++
      onProgress?.(current, total)

      const metaEntry = files.find((f) => f.entryName.endsWith('meta.json'))
      if (!metaEntry) {
        failures.push({ student: dirName, reason: '缺少元数据' })
        continue
      }

      let meta: SubmissionMeta
      try {
        meta = JSON.parse(metaEntry.getData().toString('utf-8'))
      } catch {
        failures.push({ student: dirName, reason: '元数据解析失败' })
        continue
      }

      const studentLabel = meta.student.name || meta.student.studentId || dirName

      const examPackage = tryParseExamFromSubmissionDir(files, dirName)
      if (!examPackage) {
        failures.push({ student: studentLabel, reason: '作答包中缺少试卷数据' })
        continue
      }

      const eid = computeEid(examPackage)
      const rid = computeRid(meta.student, eid, examPackage)

      if (records[rid]) {
        skipped++
        continue
      }

      const targetDir = join(gradingPath, rid)
      ensureDir(targetDir)
      ensureDir(join(targetDir, 'recordings'))

      for (const f of files) {
        const rel = f.entryName.substring(dirName.length + 1)
        if (!rel) continue
        if (rel.includes('..') || rel.startsWith('/') || rel.startsWith('\\')) continue
        const targetPath = join(targetDir, rel)
        const targetParent = join(targetPath, '..')
        ensureDir(targetParent)
        writeFileSync(targetPath, f.getData())
      }

      records[rid] = {
        rid,
        status: 'ungraded',
        student: meta.student,
        examTitle: examPackage.title,
        eid,
        scores: {}
      }
      imported++
    }

    saveRecords(records)
    return { success: true, imported, skipped, failures }
  } catch (err) {
    console.error('导入作答包失败:', err)
    return { success: false, imported: 0, skipped: 0, failures, error: String(err) }
  }
}
