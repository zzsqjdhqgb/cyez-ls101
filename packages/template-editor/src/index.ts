// @ls101/template-editor - 低代码图形化 Template 编辑器领域 API

export { createTemplateApplication, TemplateApplicationError } from './application'
export type {
  EmbeddedFunctionResult,
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
  deriveFunctionResourceId,
  deriveFunctionLibraryContentHash,
  isFunctionResourceId,
  verifyFunctionLibraryRelease,
  verifyFunctionResourceId
} from './id'
export { compileTemplate, compileTemplatePreview } from './compiler'
export { parseFunctionLibraryRelease } from './document-parser'
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
export type {
  TemplateDocumentValidationContext,
  TemplateValidationContext,
  TemplateValidationError,
  TemplateValidationErrorCode,
  TemplateValidationResult
} from './validation'
export type * from './types'
