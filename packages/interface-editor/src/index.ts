// @ls101/interface-editor — Interface（题型）编辑器

// 类型定义 → src/types.ts
export type {
  FieldLeaf,
  FieldGroup,
  FieldNode,
  InterfaceContent,
  InterfaceDraft,
  InterfaceDef
} from './types'

// ID → src/id.ts
export {
  createDraftId,
  createInterfaceDraft,
  deriveInterfaceId,
  publishInterface,
  verifyInterfaceId,
  compareInterfaceIdentity,
  isInterfaceId,
  canonicalizeInterfaceContent
} from './id'
export type { InterfaceIdentityComparison } from './id'

// 领域存储与交换 → src/repository.ts, src/exchange.ts
export { FileInterfaceRepository, InterfaceRepositoryError } from './repository'
export type {
  InterfaceRepository,
  InterfaceStore,
  StoredInterfaceInstance,
  LocatedInterfaceInstance,
  BuiltinInterfaceEntry,
  SaveEntityResult
} from './repository'
export { classifyBuiltinUpdate, planBuiltinUpdate, applyBuiltinUpdate } from './builtin'
export type {
  BuiltinUpdateKind,
  ManualBuiltinUpdateChoice,
  BuiltinUpdatePlan,
  BuiltinUpdateResult,
  InterfaceReferenceMigrator
} from './builtin'
export { exportInterfacePackage, inspectInterfacePackage, importInterfacePackage } from './exchange'
export type {
  InterfaceExchangePackage,
  InterfaceExchangeInstance,
  InstanceSelection,
  InterfacePackageInspection,
  InterfacePackageImportOptions,
  InterfacePackageImportResult
} from './exchange'
export { encodeInterfaceZip, decodeInterfaceZip } from './zip'
export {
  exportInterfaceFile,
  readInterfaceFile,
  inspectInterfaceFile,
  importInterfaceFile
} from './fileExchange'
export type {
  InterfaceFileDialog,
  InterfaceFileReadResult,
  InterfaceFileImportResult
} from './fileExchange'

// 字段树查询 → src/queries.ts
export { flattenFields, findNodeByPath, getAllVarNames } from './queries'

// 字段树编辑 → src/mutations.ts
export { addNode, updateNode, renameNode, removeNode } from './mutations'

// JSON Schema 生成与校验 → src/schema.ts
export { buildJsonSchema, buildJsonExample, validateJson } from './schema'
export type { JsonValidationResult } from './schema'

// 转换 → src/conversions.ts
export { buildAIPrompt, buildVarManifest, buildInstanceFromJson } from './conversions'

// 校验 → src/validation.ts
export { validateInterfaceDef, success, failure } from './validation'
export type { ValidationErrorCode, ValidationError, ValidationResult } from './validation'
export { formatError, formatErrors } from './errorMessages'

// 跨模块类型（定义在 @ls101/core-types，此处便捷引用）
export type { InterfaceVarInfo, InterfaceVarManifest, InterfaceInstance } from '@ls101/core-types'
