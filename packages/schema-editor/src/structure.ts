import type {
  SchemaAnswerDefinition,
  SchemaQuestionType,
  SchemaStructure,
  SchemaTemplateInputDefinition
} from '@ls101/core-types'

export const SCHEMA_QUESTION_DESCRIPTION_INPUT_ID = 'question-description'
export const SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID = 'analysis'

export function createSchemaStructure(
  questionType: SchemaQuestionType,
  answerFormat: readonly SchemaAnswerDefinition[],
  additionalInputs: readonly SchemaTemplateInputDefinition[] = []
): SchemaStructure {
  const builtins: SchemaTemplateInputDefinition[] = [
    { inputId: SCHEMA_QUESTION_DESCRIPTION_INPUT_ID, type: 'text', required: true }
  ]
  if (questionType === 'objective') {
    builtins.push({ inputId: SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID, type: 'text', required: true })
  }
  return {
    questionType,
    answerFormat: [...structuredClone(answerFormat)],
    templateInputs: [...builtins, ...structuredClone(additionalInputs)]
  }
}
