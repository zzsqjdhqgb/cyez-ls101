/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GradingBatch } from '../../../shared/types'
import { ensureDir } from '../../utils'
import { loadRecords, saveRecords, loadExamPackage, getSubmissionMeta } from './import'

export function getMaxScore(rid: string): number | undefined {
  const pkg = loadExamPackage(rid)
  if (!pkg || !Array.isArray(pkg.gradingInfo)) return undefined
  return pkg.gradingInfo.reduce(
    (sum, gi) =>
      sum +
      (gi.fullScore ?? (gi.scoreOptions?.length ? gi.scoreOptions[gi.scoreOptions.length - 1] : 0)),
    0
  )
}

export interface SettleNowResult {
  success: boolean
  batchId?: string
}

export function settleNow(gradingPath: string, sessionSettlementRids: string[]): SettleNowResult {
  const records = loadRecords()
  const batchId = randomUUID()
  const gradedAt = new Date().toISOString()
  const completedRids: string[] = []

  for (const rid of sessionSettlementRids) {
    const record = records[rid]
    if (!record) continue

    const pkg = loadExamPackage(rid)
    if (!pkg || !Array.isArray(pkg.gradingInfo)) continue

    let allGraded = true
    let totalScore = 0
    for (const gi of pkg.gradingInfo) {
      const se = record.scores[gi.id]
      if (!se) {
        allGraded = false
        break
      }
      totalScore += se.score
    }

    if (allGraded) {
      record.status = 'completed'
      record.totalScore = totalScore
      record.batchId = batchId
      record.gradedAt = gradedAt
      completedRids.push(rid)
    }
  }

  saveRecords(records)

  if (completedRids.length > 0) {
    const batchDir = join(gradingPath, 'batches', batchId)
    ensureDir(batchDir)
    writeFileSync(
      join(batchDir, 'batch.json'),
      JSON.stringify({ batchId, gradedAt, rids: completedRids }, null, 2)
    )
  }

  return { success: true, batchId: completedRids.length > 0 ? batchId : undefined }
}

export function settleLater(): { success: boolean } {
  return { success: true }
}

export function listBatches(gradingPath: string): GradingBatch[] {
  const records = loadRecords()
  const batchesPath = join(gradingPath, 'batches')
  if (!existsSync(batchesPath)) return []

  const batches: GradingBatch[] = []
  const batchEntries = readdirSync(batchesPath, { withFileTypes: true }).filter((e) =>
    e.isDirectory()
  )

  for (const entry of batchEntries) {
    const batchJsonPath = join(batchesPath, entry.name, 'batch.json')
    if (!existsSync(batchJsonPath)) continue
    try {
      const batchData = JSON.parse(readFileSync(batchJsonPath, 'utf-8'))
      const batchRecords: GradingBatch['records'] = []
      for (const rid of batchData.rids || []) {
        if (records[rid]) {
          const rec = { ...records[rid] }
          rec.submittedAt = getSubmissionMeta(rid)?.submittedAt
          rec.maxScore = getMaxScore(rid)
          batchRecords.push(rec)
        }
      }
      batches.push({
        batchId: batchData.batchId,
        gradedAt: batchData.gradedAt,
        records: batchRecords
      })
    } catch {
      /* skip */
    }
  }

  batches.sort((a, b) => new Date(b.gradedAt).getTime() - new Date(a.gradedAt).getTime())
  return batches
}
