/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GradingRecord, GradingInfoItem, SettlementRecord } from '../../../shared/types'
import { getGradingPath } from '../../utils'
import { loadRecords, saveRecords, loadExamPackage } from './import'

export interface GradingItemToGrade {
  rid: string
  gradingInfoItem: GradingInfoItem
  audioUrls: string[]
  existingScore?: { score: number; comment: string }
}

export interface StartGradingResult {
  success: boolean
  firstItem: GradingItemToGrade | null
  ungradedCount: number
  sessionCount: number
  eid?: string
  error?: string
  needsSettlement?: boolean
  settlementRids?: string[]
  firstSubmissionUngradedCount?: number
}

export interface SubmitScoreResult {
  success: boolean
  nextItem: GradingItemToGrade | null
  settle: boolean
  error?: string
  currentSubmissionUngradedCount?: number
}

export interface SettlementInfo {
  success: boolean
  records: SettlementRecord[]
}

export class GradingSession {
  sessionRids: string[] = []
  sessionCurrentGradingItemIndex: Record<string, number> = {}
  sessionSettlementRids: string[] = []

  findNextUngradedGradingInfoId(
    gradingInfo: GradingInfoItem[],
    record: GradingRecord,
    fromId: number
  ): number | null {
    const startIndex = gradingInfo.findIndex((gi) => gi.id === fromId)
    const scanFrom = startIndex === -1 ? 0 : startIndex
    for (let i = scanFrom; i < gradingInfo.length; i++) {
      const gi = gradingInfo[i]
      if (!record.scores[gi.id]) {
        return gi.id
      }
    }
    return null
  }

  loadGradingItem(rid: string, gradingInfoId: number): GradingItemToGrade | null {
    const records = loadRecords()
    const record = records[rid]
    if (!record) return null

    const examPackage = loadExamPackage(rid)
    if (!examPackage) return null

    const gradingInfo = examPackage.gradingInfo
    if (!Array.isArray(gradingInfo)) return null

    const item = gradingInfo.find((gi) => gi.id === gradingInfoId)
    if (!item) return null

    const audioUrls: string[] = []
    for (const ri of item.recordIndices) {
      const audioPath = join(getGradingPath(), rid, 'recordings', `${ri}.mp3`)
      audioUrls.push(existsSync(audioPath) ? `grading-resource://${rid}/recordings/${ri}.mp3` : '')
    }

    const existingScore = record.scores[gradingInfoId]
      ? { score: record.scores[gradingInfoId].score, comment: record.scores[gradingInfoId].comment }
      : undefined

    return { rid, gradingInfoItem: item, audioUrls, existingScore }
  }

  start(rids: string[]): StartGradingResult {
    const records = loadRecords()

    this.sessionRids = []
    this.sessionCurrentGradingItemIndex = {}
    this.sessionSettlementRids = []

    let totalUngradedItems = 0
    let sessionCount = 0
    let firstSubmissionUngradedCount = 0
    const needsSettlementRids: string[] = []

    for (const rid of rids) {
      const record = records[rid]
      if (!record) continue
      if (record.status === 'completed') continue

      const pkg = loadExamPackage(rid)
      if (!pkg || !Array.isArray(pkg.gradingInfo)) continue

      const firstUngraded = this.findNextUngradedGradingInfoId(pkg.gradingInfo, record, 0)
      if (firstUngraded === null) {
        if (record.status === 'ungraded' || record.status === 'grading') {
          needsSettlementRids.push(rid)
        }
      } else {
        this.sessionRids.push(rid)
        this.sessionCurrentGradingItemIndex[rid] = firstUngraded
        sessionCount++

        let submissionUngradedCount = 0
        for (let i = 0; i < pkg.gradingInfo.length; i++) {
          if (!record.scores[pkg.gradingInfo[i].id]) {
            totalUngradedItems++
            submissionUngradedCount++
          }
        }
        if (this.sessionRids.length === 1) {
          firstSubmissionUngradedCount = submissionUngradedCount
        }
      }
    }

    this.sessionSettlementRids = needsSettlementRids

    if (this.sessionRids.length === 0) {
      if (needsSettlementRids.length > 0) {
        return {
          success: true,
          firstItem: null,
          ungradedCount: 0,
          sessionCount: 0,
          eid: '',
          needsSettlement: true,
          settlementRids: needsSettlementRids
        }
      }
      return {
        success: false,
        firstItem: null,
        ungradedCount: 0,
        sessionCount: 0,
        error: '没有需要批改的作答'
      }
    }

    const firstRid = this.sessionRids[0]
    const firstId = this.sessionCurrentGradingItemIndex[firstRid]
    const firstItem = this.loadGradingItem(firstRid, firstId)
    const eid = records[firstRid]?.eid || ''
    return {
      success: true,
      firstItem,
      ungradedCount: totalUngradedItems,
      sessionCount,
      eid,
      needsSettlement: needsSettlementRids.length > 0,
      settlementRids: needsSettlementRids,
      firstSubmissionUngradedCount
    }
  }

  submitScore(
    rid: string,
    gradingInfoId: number,
    score: number,
    comment: string
  ): SubmitScoreResult {
    const records = loadRecords()
    const record = records[rid]
    if (!record) return { success: false, nextItem: null, settle: false, error: '作答不存在' }

    record.scores[gradingInfoId] = {
      gradingInfoId,
      score,
      comment
    }
    if (record.status === 'ungraded') {
      record.status = 'grading'
    }
    saveRecords(records)

    const pkg = loadExamPackage(rid)
    const gradingInfo = pkg && Array.isArray(pkg.gradingInfo) ? pkg.gradingInfo : null

    if (gradingInfo && rid in this.sessionCurrentGradingItemIndex) {
      const nextUngraded = this.findNextUngradedGradingInfoId(
        gradingInfo,
        record,
        gradingInfoId + 1
      )
      if (nextUngraded !== null) {
        this.sessionCurrentGradingItemIndex[rid] = nextUngraded
        const nextItem = this.loadGradingItem(rid, nextUngraded)
        if (nextItem) {
          return { success: true, nextItem, settle: false }
        }
      }
    }

    if (!this.sessionSettlementRids.includes(rid)) {
      this.sessionSettlementRids.push(rid)
    }

    const currentIdx = this.sessionRids.indexOf(rid)
    if (currentIdx >= 0 && currentIdx < this.sessionRids.length - 1) {
      const nextRid = this.sessionRids[currentIdx + 1]
      const nextRecord = records[nextRid]
      const nextPkg = loadExamPackage(nextRid)
      const nextGradingInfo =
        nextPkg && Array.isArray(nextPkg.gradingInfo) ? nextPkg.gradingInfo : null
      if (nextGradingInfo && nextRecord) {
        const firstUngraded = this.findNextUngradedGradingInfoId(nextGradingInfo, nextRecord, 0)
        if (firstUngraded !== null) {
          this.sessionCurrentGradingItemIndex[nextRid] = firstUngraded
          const nextFromOther = this.loadGradingItem(nextRid, firstUngraded)
          let currentSubmissionUngradedCount = 0
          for (const gi of nextGradingInfo) {
            if (!nextRecord.scores[gi.id]) currentSubmissionUngradedCount++
          }
          return {
            success: true,
            nextItem: nextFromOther,
            settle: false,
            currentSubmissionUngradedCount
          }
        }
      }
      for (let i = currentIdx + 2; i < this.sessionRids.length; i++) {
        const skipRid = this.sessionRids[i]
        const skipRecord = records[skipRid]
        const skipPkg = loadExamPackage(skipRid)
        const skipGradingInfo =
          skipPkg && Array.isArray(skipPkg.gradingInfo) ? skipPkg.gradingInfo : null
        if (skipGradingInfo && skipRecord) {
          const ungraded = this.findNextUngradedGradingInfoId(skipGradingInfo, skipRecord, 0)
          if (ungraded !== null) {
            this.sessionCurrentGradingItemIndex[skipRid] = ungraded
            const nextFromSkip = this.loadGradingItem(skipRid, ungraded)
            let currentSubmissionUngradedCount = 0
            for (const gi of skipGradingInfo) {
              if (!skipRecord.scores[gi.id]) currentSubmissionUngradedCount++
            }
            return {
              success: true,
              nextItem: nextFromSkip,
              settle: false,
              currentSubmissionUngradedCount
            }
          }
        }
      }
    }

    return { success: true, nextItem: null, settle: true }
  }

  pause(): { success: boolean } {
    this.sessionRids = []
    this.sessionCurrentGradingItemIndex = {}
    this.sessionSettlementRids = []
    return { success: true }
  }

  finish(): { success: boolean; settlementCount: number } {
    const records = loadRecords()

    for (const rid of this.sessionRids) {
      if (this.sessionSettlementRids.includes(rid)) continue
      const record = records[rid]
      if (!record) continue
      const pkg = loadExamPackage(rid)
      if (!pkg || !Array.isArray(pkg.gradingInfo)) continue

      let allGraded = true
      for (const gi of pkg.gradingInfo) {
        if (!record.scores[gi.id]) {
          allGraded = false
          break
        }
      }
      if (allGraded) {
        this.sessionSettlementRids.push(rid)
      }
    }

    return { success: true, settlementCount: this.sessionSettlementRids.length }
  }

  getSettlementInfo(): SettlementInfo {
    const records = loadRecords()
    const settlementRecords: SettlementRecord[] = []

    const allRids = [...new Set([...this.sessionSettlementRids, ...this.sessionRids])]

    for (const rid of allRids) {
      const record = records[rid]
      if (!record) continue
      const pkg = loadExamPackage(rid)
      if (!pkg || !Array.isArray(pkg.gradingInfo)) continue

      let gradedCount = 0
      const totalItems = pkg.gradingInfo.length
      for (const gi of pkg.gradingInfo) {
        if (record.scores[gi.id]) gradedCount++
      }

      let status: 'canSettle' | 'grading' | 'ungraded'
      if (gradedCount === totalItems) {
        status = 'canSettle'
      } else if (gradedCount > 0) {
        status = 'grading'
      } else {
        status = 'ungraded'
      }

      settlementRecords.push({
        rid,
        studentName: record.student.name,
        studentId: record.student.studentId,
        examTitle: record.examTitle,
        gradedCount,
        totalItems,
        isFullyGraded: gradedCount === totalItems,
        status
      })
    }

    return { success: true, records: settlementRecords }
  }
}
