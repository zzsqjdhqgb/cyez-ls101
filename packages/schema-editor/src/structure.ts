import type {
  SchemaAnswerDefinition,
  SchemaQuestionType,
  SchemaStructure,
  SchemaTemplateInputDefinition
} from '@ls101/core-types'
import {
  SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID,
  SCHEMA_OBJECTIVE_CORRECT_ANSWER_INPUT_ID,
  SCHEMA_QUESTION_DESCRIPTION_INPUT_ID,
  SCHEMA_REFERENCE_ANSWER_INPUT_ID
} from '@ls101/core-types'

export {
  SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID,
  SCHEMA_OBJECTIVE_CORRECT_ANSWER_INPUT_ID,
  SCHEMA_QUESTION_DESCRIPTION_INPUT_ID,
  SCHEMA_REFERENCE_ANSWER_INPUT_ID
} from '@ls101/core-types'

export function schemaBuiltinInputDescription(
  questionType: SchemaQuestionType,
  inputId: string
): string | null {
  if (inputId === SCHEMA_QUESTION_DESCRIPTION_INPUT_ID) return '题目描述'
  if (questionType === 'objective' && inputId === SCHEMA_OBJECTIVE_CORRECT_ANSWER_INPUT_ID)
    return '正确答案'
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
    builtins.push(
      { inputId: SCHEMA_OBJECTIVE_CORRECT_ANSWER_INPUT_ID, type: 'text', required: true },
      { inputId: SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID, type: 'text', required: false }
    )
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
