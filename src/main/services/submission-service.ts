/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/services/submission-service.ts
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import type { StudentInfo, SubmissionMeta, SubmissionItem } from '../../shared/types'
import { ensureDir, copyDirRecursive } from '../utils'

export function createSubmission(
  examsPath: string,
  submissionsPath: string,
  examId: string,
  student: StudentInfo
): string {
  const examDir = join(examsPath, examId)
  if (!existsSync(examDir)) throw new Error('考试不存在')

  const submissionId = randomUUID()
  const submissionDir = join(submissionsPath, submissionId)
  ensureDir(submissionDir)

  copyDirRecursive(examDir, join(submissionDir, 'exam'))
  ensureDir(join(submissionDir, 'recordings'))

  const meta: SubmissionMeta = {
    student,
    examId,
    submittedAt: new Date().toISOString()
  }
  writeFileSync(join(submissionDir, 'meta.json'), JSON.stringify(meta, null, 2))

  return submissionId
}

export function saveRecord(
  submissionsPath: string,
  submissionId: string,
  recordIndex: number,
  buffer: ArrayBuffer
): void {
  const recordingsDir = join(submissionsPath, submissionId, 'recordings')
  ensureDir(recordingsDir)
  const filePath = join(recordingsDir, `${recordIndex}.mp3`)
  writeFileSync(filePath, Buffer.from(buffer))
}

export function listSubmissions(
  examsPath: string,
  submissionsPath: string,
  filter?: { studentId?: string; name?: string; examTitle?: string }
): SubmissionItem[] {
  if (!existsSync(submissionsPath)) return []

  const entries = readdirSync(submissionsPath, { withFileTypes: true }).filter((e) =>
    e.isDirectory()
  )
  const results: SubmissionItem[] = []

  for (const entry of entries) {
    const metaPath = join(submissionsPath, entry.name, 'meta.json')
    if (!existsSync(metaPath)) continue
    try {
      const meta: SubmissionMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      const recordingsDir = join(submissionsPath, entry.name, 'recordings')
      const recordFiles = existsSync(recordingsDir)
        ? readdirSync(recordingsDir).filter((f) => f.endsWith('.mp3'))
        : []

      let examTitle = '未知考试'
      try {
        const examJsonPath = join(examsPath, meta.examId, 'exam.json')
        if (existsSync(examJsonPath)) {
          const examData = JSON.parse(readFileSync(examJsonPath, 'utf-8'))
          examTitle = examData.title || '未知考试'
        }
      } catch {
        /* ignore */
      }

      if (filter?.studentId && meta.student.studentId !== filter.studentId) continue
      if (filter?.name && !meta.student.name.includes(filter.name)) continue
      if (filter?.examTitle && !examTitle.includes(filter.examTitle)) continue

      results.push({
        id: entry.name,
        student: meta.student,
        examTitle,
        submittedAt: meta.submittedAt,
        recordingCount: recordFiles.length
      })
    } catch (err) {
      console.error('读取提交失败:', err)
    }
  }

  results.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
  return results
}

export function deleteSubmission(
  submissionsPath: string,
  submissionId: string
): { success: boolean } {
  const dir = join(submissionsPath, submissionId)
  if (!existsSync(dir)) return { success: false }
  rmSync(dir, { recursive: true, force: true })
  return { success: true }
}

export function exportSubmission(
  submissionsPath: string,
  submissionId: string
): { buffer: Buffer; defaultName: string } {
  const subDir = join(submissionsPath, submissionId)
  if (!existsSync(subDir)) throw new Error('提交记录不存在')

  const metaPath = join(subDir, 'meta.json')
  let studentName = '未知'
  if (existsSync(metaPath)) {
    const meta: SubmissionMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    studentName = meta.student.name
  }

  const zip = new AdmZip()
  const prefix = `${studentName}_${submissionId.substring(0, 8)}/`
  const files = readdirSync(subDir, { recursive: true, withFileTypes: true })
  for (const file of files) {
    if (file.isFile()) {
      const fullPath = join(file.parentPath ?? subDir, file.name)
      const relative = fullPath.replace(subDir + '/', '').replace(subDir + '\\', '')
      zip.addLocalFile(fullPath, prefix, relative.replace(/\\/g, '/'))
    }
  }

  const buffer = zip.toBuffer()
  const defaultName = `作答_${studentName}_${submissionId.substring(0, 8)}.zip`
  return { buffer, defaultName }
}

export function exportMultipleSubmissions(
  submissionsPath: string,
  submissionIds: string[]
): { buffer: Buffer; defaultName: string } {
  const validIds: string[] = []
  for (const id of submissionIds) {
    const dir = join(submissionsPath, id)
    if (existsSync(dir)) validIds.push(id)
  }
  if (validIds.length === 0) throw new Error('没有有效的提交记录')

  const zip = new AdmZip()
  for (const id of validIds) {
    const subDir = join(submissionsPath, id)
    let studentName = id.substring(0, 8)
    const metaPath = join(subDir, 'meta.json')
    if (existsSync(metaPath)) {
      const meta: SubmissionMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      studentName = meta.student.name
    }
    const prefix = `${studentName}_${id.substring(0, 8)}/`
    const files = readdirSync(subDir, { recursive: true, withFileTypes: true })
    for (const file of files) {
      if (file.isFile()) {
        const fullPath = join(file.parentPath ?? subDir, file.name)
        const relative = fullPath.replace(subDir + '/', '').replace(subDir + '\\', '')
        zip.addLocalFile(fullPath, prefix, relative.replace(/\\/g, '/'))
      }
    }
  }

  const buffer = zip.toBuffer()
  const defaultName = `作答_批_${new Date().toISOString().slice(0, 10)}.zip`
  return { buffer, defaultName }
}

export function deleteMultipleSubmissions(
  submissionsPath: string,
  submissionIds: string[]
): { success: boolean; deleted: string[]; notFound: string[] } {
  const results = { success: true, deleted: [] as string[], notFound: [] as string[] }
  for (const id of submissionIds) {
    const dir = join(submissionsPath, id)
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true })
        results.deleted.push(id)
      } catch (err) {
        console.error(`删除失败 ${id}:`, err)
        results.success = false
      }
    } else {
      results.notFound.push(id)
    }
  }
  return results
}
