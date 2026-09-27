import type { SchemaDefinition, SubmissionPackage } from '@ls101/core-types'

export const objectiveSchema: SchemaDefinition = {
  formatVersion: 2,
  schemaId: '10000000-0000-4000-8000-000000000001',
  sourceDraftId: '20000000-0000-4000-8000-000000000001',
  structureHash: `sha256:${'1'.repeat(64)}`,
  revision: 0,
  structure: {
    questionType: 'objective',
    answerFormat: [{ answerId: 'answer', type: 'text' }],
    templateInputs: [
      { inputId: 'question-description', type: 'text', required: true },
      { inputId: 'correct-answer', type: 'text', required: true },
      { inputId: 'analysis', type: 'text', required: false }
    ]
  },
  data: {
    name: '选择题',
    description: '客观题评分',
    maxScore: 2,
    answerDescriptions: { answer: '选择答案' },
    inputDescriptions: {},
    rubricMarkdown: ''
  }
}

export const readingSchema: SchemaDefinition = {
  formatVersion: 2,
  schemaId: '10000000-0000-4000-8000-000000000002',
  sourceDraftId: '20000000-0000-4000-8000-000000000002',
  structureHash: `sha256:${'2'.repeat(64)}`,
  revision: 0,
  structure: {
    questionType: 'fixed-reading',
    answerFormat: [{ answerId: 'reading', type: 'fixed-speech' }],
    templateInputs: [
      { inputId: 'question-description', type: 'text', required: true },
      { inputId: 'reference-answer', type: 'text', required: true }
    ]
  },
  data: {
    name: '朗读题',
    description: '人工朗读评分',
    maxScore: 5,
    answerDescriptions: { reading: '朗读录音' },
    inputDescriptions: {},
    rubricMarkdown: '根据发音准确度和表达流畅度评分。'
  }
}

export function objectiveSubmission(): SubmissionPackage {
  return {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId: 'submission-objective-docs',
      examPackageId: 'exam-docs',
      examTitle: '八年级英语听说练习',
      candidate: { candidateId: '2026002', displayName: '赵宁' },
      startedAt: '2026-08-14T08:00:00Z',
      submittedAt: '2026-08-14T08:20:00Z'
    },
    answers: { strings: ['A'], audios: [] },
    schemaUses: [
      {
        instanceId: 'objective-use',
        schema: objectiveSchema,
        inputs: [
          { inputId: 'question-description', type: 'text', value: '请选择正确答案。' },
          { inputId: 'correct-answer', type: 'text', value: 'A' },
          { inputId: 'analysis', type: 'text', value: '正确答案为 A。' }
        ],
        answers: [{ answerId: 'answer', type: 'text', stringAnswerIndex: 0 }]
      }
    ],
    resources: {}
  }
}

export function readingSubmission(): SubmissionPackage {
  return {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId: 'submission-reading-docs',
      examPackageId: 'exam-docs',
      examTitle: '八年级英语听说练习',
      candidate: { candidateId: '2026001', displayName: '张明' },
      startedAt: '2026-08-14T09:00:00Z',
      submittedAt: '2026-08-14T09:20:00Z'
    },
    answers: {
      strings: [],
      audios: [{ resourceKey: 'answer-audio-0', durationMs: 3200 }]
    },
    schemaUses: [
      {
        instanceId: 'reading-use',
        schema: readingSchema,
        inputs: [
          { inputId: 'question-description', type: 'text', value: '请朗读句子。' },
          {
            inputId: 'reference-answer',
            type: 'text',
            value: 'The weather is beautiful today.'
          }
        ],
        answers: [
          {
            answerId: 'reading',
            type: 'fixed-speech',
            text: 'The weather is beautiful today.',
            audioAnswerIndex: 0
          }
        ]
      }
    ],
    resources: {
      'answer-audio-0': {
        filename: 'reading.wav',
        packagePath: 'recordings/answer-audio-0/reading.wav',
        mediaType: 'audio/wav'
      }
    }
  }
}

/** 一份同时包含客观题和需要人工评分的朗读题的作答，用于演示单条评分入口。 */
export function mixedSubmission(): SubmissionPackage {
  return {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId: 'submission-mixed-docs',
      examPackageId: 'exam-docs',
      examTitle: '八年级英语听说练习',
      candidate: { candidateId: '2026003', displayName: '李华' },
      startedAt: '2026-08-14T10:00:00Z',
      submittedAt: '2026-08-14T10:20:00Z'
    },
    answers: {
      strings: ['A'],
      audios: [{ resourceKey: 'answer-audio-0', durationMs: 3200 }]
    },
    schemaUses: [
      {
        instanceId: 'objective-use',
        schema: objectiveSchema,
        inputs: [
          { inputId: 'question-description', type: 'text', value: '请选择正确答案。' },
          { inputId: 'correct-answer', type: 'text', value: 'A' },
          { inputId: 'analysis', type: 'text', value: '正确答案为 A。' }
        ],
        answers: [{ answerId: 'answer', type: 'text', stringAnswerIndex: 0 }]
      },
      {
        instanceId: 'reading-use',
        schema: readingSchema,
        inputs: [
          { inputId: 'question-description', type: 'text', value: '请朗读句子。' },
          {
            inputId: 'reference-answer',
            type: 'text',
            value: 'The weather is beautiful today.'
          }
        ],
        answers: [
          {
            answerId: 'reading',
            type: 'fixed-speech',
            text: 'The weather is beautiful today.',
            audioAnswerIndex: 0
          }
        ]
      }
    ],
    resources: {
      'answer-audio-0': {
        filename: 'reading.wav',
        packagePath: 'recordings/answer-audio-0/reading.wav',
        mediaType: 'audio/wav'
      }
    }
  }
}
