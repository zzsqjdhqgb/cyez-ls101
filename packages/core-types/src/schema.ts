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
  /** 仅保存自定义 Template 输入的说明；内置输入说明由系统提供。 */
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

/** Template 在编译期已经解析完成的静态 Schema 输入。 */
export interface CompiledSchemaInput {
  inputId: string
  type: 'text'
  value: string
}
