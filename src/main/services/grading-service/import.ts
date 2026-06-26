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

      // Load choice answers from submission
      let choiceAnswers: Record<number, string> = {}
      try {
        const choicesPath = join(targetDir, 'choices.json')
        if (existsSync(choicesPath)) {
          choiceAnswers = JSON.parse(readFileSync(choicesPath, 'utf-8'))
        }
      } catch {
        /* ignore */
      }

      // Auto-grade choice questions
      const choiceScores: Record<
        number,
        {
          choiceId: number
          userAnswer?: string
          correctAnswer: string
          isCorrect: boolean
          fullScore: number
          score: number
        }
      > = {}
      let totalScore = 0
      let maxScore = 0
      const gradingInfo = examPackage.gradingInfo || []
      const choiceGradingItems = gradingInfo.filter(
        (gi: Record<string, unknown>) => 'choiceId' in gi && !('id' in gi)
      )
      const recordingItems = gradingInfo.filter(
        (gi: Record<string, unknown>) => 'id' in gi && !('choiceId' in gi)
      )

      // Compute choice scores
      const allChoiceQs: Record<number, Record<string, unknown>> = {}
      for (const q of examPackage.questions) {
        const cp = (q as Record<string, unknown>).choicePages as
          | Record<string, unknown>[]
          | undefined
        if (cp) {
          for (const page of cp) {
            const qs = page.questions as Record<string, unknown>[]
            if (qs) for (const cq of qs) allChoiceQs[cq.id as number] = cq
          }
        }
      }

      for (const gi of choiceGradingItems) {
        const cId = gi.choiceId as number
        const fullScore = gi.fullScore as number
        const cq = allChoiceQs[cId]
        if (!cq) continue
        const correctAnswer = cq.answer as string
        const userAnswer = choiceAnswers[cId]
        const isCorrect = userAnswer === correctAnswer
        choiceScores[cId] = {
          choiceId: cId,
          userAnswer: userAnswer || undefined,
          correctAnswer,
          isCorrect,
          fullScore,
          score: isCorrect ? fullScore : 0
        }
        totalScore += choiceScores[cId].score
        maxScore += fullScore
      }

      // Compute recording-derived max score
      for (const gi of recordingItems) {
        const fs = gi.fullScore as number
        if (typeof fs === 'number' && fs > 0) maxScore += fs
      }

      const isChoiceOnly = examPackage.choiceOnly === true
      records[rid] = {
        rid,
        status: isChoiceOnly ? 'completed' : 'ungraded',
        student: meta.student,
        examTitle: examPackage.title,
        eid,
        scores: {},
        totalScore: totalScore > 0 || maxScore > 0 ? totalScore : undefined,
        maxScore: maxScore > 0 ? maxScore : undefined,
        choiceScores: Object.keys(choiceScores).length > 0 ? choiceScores : undefined
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
