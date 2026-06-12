/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userdata',
    isPackaged: false
  },
  net: {
    fetch: () => Promise.resolve(new Response())
  }
}))

vi.mock('../../utils', () => ({
  getGradingPath: () => '/tmp/test-grading',
  ensureDir: () => {},
  prefixContentNodesForExam: (nodes: unknown[], _id: string) => nodes,
  validateExamResources: () => [],
  computeEid: () => 'test-eid',
  isSafeMediaPath: () => true,
  copyDirRecursive: () => {}
}))

import { GradingSession } from '../grading-service/session'
import type { GradingInfoItem, GradingRecord } from '../../../shared/types'
import * as importModule from '../grading-service/import'

const mockGradingInfo: GradingInfoItem[] = [
  { id: 0, recordIndices: [0], problemInfo: 'Problem 1', gradingInfo: 'Grade 1', fullScore: 10 },
  { id: 1, recordIndices: [1], problemInfo: 'Problem 2', gradingInfo: 'Grade 2', fullScore: 15 }
]

const mockExamPackage = {
  title: 'Test Exam',
  questions: [],
  gradingInfo: mockGradingInfo
}

function createMockRecord(overrides: Partial<GradingRecord> = {}): GradingRecord {
  return {
    rid: 'rid1',
    status: 'ungraded',
    student: { name: 'Test', studentId: '001' },
    examTitle: 'Test Exam',
    eid: 'eid1',
    scores: {},
    ...overrides
  }
}

describe('GradingSession', () => {
  let session: GradingSession

  beforeEach(() => {
    session = new GradingSession()
  })

  describe('findNextUngradedGradingInfoId', () => {
    it('finds first ungraded item from beginning', () => {
      const record = createMockRecord()
      const result = session.findNextUngradedGradingInfoId(mockGradingInfo, record, 0)
      expect(result).toBe(0)
    })

    it('returns null when all items are graded', () => {
      const record = createMockRecord({
        scores: {
          0: { gradingInfoId: 0, score: 8, comment: 'good' },
          1: { gradingInfoId: 1, score: 12, comment: 'good' }
        }
      })
      const result = session.findNextUngradedGradingInfoId(mockGradingInfo, record, 0)
      expect(result).toBeNull()
    })

    it('skips already graded items', () => {
      const record = createMockRecord({
        scores: {
          0: { gradingInfoId: 0, score: 8, comment: 'good' }
        }
      })
      const result = session.findNextUngradedGradingInfoId(mockGradingInfo, record, 0)
      expect(result).toBe(1)
    })

    it('searches from given start id', () => {
      const record = createMockRecord()
      const result = session.findNextUngradedGradingInfoId(mockGradingInfo, record, 1)
      expect(result).toBe(1)
    })

    it('falls back to scanning from beginning when start id not found', () => {
      const record = createMockRecord()
      const result = session.findNextUngradedGradingInfoId(mockGradingInfo, record, 5)
      expect(result).toBe(0)
    })
  })

  describe('submitScore', () => {
    it('calculates next item from the same submission', () => {
      const records: Record<string, GradingRecord> = {
        rid1: createMockRecord()
      }

      vi.spyOn(importModule, 'loadRecords').mockReturnValue(records)
      vi.spyOn(importModule, 'saveRecords').mockImplementation(() => {})
      vi.spyOn(importModule, 'loadExamPackage').mockReturnValue(mockExamPackage as any)

      session.sessionRids = ['rid1']
      session.sessionCurrentGradingItemIndex = { rid1: 0 }

      const result = session.submitScore('rid1', 0, 8.5, 'Good job')
      expect(result.success).toBe(true)
      expect(result.settle).toBe(false)
      expect(result.nextItem).not.toBeNull()
    })

    it('settles when all items in submission are graded', () => {
      const records: Record<string, GradingRecord> = {
        rid1: createMockRecord({
          scores: {
            1: { gradingInfoId: 1, score: 12, comment: '' }
          },
          status: 'grading'
        })
      }

      vi.spyOn(importModule, 'loadRecords').mockReturnValue(records)
      vi.spyOn(importModule, 'saveRecords').mockImplementation(() => {})
      vi.spyOn(importModule, 'loadExamPackage').mockReturnValue(mockExamPackage as any)

      session.sessionRids = ['rid1']
      session.sessionCurrentGradingItemIndex = { rid1: 0 }
      session.sessionSettlementRids = []

      const result = session.submitScore('rid1', 0, 8.5, 'Good')
      expect(result.success).toBe(true)
      expect(result.settle).toBe(true)
      expect(session.sessionSettlementRids).toContain('rid1')
    })
  })

  describe('pause', () => {
    it('clears session state', () => {
      session.sessionRids = ['rid1', 'rid2']
      session.sessionCurrentGradingItemIndex = { rid1: 0, rid2: 0 }
      session.sessionSettlementRids = ['rid3']

      const result = session.pause()
      expect(result.success).toBe(true)
      expect(session.sessionRids).toHaveLength(0)
      expect(session.sessionCurrentGradingItemIndex).toEqual({})
      expect(session.sessionSettlementRids).toHaveLength(0)
    })
  })

  describe('finish', () => {
    it('adds fully graded submissions to settlement list', () => {
      const records: Record<string, GradingRecord> = {
        rid1: createMockRecord({
          scores: {
            0: { gradingInfoId: 0, score: 8, comment: '' },
            1: { gradingInfoId: 1, score: 12, comment: '' }
          },
          status: 'grading'
        })
      }

      vi.spyOn(importModule, 'loadRecords').mockReturnValue(records)
      vi.spyOn(importModule, 'loadExamPackage').mockReturnValue(mockExamPackage as any)

      session.sessionRids = ['rid1']
      session.sessionSettlementRids = []

      const result = session.finish()
      expect(result.success).toBe(true)
      expect(result.settlementCount).toBe(1)
    })
  })
})
