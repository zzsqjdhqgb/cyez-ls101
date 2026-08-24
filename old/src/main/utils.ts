/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/utils.ts
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import type { ExamPackage } from '../shared/types'

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function copyDirRecursive(src: string, dest: string): void {
  ensureDir(dest)
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

export function getExamsPath(): string {
  return join(app.getPath('userData'), 'exams')
}

export function getSubmissionsPath(): string {
  return join(app.getPath('userData'), 'submissions')
}

export function getTemplatesPath(): string {
  return join(app.getPath('userData'), 'templates')
}

export function getDraftsPath(): string {
  return join(app.getPath('userData'), 'drafts')
}

export function getGradingPath(): string {
  return join(app.getPath('userData'), 'grading')
}

export function prefixContentNodesForExam(
  nodes: Record<string, unknown>[],
  examId: string
): Record<string, unknown>[] {
  return nodes.map((node) => {
    const n = { ...node }
    if (typeof n.src === 'string') {
      n.src = `exam-resource://${examId}/${n.src}`
    }
    if (Array.isArray(n.images)) {
      n.images = n.images.map((img) =>
        typeof img === 'string' ? `exam-resource://${examId}/${img}` : img
      )
    }
    return n
  })
}

export function validateExamResources(
  examDir: string,
  questions: Record<string, unknown>[]
): string[] {
  const missing: string[] = []
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const content = (q.content as Record<string, unknown>[]) ?? []
    for (const node of content) {
      if (typeof node.src === 'string') {
        if (!isSafeMediaPath(examDir, node.src as string)) {
          missing.push(`题目 ${i + 1}: ${node.src} (不允许的路径)`)
        } else if (!existsSync(join(examDir, node.src as string))) {
          missing.push(`题目 ${i + 1}: ${node.src}`)
        }
      }
      if (Array.isArray(node.images)) {
        for (const img of node.images) {
          if (typeof img !== 'string') continue
          if (!isSafeMediaPath(examDir, img)) {
            missing.push(`题目 ${i + 1}: ${img} (不允许的路径)`)
          } else if (!existsSync(join(examDir, img))) {
            missing.push(`题目 ${i + 1}: ${img}`)
          }
        }
      }
    }
  }
  return missing
}

/**
 * Checks that relPath, when resolved against baseDir, stays within baseDir/media/.
 * Rejects absolute paths and paths that would escape the media directory.
 */
export function isSafeMediaPath(baseDir: string, relPath: string): boolean {
  if (!relPath || typeof relPath !== 'string') return false
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return false

  const resolved = resolve(baseDir, relPath)
  const mediaDir = resolve(baseDir, 'media')
  return resolved === mediaDir || resolved.startsWith(mediaDir + sep)
}

export function computeEid(examPackage: ExamPackage): string {
  const content = JSON.stringify({
    title: examPackage.title,
    questions: examPackage.questions
  })
  return createHash('sha256').update(content).digest('hex')
}
