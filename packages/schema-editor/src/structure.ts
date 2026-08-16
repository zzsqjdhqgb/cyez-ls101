import type {
  SchemaAnswerDefinition,
  SchemaQuestionType,
  SchemaStructure,
  SchemaTemplateInputDefinition
} from '@ls101/core-types'

export const SCHEMA_QUESTION_DESCRIPTION_INPUT_ID = 'question-description'
export const SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID = 'analysis'
export const SCHEMA_REFERENCE_ANSWER_INPUT_ID = 'reference-answer'

export function schemaBuiltinInputDescription(
  questionType: SchemaQuestionType,
  inputId: string
): string | null {
  if (inputId === SCHEMA_QUESTION_DESCRIPTION_INPUT_ID) return '题目描述'
  if (questionType === 'objective' && inputId === SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID) return '解析'
  if (questionType !== 'objective' && inputId === SCHEMA_REFERENCE_ANSWER_INPUT_ID)
    return '参考答案'
  return null
}

export function isSchemaBuiltinInput(questionType: SchemaQuestionType, inputId: string): boolean {
  return schemaBuiltinInputDescription(questionType, inputId) !== null
}

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
  } else {
    builtins.push({ inputId: SCHEMA_REFERENCE_ANSWER_INPUT_ID, type: 'text', required: true })
  }
  return {
    questionType,
    answerFormat: [...structuredClone(answerFormat)],
    templateInputs: [
      ...builtins,
      ...structuredClone(additionalInputs).filter(
        (input) => !isSchemaBuiltinInput(questionType, input.inputId)
      )
    ]
  }
}
