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
    resources: {
      image: {
        filename: 'display.bmp',
        packagePath: 'resources/display.bmp',
        mediaType: 'image/bmp'
      },
      tone: { filename: 'tone.wav', packagePath: 'resources/tone.wav', mediaType: 'audio/wav' }
    },
    player: {
      pages: [
        {
          id: 'test',
          content: [
            { id: 'title', type: 'text', x: 7, y: 8, text: 'LS101 部署测试', fontSize: 36 },
            {
              id: 'image',
              type: 'image',
              x: 7,
              y: 20,
              width: 30,
              height: 27,
              src: 'resource:image'
            },
            {
              id: 'choice',
              type: 'choice-view',
              x: 7,
              y: 53,
              width: 85,
              height: 32,
              defaultViewport: { mode: 'free' }
            }
          ],
          timeline: [
            { type: 'play', src: 'resource:tone' },
            { type: 'countdown', seconds: 8 }
          ]
        },
        {
          id: 'recording',
          content: [
            { id: 'recording-title', type: 'text', x: 7, y: 14, text: '麦克风测试', fontSize: 36 }
          ],
          timeline: [{ type: 'record', duration: 3, recordIndex: 0 }]
        }
      ],
      recordingIndices: [0],
      choiceMeta: {
        pages: [{ questionIndices: [0] }],
        questions: [
          {
            choiceIndex: 0,
            stem: '显示与选择测试',
            options: [
              { label: 'A', content: '确认' },
              { label: 'B', content: '异常' }
            ]
          }
        ]
      }
    }
  },
  answerCapturePlan: {
    strings: [{ stringAnswerIndex: 0, choiceIndex: 0 }],
    audios: [{ audioAnswerIndex: 0, recordIndex: 0 }]
  },
  submissionTemplate: {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: { examPackageId: 'ls101-lab-test-v1', examTitle: 'LS101 deployment test' },
    schemaUses: [],
    resources: {}
  }
}
validateExamPackage(exam)

// Deterministic bitmap and PCM tone travel through the same archive/resource path as exams.
const bitmap = Buffer.alloc(54 + 96 * 64 * 3)
bitmap.write('BM')
bitmap.writeUInt32LE(bitmap.length, 2)
bitmap.writeUInt32LE(54, 10)
bitmap.writeUInt32LE(40, 14)
bitmap.writeInt32LE(96, 18)
bitmap.writeInt32LE(64, 22)
bitmap.writeUInt16LE(1, 26)
bitmap.writeUInt16LE(24, 28)
for (let y = 0; y < 64; y++)
  for (let x = 0; x < 96; x++) bitmap[54 + (y * 96 + x) * 3 + Math.floor(x / 32)] = 220
const tone = Buffer.alloc(44 + 16000 * 2)
tone.write('RIFF')
tone.writeUInt32LE(tone.length - 8, 4)
tone.write('WAVEfmt ', 8)
tone.writeUInt32LE(16, 16)
tone.writeUInt16LE(1, 20)
tone.writeUInt16LE(1, 22)
tone.writeUInt32LE(16000, 24)
tone.writeUInt32LE(32000, 28)
tone.writeUInt16LE(2, 32)
tone.writeUInt16LE(16, 34)
tone.write('data', 36)
tone.writeUInt32LE(tone.length - 44, 40)
for (let i = 0; i < 16000; i++)
  tone.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / 16000) * 6000), 44 + i * 2)
export const TEST_EXAM_BYTES = zipSync(
  {
    'manifest.json': strToU8(JSON.stringify(exam)),
    'resources/display.bmp': bitmap,
    'resources/tone.wav': tone
  },
  { mtime: new Date('2026-01-01T00:00:00Z') }
)
export const TEST_EXAM_DIGEST = hash(TEST_EXAM_BYTES)
