// @ls101/interface-editor — Interface（题型）编辑器

// 类型定义 → src/types.ts
export type { FieldLeaf, FieldGroup, FieldNode, InterfaceDef } from './types'

// 字段树查询 → src/queries.ts
export { flattenFields, findNodeByPath, getAllVarNames } from './queries'

// JSON Schema 生成与校验 → src/schema.ts
export { buildJsonSchema, buildJsonExample, validateJson } from './schema'
export type { JsonValidationResult } from './schema'

// 转换 → src/conversions.ts
export { buildAIPrompt, buildVarManifest, buildInstanceFromJson } from './conversions'

// 校验 → src/validation.ts
export { validateInterfaceDef, success, failure } from './validation'
export type { ValidationErrorCode, ValidationError, ValidationResult } from './validation'

// 跨模块类型（定义在 @ls101/core-types，此处便捷引用）
export type { InterfaceVarInfo, InterfaceVarManifest, InterfaceInstance } from '@ls101/core-types'
