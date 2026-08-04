// @ls101/template-editor - 低代码图形化 Template 编辑器领域 API

export {
  canonicalizeFunctionContent,
  createFunctionDocument,
  createFunctionId,
  createFunctionResource,
  createTemplateDocument,
  createTemplateId,
  deriveFunctionResourceId,
  isFunctionResourceId,
  verifyFunctionResourceId
} from './id'
export { compileTemplate } from './compiler'
export type {
  TemplateCompileContext,
  TemplateCompileError,
  TemplateCompileErrorCode,
  TemplateCompileResult,
  TemplateInterfaceBinding
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
