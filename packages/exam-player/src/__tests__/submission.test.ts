import type { ExamPackage, SchemaDefinition } from '@ls101/core-types'
import { describe, expect, it } from 'vitest'
import { assembleSubmission, SubmissionAssemblyError, type SubmissionAssemblyInput } from '../index'

const schema: SchemaDefinition = {
  formatVersion: 2,
  schemaId: `sha256:${'1'.repeat(64)}`,
  sourceDraftId: 'draft-1',
  structureHash: `sha256:${'2'.repeat(64)}`,
  revision: 3,
  structure: {
    questionType: 'fixed-reading',
    answerFormat: [{ answerId: 'sentence', type: 'fixed-speech' }],
    templateInputs: [{ inputId: 'question-description', type: 'text', required: true }]
  },
  data: {
    name: 'Reading',
    description: '',
    maxScore: 10,
    answerDescriptions: { sentence: 'Sentence' },
    inputDescriptions: {},
    rubricMarkdown: 'Accurate pronunciation'
  }
}

function examPackage(): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: 'exam-package-1',
    examData: {
      title: 'Oral exam',
      player: {
        pages: [],
        recordingIndices: [3],
        choiceMeta: {
          pages: [],
          questions: [
            {
              choiceIndex: 2,
              stem: 'Choose one',
              options: [{ label: 'B', content: 'Answer' }]
            }
          ]
        }
      },
      resources: {
        picture: {
          filename: 'picture.png',
          packagePath: 'resources/picture/picture.png',
          mediaType: 'image/png'
        }
      }
    },
    answerCapturePlan: {
      strings: [{ stringAnswerIndex: 0, choiceIndex: 2 }],
      audios: [{ audioAnswerIndex: 0, recordIndex: 3 }]
    },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: 'exam-package-1', examTitle: 'Oral exam' },
      schemaUses: [
        {
          instanceId: 'schema-use:reading',
          schema,
          inputs: [
            {
              inputId: 'question-description',
              type: 'text',
              value: 'Read ![picture](resource:picture)'
            }
          ],
          answers: [
            {
              answerId: 'sentence',
              type: 'fixed-speech',
              text: 'Hello world.',
              audioAnswerIndex: 0
            }
          ]
        }
      ],
      resources: {
        picture: {
          filename: 'picture.png',
          packagePath: 'resources/picture/picture.png',
          mediaType: 'image/png'
        }
      }
    }
  }
}

function input(overrides: Partial<SubmissionAssemblyInput> = {}): SubmissionAssemblyInput {
  return {
    submissionId: 'submission-1',
    candidate: { candidateId: 'student-1', displayName: 'Student' },
    startedAt: '2026-08-10T01:00:00.000Z',
    submittedAt: '2026-08-10T01:10:00.000Z',
    choiceAnswers: [undefined, undefined, 'B'],
    recordings: [
      undefined,
      undefined,
      undefined,
      { blob: new Blob(['audio'], { type: 'audio/ogg' }), durationMs: 1250 }
    ],
    ...overrides
  }
}

describe('assembleSubmission', () => {
  it('按捕获计划复制静态快照并填入答案池', () => {
    const exam = examPackage()
    const captured = input()
    const result = assembleSubmission(exam, captured)

    expect(result.submission).toMatchObject({
      format: 'ls101-submission',
      formatVersion: 1,
      meta: {
        submissionId: 'submission-1',
        examPackageId: 'exam-package-1',
        examTitle: 'Oral exam',
        candidate: { candidateId: 'student-1', displayName: 'Student' }
      },
      answers: {
        strings: ['B'],
        audios: [{ resourceKey: 'answer-audio-0', durationMs: 1250 }]
      }
    })
    expect(result.submission.schemaUses).toEqual(exam.submissionTemplate.schemaUses)
    expect(result.submission.schemaUses).not.toBe(exam.submissionTemplate.schemaUses)
    expect(result.submission.resources.picture).toEqual(exam.submissionTemplate.resources.picture)
    expect(result.submission.resources['answer-audio-0']).toEqual({
      filename: 'recording-0.ogg',
      packagePath: 'recordings/answer-audio-0/recording-0.ogg',
      mediaType: 'audio/ogg'
    })
    expect(result.files['answer-audio-0']).toBe(captured.recordings[3]?.blob)
    expect(exam.submissionTemplate.resources).not.toHaveProperty('answer-audio-0')
  })

  it('把未作答选择题保存为 null', () => {
    const result = assembleSubmission(
      examPackage(),
      input({ choiceAnswers: [undefined, undefined, '-'] })
    )
    expect(result.submission.answers.strings).toEqual([null])
  })

  it('拒绝缺失录音', () => {
    expect(() => assembleSubmission(examPackage(), input({ recordings: [] }))).toThrowError(
      expect.objectContaining<Partial<SubmissionAssemblyError>>({ code: 'MISSING_RECORDING' })
    )
  })

  it('拒绝不连续或重复的目标答案索引', () => {
    const exam = examPackage()
    exam.answerCapturePlan.strings = [
      { stringAnswerIndex: 0, choiceIndex: 0 },
      { stringAnswerIndex: 0, choiceIndex: 1 }
    ]

    expect(() => assembleSubmission(exam, input())).toThrowError(
      expect.objectContaining<Partial<SubmissionAssemblyError>>({ code: 'INVALID_CAPTURE_PLAN' })
    )
  })

  it('拒绝捕获计划引用不存在的 choiceIndex', () => {
    const exam = examPackage()
    exam.answerCapturePlan.strings[0].choiceIndex = 99

    expect(() => assembleSubmission(exam, input())).toThrowError(
      expect.objectContaining<Partial<SubmissionAssemblyError>>({ code: 'INVALID_EXAM_PACKAGE' })
    )
  })

  it('拒绝捕获计划引用不存在的 recordIndex', () => {
    const exam = examPackage()
    exam.answerCapturePlan.audios[0].recordIndex = 99

    expect(() => assembleSubmission(exam, input())).toThrowError(
      expect.objectContaining<Partial<SubmissionAssemblyError>>({ code: 'INVALID_EXAM_PACKAGE' })
    )
  })

  it.each([
    ['2026-08-10T01:00:00Z', '2026-08-10T01:10:00Z'],
    ['2026-08-10T09:00:00+08:00', '2026-08-10T09:10:00+08:00'],
    ['2026-08-10T01:00:00.123456Z', '2026-08-10T01:10:00.123456Z']
  ])('接受合法 ISO 8601 时间戳 %s', (startedAt, submittedAt) => {
    const result = assembleSubmission(examPackage(), input({ startedAt, submittedAt }))

    expect(result.submission.meta).toMatchObject({ startedAt, submittedAt })
  })

  it('拒绝不存在的 ISO 8601 日期', () => {
    expect(() =>
      assembleSubmission(examPackage(), input({ startedAt: '2026-02-30T01:00:00Z' }))
    ).toThrowError(
      expect.objectContaining<Partial<SubmissionAssemblyError>>({
        code: 'INVALID_SUBMISSION_META'
      })
    )
  })

  it('拒绝与 ExamPackage 不匹配的作答包副本', () => {
    const exam = examPackage()
    exam.submissionTemplate.meta.examPackageId = 'other-exam'

    expect(() => assembleSubmission(exam, input())).toThrowError(
      expect.objectContaining<Partial<SubmissionAssemblyError>>({ code: 'INVALID_EXAM_PACKAGE' })
    )
  })
})
