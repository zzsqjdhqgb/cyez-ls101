// @ls101/core-types - Schema 向 Template 暴露的跨模块契约

/** Schema 评分块可以要求 Template 提供的字段类型。 */
export type SchemaFieldType = 'text' | 'audio' | 'choice'

/** 一个评分块字段的公开定义。 */
export interface SchemaFieldDef {
  varName: string
  type: SchemaFieldType
}

/**
 * Schema Editor 提供给 Template Editor 的只读清单。
 * 评分规则和内部实现不通过此结构暴露。
 */
export interface SchemaBlockManifest {
  schemaId: string
  schemaName: string
  blocks: SchemaBlockManifestEntry[]
}

export interface SchemaBlockManifestEntry {
  blockId: string
  blockName: string
  fields: SchemaFieldDef[]
}
