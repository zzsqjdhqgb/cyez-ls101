import type { CompiledSchemaInput, SchemaDefinition } from './schema'

export type SubmissionFormatVersion = 1

export interface SubmissionCandidate {
  candidateId: string
  displayName: string
}

/** Template 编译器生成、ExamPlayer 只复制和补充动态字段的作答包静态部分。 */
export interface SubmissionTemplate {
  format: 'ls101-submission'
  formatVersion: SubmissionFormatVersion
  meta: {
    examPackageId: string
    examTitle: string
  }
  schemaUses: SubmissionSchemaUse[]
  resources: SubmissionResourceManifest
}

/** 可以脱离 ExamPackage 直接进入批改流程的作答清单。 */
export interface SubmissionPackage {
  format: 'ls101-submission'
  formatVersion: SubmissionFormatVersion
  meta: SubmissionMeta
  answers: SubmissionAnswers
  schemaUses: SubmissionSchemaUse[]
  resources: SubmissionResourceManifest
}

export interface SubmissionMeta {
  submissionId: string
  examPackageId: string
  examTitle: string
  candidate: SubmissionCandidate
  startedAt: string
  submittedAt: string
}

export interface SubmissionAnswers {
  strings: Array<string | null>
  audios: SubmissionAudioAnswer[]
}

export interface SubmissionAudioAnswer {
  resourceKey: string
  durationMs: number
}

/** 一次展开后的 SchemaUse，对应一个无需仓储查询的完整评分单元。 */
export interface SubmissionSchemaUse {
  instanceId: string
  schema: SchemaDefinition
  inputs: CompiledSchemaInput[]
  answers: SubmissionSchemaAnswer[]
}

export type SubmissionSchemaAnswer =
  | {
      answerId: string
      type: 'text'
      stringAnswerIndex: number
    }
  | {
      answerId: string
      type: 'fixed-speech'
      text: string
      audioAnswerIndex: number
    }
  | {
      answerId: string
      type: 'free-speech'
      audioAnswerIndex: number
    }

export type SubmissionResourceManifest = Record<string, SubmissionResourceEntry>

export interface SubmissionResourceEntry {
  filename: string
  packagePath: string
  mediaType?: string
}
