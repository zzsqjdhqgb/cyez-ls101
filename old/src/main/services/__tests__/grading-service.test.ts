/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect } from 'vitest'
import { computeEid } from '../../utils'
import type { ExamPackage, StudentInfo } from '../../../shared/types'
import { createHash } from 'node:crypto'

describe('computeRid', () => {
  function computeRidTest(student: StudentInfo, eid: string, examPackage: ExamPackage): string {
    const content = JSON.stringify({
      name: student.name,
      studentId: student.studentId,
      eid,
      questions: examPackage.questions
    })
    return createHash('sha256').update(content).digest('hex')
  }

  it('produces consistent results for same inputs', () => {
    const student: StudentInfo = { name: '张三', studentId: '123456' }
    const eid = 'abc123'
    const examPackage: ExamPackage = {
      title: 'Test',
      questions: [{ id: 'q1', content: [], time: { type: 'countdown', seconds: 60 } }]
    }

    const rid1 = computeRidTest(student, eid, examPackage)
    const rid2 = computeRidTest(
      { name: '张三', studentId: '123456' },
      eid,
      examPackage
    )

    expect(rid1).toBe(rid2)
    expect(rid1).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(rid1)).toBe(true)
  })

  it('produces different results for different students', () => {
    const eid = 'abc123'
    const examPackage: ExamPackage = {
      title: 'Test',
      questions: [{ id: 'q1', content: [], time: { type: 'countdown', seconds: 60 } }]
    }

    const rid1 = computeRidTest(
      { name: '张三', studentId: '123456' },
      eid,
      examPackage
    )
    const rid2 = computeRidTest(
      { name: '李四', studentId: '123456' },
      eid,
      examPackage
    )

    expect(rid1).not.toBe(rid2)
  })

  it('produces different results for different eids', () => {
    const student: StudentInfo = { name: '张三', studentId: '123456' }
    const examPackage: ExamPackage = {
      title: 'Test',
      questions: [{ id: 'q1', content: [], time: { type: 'countdown', seconds: 60 } }]
    }

    const rid1 = computeRidTest(student, 'eid1', examPackage)
    const rid2 = computeRidTest(student, 'eid2', examPackage)

    expect(rid1).not.toBe(rid2)
  })
})

describe('computeEid', () => {
  it('produces consistent results for same exam', () => {
    const examPackage: ExamPackage = {
      title: 'Test Exam',
      questions: [
        { id: 'q1', content: [{ type: 'text', text: 'Hello' }], time: { type: 'countdown', seconds: 60 } }
      ]
    }

    const eid1 = computeEid(examPackage)
    const eid2 = computeEid(JSON.parse(JSON.stringify(examPackage)))

    expect(eid1).toBe(eid2)
    expect(eid1).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(eid1)).toBe(true)
  })

  it('produces different results for different exams', () => {
    const eid1 = computeEid({
      title: 'Exam A',
      questions: [
        { id: 'q1', content: [], time: { type: 'countdown', seconds: 60 } }
      ]
    })
    const eid2 = computeEid({
      title: 'Exam B',
      questions: [
        { id: 'q1', content: [], time: { type: 'countdown', seconds: 60 } }
      ]
    })

    expect(eid1).not.toBe(eid2)
  })

  it('ignores gradingInfo in hash computation', () => {
    const eid1 = computeEid({
      title: 'Test',
      questions: [],
      gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: 'a', gradingInfo: 'b', fullScore: 10 }]
    })
    const eid2 = computeEid({
      title: 'Test',
      questions: []
    })

    expect(eid1).toBe(eid2)
  })
})
