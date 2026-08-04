import type { TemplateContent, TemplateDocument } from './types'
import { deriveFunctionResourceId, isFunctionResourceId } from './id'
import { analyzeChoiceFrame, validateChoiceResult } from './validation/choice'
import {
  addError,
  createValidationState,
  validateInterfaceRequirements,
  type TemplateDocumentValidationContext,
  type TemplateValidationContext,
  type TemplateValidationError,
  type TemplateValidationResult
} from './validation/shared'
import { validateDefinitionScope } from './validation/scope'

export type {
  TemplateDocumentValidationContext,
  TemplateValidationContext,
  TemplateValidationError,
  TemplateValidationErrorCode,
  TemplateValidationResult
} from './validation/shared'

export async function validateTemplateDocument(
  document: TemplateDocument,
  context: TemplateDocumentValidationContext
): Promise<TemplateValidationResult> {
  const resourceErrors = await Promise.all(
    document.resources.functions.map(
      async (resource, index): Promise<TemplateValidationError | undefined> => {
        const path = `resources.functions[${index}].id`
        if (!isFunctionResourceId(resource.id)) {
          return {
            path,
            code: 'INVALID_FUNCTION_RESOURCE_ID' as const,
            params: { id: resource.id }
          }
        }

        const expected = await deriveFunctionResourceId(resource)
        return resource.id === expected
          ? undefined
          : {
              path,
              code: 'FUNCTION_RESOURCE_ID_MISMATCH' as const,
              params: { actual: resource.id, expected }
            }
      }
    )
  )
  const semantic = validateTemplateContent(document.content, {
    ...context,
    functions: document.resources.functions
  })
  const errors = [...resourceErrors.filter((error) => error !== undefined), ...semantic.errors]
  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors }
}

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
