// @ls101/template-editor - 低代码图形化 Template 编辑器领域 API

export {
  canonicalizeTemplateContent,
  compareTemplateIdentity,
  createTemplateDraft,
  createTemplateDraftId,
  deriveTemplateId,
  isTemplateId,
  publishTemplate,
  verifyTemplateId
} from './id'

export type { TemplateIdentityComparison } from './id'
export type * from './types'
