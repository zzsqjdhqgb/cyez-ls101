import type { TemplateContent } from './types'
import { analyzeChoiceFrame, validateChoiceResult } from './validation/choice'
import {
  addError,
  createValidationState,
  validateInterfaceRequirements,
  type TemplateValidationContext,
  type TemplateValidationResult
} from './validation/shared'
import { validateDefinitionScope } from './validation/scope'

export type {
  TemplateValidationContext,
  TemplateValidationError,
  TemplateValidationErrorCode,
  TemplateValidationResult
} from './validation/shared'

export function validateTemplateContent(
  content: TemplateContent,
  context: TemplateValidationContext
): TemplateValidationResult {
  const state = createValidationState(context)

  if (!content.name.trim()) addError(state, '', 'EMPTY_TEMPLATE_NAME')

  validateInterfaceRequirements(content, state)
  validateDefinitionScope(content.root, content.schemaUses, [], [], 'root', [], state)

  const choice = analyzeChoiceFrame(content.root, 'root', [], state)
  validateChoiceResult(choice, state)

  if (state.schemaUseCount === 0) addError(state, 'schemaUses', 'NO_SCHEMA_USE')

  return state.errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors: state.errors }
}
