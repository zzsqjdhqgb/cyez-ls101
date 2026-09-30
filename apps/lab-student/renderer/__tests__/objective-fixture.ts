import type {
  SchemaDefinition,
  SchemaStructure,
  SubmissionPackage,
  SubmissionSchemaUse
} from '@ls101/core-types'
import { encodeSubmissionPackage } from '@ls101/exam-package'
import { deriveSchemaStructureHash } from '@ls101/schema-editor/package-validation'

/** 与正式 Schema 校验规则一致的客观题结构：单文本答案 + 三个内置输入。 */
export async function objectiveSchema(name: string, maxScore: number): Promise<SchemaDefinition> {
  const structure: SchemaStructure = {
    questionType: 'objective',
    answerFormat: [{ answerId: 'choice', type: 'text' }],
    templateInputs: [
      { inputId: 'question-description', type: 'text', required: true },
      { inputId: 'correct-answer', type: 'text', required: true },
      { inputId: 'analysis', type: 'text', required: false }
    ]
  }
  return {
    formatVersion: 2,
    schemaId: crypto.randomUUID(),
    sourceDraftId: crypto.randomUUID(),
    structureHash: await deriveSchemaStructureHash(structure),
    revision: 1,
    structure,
    data: {
      name,
      description: `${name} 的题面说明`,
      maxScore,
      answerDescriptions: { choice: '选项' },
      inputDescriptions: {},
      rubricMarkdown: ''
    }
  }
}

/** 与正式 Schema 校验规则一致的主观题（朗读）结构，用于混合卷测试。 */
export async function subjectiveSchema(name: string, maxScore: number): Promise<SchemaDefinition> {
  const structure: SchemaStructure = {
    questionType: 'fixed-reading',
    answerFormat: [{ answerId: 'sentence', type: 'fixed-speech' }],
    templateInputs: [
      { inputId: 'question-description', type: 'text', required: true },
      { inputId: 'reference-answer', type: 'text', required: true }
    ]
  }
  return {
    formatVersion: 2,
    schemaId: crypto.randomUUID(),
    sourceDraftId: crypto.randomUUID(),
    structureHash: await deriveSchemaStructureHash(structure),
    revision: 1,
    structure,
    data: {
      name,
      description: `${name} 的题面说明`,
      maxScore,
      answerDescriptions: { sentence: '朗读句' },
      inputDescriptions: {},
      rubricMarkdown: '发音准确'
    }
  }
}

export function objectiveUse(
  instanceId: string,
  schema: SchemaDefinition,
  correctAnswer: string,
  options: { analysis?: string; description?: string; stringAnswerIndex?: number } = {}
): SubmissionSchemaUse {
  return {
    instanceId,
    schema,
    inputs: [
      { inputId: 'question-description', type: 'text', value: options.description ?? '题干' },
      { inputId: 'correct-answer', type: 'text', value: correctAnswer },
      { inputId: 'analysis', type: 'text', value: options.analysis ?? '' }
    ],
    answers: [
      { answerId: 'choice', type: 'text', stringAnswerIndex: options.stringAnswerIndex ?? 0 }
    ]
  }
}

export function subjectiveUse(instanceId: string, schema: SchemaDefinition): SubmissionSchemaUse {
  return {
    instanceId,
    schema,
    inputs: [
      { inputId: 'question-description', type: 'text', value: '朗读题干' },
      { inputId: 'reference-answer', type: 'text', value: '参考答案' }
    ],
    answers: [
      { answerId: 'sentence', type: 'fixed-speech', text: '参考答案', audioAnswerIndex: 0 }
    ]
  }
}

function submissionPackage(
  uses: readonly SubmissionSchemaUse[],
  strings: Array<string | null>,
  submissionId = 'submission-objective-1'
): SubmissionPackage {
  return {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId,
      examPackageId: 'exam-package-1',
      examTitle: '客观题练习',
      candidate: { candidateId: '001', displayName: '学生' },
      startedAt: '2026-09-22T01:00:00.000Z',
      submittedAt: '2026-09-22T01:10:00.000Z'
    },
    answers: { strings, audios: [] },
    schemaUses: [...uses],
    resources: {}
  }
}

async function toBlob(
  submission: SubmissionPackage,
  files: Record<string, Uint8Array>
): Promise<Blob> {
  const bytes = await encodeSubmissionPackage(submission, files)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return new Blob([buffer], { type: 'application/x-ls101-submission' })
}

/** 纯客观卷：第一题答对（2 分），第二题答错（0/3 分）。 */
export async function objectiveArchive(submissionId?: string): Promise<Blob> {
  const uses = [
    objectiveUse('schema-use:q1', await objectiveSchema('单项选择一', 2), 'A', {
      analysis: '选 A 是正确的。',
      stringAnswerIndex: 0
    }),
    objectiveUse('schema-use:q2', await objectiveSchema('单项选择二', 3), 'B', {
      stringAnswerIndex: 1
    })
  ]
  return toBlob(submissionPackage(uses, ['A', 'C'], submissionId), {})
}

/** 纯客观卷，但学生全部未作答。 */
export async function unansweredArchive(): Promise<Blob> {
  const uses = [
    objectiveUse('schema-use:q1', await objectiveSchema('单项选择一', 2), 'A', {
      stringAnswerIndex: 0
    }),
    objectiveUse('schema-use:q2', await objectiveSchema('单项选择二', 3), 'B', {
      stringAnswerIndex: 1
    })
  ]
  return toBlob(submissionPackage(uses, [null, null]), {})
}

/** 混合卷：一道客观题 + 一道朗读题。 */
export async function mixedArchive(submissionId?: string): Promise<Blob> {
  const submission = submissionPackage(
    [
      objectiveUse('schema-use:q1', await objectiveSchema('单项选择一', 2), 'A', {
        stringAnswerIndex: 0
      }),
      subjectiveUse('schema-use:q2', await subjectiveSchema('朗读', 8))
    ],
    ['A'],
    submissionId
  )
  submission.answers.audios = [{ resourceKey: 'answer-audio-0', durationMs: 1000 }]
  submission.resources['answer-audio-0'] = {
    filename: 'recording-0.webm',
    packagePath: 'recordings/answer-audio-0/recording-0.webm',
    mediaType: 'audio/webm'
  }
  return toBlob(submission, { 'answer-audio-0': new Uint8Array([1, 2, 3, 4]) })
}

/** 没有评分单元的空卷。 */
export async function emptyArchive(): Promise<Blob> {
  return toBlob(submissionPackage([], []), {})
}
