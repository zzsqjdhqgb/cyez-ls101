import { strToU8, zipSync } from 'fflate'
import type { ExamPackage } from '@ls101/core-types'
import { validateExamPackage } from '@ls101/exam-package'
import type { Schema } from '@ls101/lab-contracts'
import { hash } from './identity'

export const TEST_SUITE: Schema<'TestSuite'> = {
  id: 'ls101-lab-deployment',
  version: '1',
  name: 'Lab deployment',
  cases: [
    { id: 'identity', name: 'Identity and connection', requiresManualConfirmation: false },
    { id: 'storage', name: 'Local durable storage', requiresManualConfirmation: false },
    { id: 'download', name: 'Verified exam download', requiresManualConfirmation: false },
    { id: 'playback', name: 'Local playback', requiresManualConfirmation: true },
    { id: 'audio', name: 'Microphone and headphones', requiresManualConfirmation: true },
    { id: 'submission', name: 'Submission receipt', requiresManualConfirmation: false },
    { id: 'duplicate', name: 'Duplicate request', requiresManualConfirmation: false },
    { id: 'recovery', name: 'Upload recovery', requiresManualConfirmation: false }
  ]
}

const exam: ExamPackage = {
  format: 'ls101-exam',
  formatVersion: 1,
  packageId: 'ls101-lab-test-v1',
  examData: {
    title: 'LS101 deployment test',
    resources: {},
    player: {
      pages: [
        {
          id: 'test',
          content: [{ id: 'title', type: 'text', x: 80, y: 120, text: 'LS101' }],
          timeline: [{ type: 'countdown', seconds: 2 }]
        }
      ],
      recordingIndices: []
    }
  },
  answerCapturePlan: { strings: [], audios: [] },
  submissionTemplate: {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: { examPackageId: 'ls101-lab-test-v1', examTitle: 'LS101 deployment test' },
    schemaUses: [],
    resources: {}
  }
}
validateExamPackage(exam)
export const TEST_EXAM_BYTES = zipSync(
  { 'manifest.json': strToU8(JSON.stringify(exam)) },
  { mtime: new Date('2026-01-01T00:00:00Z') }
)
export const TEST_EXAM_DIGEST = hash(TEST_EXAM_BYTES)
