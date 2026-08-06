// @ls101/template-editor - 低代码图形化 Template 编辑器领域 API

export { createTemplateApplication, TemplateApplicationError } from './application'
export type {
  EmbeddedFunctionResult,
  InsertedFunctionCallResult,
  FunctionLibraryApplication,
  FunctionLibrarySummary,
  FunctionSummary,
  LocalFunctionLibraryApplication,
  TemplateApplication,
  TemplateApplicationDependencies,
  TemplateBrowserApplication,
  TemplateDocumentApplication,
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
export { compileTemplate } from './compiler'
export type {
  TemplateCompileContext,
  TemplateCompileError,
  TemplateCompileErrorCode,
  TemplateCompileResult,
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
