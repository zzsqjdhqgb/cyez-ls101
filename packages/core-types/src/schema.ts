// @ls101/core-types - Schema 结构、草稿/正式数据与评分结果契约

/** 新 Schema 数据格式版本。 */
export type SchemaFormatVersion = 2

/** Schema 选择的评分数据管道。 */
export type SchemaQuestionType = 'objective' | 'fixed-reading' | 'freetalk'

/** 学生答案槽位的语义类型。 */
export type SchemaAnswerType = 'text' | 'fixed-speech' | 'free-speech'

/** Schema 向 Template 暴露的静态文本输入类型。 */
export type SchemaTemplateInputType = 'text'

/** 一个正式 Schema 的不可变结构契约。 */
export interface SchemaStructure {
  questionType: SchemaQuestionType
  answerFormat: SchemaAnswerDefinition[]
  templateInputs: SchemaTemplateInputDefinition[]
}

/** 一个答案槽位；发布后 answerId、type 和顺序不可变。 */
export interface SchemaAnswerDefinition {
  answerId: string
  type: SchemaAnswerType
}

/** 一个 Schema 静态文本输入；发布后 inputId、type 和 required 不可变。 */
export interface SchemaTemplateInputDefinition {
  inputId: string
  type: SchemaTemplateInputType
  required: boolean
}

/** 正式 Schema 可修改的题型数据。 */
export interface SchemaData {
  name: string
  description: string
  maxScore: number
  answerDescriptions: Record<string, string>
  inputDescriptions: Record<string, string>
  rubricMarkdown: string
  extraPromptMarkdown?: string
}

/** 只定义结构的 Schema 草稿。 */
export interface SchemaDraft {
  draftId: string
  revision: number
  name: string
  structure: SchemaStructure
}

/** Schema 草稿库工作文档。 */
export interface SchemaDraftLibraryDocument {
  libraryId: string
  revision: number
  name: string
  drafts: SchemaDraft[]
}

/** 一个已发布、可修改数据但冻结结构的正式 Schema。 */
export interface SchemaDefinition {
  formatVersion: SchemaFormatVersion
  schemaId: string
  sourceDraftId: string
  structureHash: string
  revision: number
  structure: SchemaStructure
  data: SchemaData
}

/** Grading Engine 的正常评分结果。 */
export interface GradingResult {
  score: number
  /** Markdown 评语。 */
  comment: string
}

// ============================================================
// Template 编译适配层（待 Template 迁移完成后删除）
// ============================================================

/** 旧 Schema 编译管道的数据格式版本。 */
export type LegacySchemaFormatVersion = 1

/** @deprecated 旧 Template 适配层的输入类型。 */
export type SchemaInputType = 'string' | 'audio'

/** @deprecated 旧 Template 适配层的评分定义。 */
export interface LegacySchemaContent {
  name: string
  blocks: LegacySchemaBlockDefinition[]
}

/** @deprecated 使用 SchemaDefinition。 */
export interface LegacySchemaDefinition extends LegacySchemaContent {
  formatVersion: LegacySchemaFormatVersion
  schemaId: string
}

/** @deprecated 使用 SchemaAnswerDefinition 和 SchemaStructure。 */
export interface LegacySchemaBlockDefinition {
  blockId: string
  name: string
  maxScore: number
  inputs: LegacySchemaInputDefinition[]
}

/** @deprecated 使用 SchemaTemplateInputDefinition。 */
export interface LegacySchemaInputDefinition {
  inputId: string
  name: string
  type: SchemaInputType
}

/** @deprecated 旧 Template 编译后的 Schema 数据管道。 */
export interface CompiledSchemaPipeline {
  formatVersion: LegacySchemaFormatVersion
  definitions: LegacySchemaDefinition[]
  blocks: CompiledSchemaBlock[]
}

/** @deprecated 旧 Template 展开后的评分块绑定。 */
export interface CompiledSchemaBlock {
  instanceId: string
  schemaId: string
  blockId: string
  inputs: CompiledSchemaInput[]
}

/** @deprecated 旧 Template 的输入绑定。 */
export type CompiledSchemaInput =
  | {
      inputId: string
      type: 'string'
      source: 'static'
      value: string
    }
  | {
      inputId: string
      type: 'string'
      source: 'choice'
      choiceIndex: number
    }
  | {
      inputId: string
      type: 'audio'
      source: 'recording'
      recordIndex: number
    }

/** @deprecated 旧 ExamPlayer 运行期数据。 */
export interface SchemaRuntimeData {
  recordings: Readonly<Record<number, string>>
  choices: Readonly<Record<number, string | null>>
}

/** @deprecated 旧 Schema 实例集合。 */
export interface SchemaInstanceBundle {
  formatVersion: LegacySchemaFormatVersion
  schemas: SchemaInstance[]
}

/** @deprecated 使用 Grading Engine 的解析输入。 */
export interface SchemaInstance {
  schemaId: string
  name: string
  blocks: SchemaBlockInstance[]
}

/** @deprecated 旧评分块实例。 */
export interface SchemaBlockInstance {
  instanceId: string
  blockId: string
  name: string
  maxScore: number
  inputs: SchemaInstanceInput[]
}

export type SchemaMissingReason = 'unanswered' | 'recording-missing'

/** @deprecated 旧 Schema 实例输入。 */
export type SchemaInstanceInput =
  | {
      inputId: string
      name: string
      type: 'string'
      status: 'resolved'
      value: string
    }
  | {
      inputId: string
      name: string
      type: 'audio'
      status: 'resolved'
      assetKey: string
    }
  | {
      inputId: string
      name: string
      type: SchemaInputType
      status: 'missing'
      reason: SchemaMissingReason
    }

/** @deprecated 使用 SchemaInputType。 */
export type SchemaFieldType = SchemaInputType
/** @deprecated 使用 LegacySchemaInputDefinition。 */
export type SchemaFieldDef = LegacySchemaInputDefinition
/** @deprecated 使用 SchemaDefinition。 */
export type SchemaBlockManifest = LegacySchemaDefinition
/** @deprecated 使用 LegacySchemaBlockDefinition。 */
export type SchemaBlockManifestEntry = LegacySchemaBlockDefinition
