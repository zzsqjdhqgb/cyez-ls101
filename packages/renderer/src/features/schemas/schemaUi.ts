import type {
  SchemaAnswerType,
  SchemaData,
  SchemaQuestionType,
  SchemaStructure,
  SchemaValidationError
} from '@ls101/schema-editor'

export const questionTypeLabels: Record<SchemaQuestionType, string> = {
  objective: '客观题',
  'fixed-reading': '固定朗读',
  freetalk: '自由口语'
}

export const answerTypeLabels: Record<SchemaAnswerType, string> = {
  text: '文本',
  'fixed-speech': '固定语音',
  'free-speech': '自由语音'
}

const validationMessages: Record<SchemaValidationError['code'], string> = {
  INVALID_FORMAT_VERSION: '格式版本无效',
  INVALID_SCHEMA_ID: 'Schema ID 无效',
  INVALID_SOURCE_DRAFT_ID: '来源草稿 ID 无效',
  INVALID_STRUCTURE_HASH: '结构哈希无效',
  INVALID_REVISION: '修订号无效',
  EMPTY_NAME: '名称不能为空',
  EMPTY_DESCRIPTION: '描述不能为空',
  INVALID_MAX_SCORE: '满分必须大于 0',
  INVALID_QUESTION_TYPE: '评分管道无效',
  EMPTY_ANSWER_FORMAT: '至少需要一个答案槽位',
  INVALID_ANSWER_ID: '答案槽位 ID 格式无效',
  DUPLICATE_ANSWER_ID: '答案槽位 ID 不能重复',
  EMPTY_ANSWER_DESCRIPTION: '答案槽位说明不能为空',
  MISSING_ANSWER_DESCRIPTION: '缺少答案槽位说明',
  UNKNOWN_ANSWER_DESCRIPTION: '存在未知的答案槽位说明',
  INVALID_ANSWER_TYPE: '答案槽位类型无效',
  INVALID_ANSWER_FORMAT_FOR_QUESTION_TYPE: '答案槽位与评分管道不匹配',
  INVALID_INPUT_ID: '输入项 ID 格式无效',
  DUPLICATE_INPUT_ID: '输入项 ID 不能重复',
  EMPTY_INPUT_DESCRIPTION: '输入项说明不能为空',
  MISSING_INPUT_DESCRIPTION: '缺少输入项说明',
  UNKNOWN_INPUT_DESCRIPTION: '存在未知的输入项说明',
  INVALID_INPUT_TYPE: '输入项类型无效',
  INVALID_INPUT_REQUIRED: '输入项必填设置无效',
  MISSING_QUESTION_DESCRIPTION: '缺少内置题目描述输入',
  MISSING_OBJECTIVE_ANALYSIS: '客观题缺少内置解析输入',
  EMPTY_RUBRIC: '评分标准不能为空',
  INVALID_EXTRA_PROMPT: 'AI 补充提示词格式无效',
  INVALID_DRAFT_ID: '草稿 ID 无效',
  INVALID_LIBRARY_ID: '草稿库 ID 无效',
  DUPLICATE_DRAFT_ID: '草稿 ID 不能重复',
  INVALID_SCORE: '分数无效',
  INVALID_COMMENT: '评语无效'
}

export function schemaValidationMessage(error: SchemaValidationError): string {
  const prefix = error.path ? `${error.path}：` : ''
  return `${prefix}${validationMessages[error.code]}`
}

export function schemaErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('preload bridge is unavailable')) {
      return '当前环境无法访问本地数据，请在桌面应用中打开。'
    }
    if (error.message.includes('revision conflict')) {
      return '数据已在其他窗口中更新，请刷新后重试。'
    }
    return error.message
  }
  return '操作失败，请重试。'
}

export function createEmptySchemaData(name: string, structure: SchemaStructure): SchemaData {
  return {
    name,
    description: '',
    maxScore: 10,
    answerDescriptions: Object.fromEntries(
      structure.answerFormat.map((item) => [item.answerId, ''])
    ),
    inputDescriptions: Object.fromEntries(
      structure.templateInputs.map((item) => [item.inputId, ''])
    ),
    rubricMarkdown: '',
    extraPromptMarkdown: ''
  }
}
