// @ls101/interface-editor — Interface（题型）编辑器
//
// 逻辑模块待实现:
//   3. buildAIPrompt(def) → string       — 拼接 promptTemplate + fields JSON 描述（发给 LLM）
//   4. parseAIResponse(def, rawJSON)     — 校验 LLM 返回的结构，映射 varName → value
//   5. createInstance(def, values)       — 包装为 InterfaceInstance
//   6. buildVarManifest(def)             — 生成 InterfaceVarManifest（供 Template 导入）

// 类型定义 → src/types.ts
export type { FieldLeaf, FieldGroup, FieldNode, InterfaceDef } from './types'

// 字段树查询 → src/queries.ts
export { flattenFields, findNodeByPath, getAllVarNames } from './queries'

// 校验 → src/validation.ts
export { validateInterfaceDef, success, failure } from './validation'
export type { ValidationErrorCode, ValidationError, ValidationResult } from './validation'

// 跨模块类型（定义在 @ls101/core-types，此处便捷引用）
export type { InterfaceVarInfo, InterfaceVarManifest, InterfaceInstance } from '@ls101/core-types'
