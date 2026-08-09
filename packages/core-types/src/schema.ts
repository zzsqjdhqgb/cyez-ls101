// @ls101/core-types - Template、ExamPlayer 与批改引擎共享的 Schema 数据管道契约

/** 当前固定的 Schema 数据格式版本。 */
export type SchemaFormatVersion = 1

/** Schema 接入口最终向批改引擎提供的数据类型。 */
export type SchemaInputType = 'string' | 'audio'

/** 创建内容寻址 SchemaDefinition 时使用的可编辑内容。 */
export interface SchemaContent {
  name: string
  blocks: SchemaBlockDefinition[]
}

/**
 * 一份不可变的数据管道定义。Schema 不包含评分实现，只描述批改输入的形状和满分。
 */
export interface SchemaDefinition extends SchemaContent {
  formatVersion: SchemaFormatVersion
  schemaId: string
}

/** 一个实际评分块。第一版不区分可复用块定义与块实例。 */
export interface SchemaBlockDefinition {
  blockId: string
  name: string
  maxScore: number
  inputs: SchemaInputDefinition[]
}

/** 评分块的一个具名数据接入口。 */
export interface SchemaInputDefinition {
  inputId: string
  name: string
  type: SchemaInputType
}

/**
 * Template 编译后的 Schema 数据管道。定义快照随 ExamPackage 保存，批改端不依赖作者态仓储。
 */
export interface CompiledSchemaPipeline {
  formatVersion: SchemaFormatVersion
  definitions: SchemaDefinition[]
  blocks: CompiledSchemaBlock[]
}

/** Template 展开后的一次评分块数据绑定。instanceId 在整份试卷内唯一。 */
export interface CompiledSchemaBlock {
  instanceId: string
  schemaId: string
  blockId: string
  inputs: CompiledSchemaInput[]
}

/**
 * string 接入口可以来自编译期静态字符串或学生的运行期选择结果；
 * audio 接入口只能来自 ExamPlayer 的录音槽位。
 */
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

/** ExamPlayer 运行结束后提供给 Schema 实例化器的数据。 */
export interface SchemaRuntimeData {
  recordings: Readonly<Record<number, string>>
  choices: Readonly<Record<number, string | null>>
}

/** 一份 ExamPackage 中所有 Schema 的已解析实例集合。 */
export interface SchemaInstanceBundle {
  formatVersion: SchemaFormatVersion
  schemas: SchemaInstance[]
}

/** 供一个强依赖该 schemaId 的 Grading Engine 消费的数据。 */
export interface SchemaInstance {
  schemaId: string
  name: string
  blocks: SchemaBlockInstance[]
}

export interface SchemaBlockInstance {
  instanceId: string
  blockId: string
  name: string
  maxScore: number
  inputs: SchemaInstanceInput[]
}

export type SchemaMissingReason = 'unanswered' | 'recording-missing'

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
/** @deprecated 使用 SchemaInputDefinition。 */
export type SchemaFieldDef = SchemaInputDefinition
/** @deprecated 使用 SchemaDefinition。 */
export type SchemaBlockManifest = SchemaDefinition
/** @deprecated 使用 SchemaBlockDefinition。 */
export type SchemaBlockManifestEntry = SchemaBlockDefinition
