// @ls101/template-editor - 低代码图形化 Template 编辑器领域 API

export { createTemplateApplication, TemplateApplicationError } from './application'
export { TemplateRepositoryError } from './repository'
export type {
  EmbeddedFunctionResult,
  BuiltinTemplateApplication,
  BuiltinTemplateSummary,
  InsertedFunctionCallResult,
  FunctionLibraryApplication,
  FunctionLibrarySummary,
  FunctionSummary,
  ImportedFunctionLibraryApplication,
  LocalFunctionLibraryApplication,
  TemplateApplication,
  TemplateApplicationDependencies,
  TemplateBrowserApplication,
  TemplateCompileOptions,
  TemplateDocumentApplication,
  TemplateInterfaceInstanceSummary,
  TemplateImportInspection,
  TemplateImportMode,
  TemplateSummary
} from './application'

export { editFunctionDocument, editTemplateDocument } from './mutations'
export type {
  DefinitionOperation,
  DocumentEditChange,
  DocumentEditError,
  DocumentEditErrorCode,
  DocumentEditResult,
  FunctionCallSignature,
  FunctionDocumentOperation,
  TemplateDocumentOperation
} from './mutations'

export {
  canonicalizeBuiltinTemplateDocument,
  canonicalizeFunctionContent,
  canonicalizeFunctionLibraryContent,
  createFunctionDocument,
  createFunctionId,
  createFunctionLibraryId,
  createFunctionLibraryRelease,
  createFunctionResource,
  createLocalFunctionLibraryDocument,
  createTemplateDocument,
  createTemplateId,
  createBuiltinTemplateRelease,
  deriveBuiltinTemplateReleaseHash,
  deriveFunctionResourceId,
  deriveFunctionLibraryContentHash,
  isFunctionResourceId,
  verifyFunctionLibraryRelease,
  verifyFunctionResourceId,
  verifyBuiltinTemplateRelease
} from './id'
export { compileTemplate, compileTemplatePreview } from './compiler'
export {
  parseBuiltinTemplateRelease,
  parseFunctionLibraryRelease,
  parseTemplateDocument
} from './document-parser'
export type {
  TemplateCompileContext,
  TemplateCompileError,
  TemplateCompileErrorCode,
  TemplateCompileResult,
  TemplatePreviewData,
  TemplatePreviewPage,
  TemplatePreviewResult,
  TemplatePreviewTimelineStep,
  GeneratedTimelineAudio,
  ExamResourceSource,
  TemplateInterfaceBinding,
  LocatedInterfaceInstance
} from './compiler'
export { validateTemplateContent, validateTemplateDocument } from './validation'
export { normalizeTemplateTags } from './tags'
export type {
  TemplateDocumentValidationContext,
  TemplateValidationContext,
  TemplateValidationError,
  TemplateValidationErrorCode,
  TemplateValidationResult
} from './validation'
export type * from './types'
