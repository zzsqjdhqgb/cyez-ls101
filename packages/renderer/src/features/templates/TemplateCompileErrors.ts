import type {
  FrameNode,
  TemplateCompileError,
  TemplateNode,
  TemplateValidationErrorCode
} from '@ls101/template-editor'

const VALIDATION_MESSAGES: Record<TemplateValidationErrorCode, string> = {
  EMPTY_TEMPLATE_NAME: '模板名称不能为空',
  DUPLICATE_INTERFACE_MANIFEST: '存在重复的 Interface 定义',
  DUPLICATE_SCHEMA_DEFINITION: '存在重复的 Schema 定义',
  DUPLICATE_FUNCTION_DEF: '存在重复的函数定义',
  INVALID_FUNCTION_RESOURCE_ID: '函数资源 ID 无效',
  FUNCTION_RESOURCE_ID_MISMATCH: '函数资源内容与 ID 不匹配',
  INVALID_INTERFACE_ALIAS: 'Interface 别名格式无效',
  DUPLICATE_INTERFACE_ALIAS: 'Interface 别名重复',
  UNKNOWN_INTERFACE: '引用的 Interface 不存在',
  EMPTY_ACCEPTED_VARS: 'Interface 至少需要接受一个变量',
  DUPLICATE_ACCEPTED_VAR: 'Interface 接受了重复变量',
  UNKNOWN_INTERFACE_VAR: 'Interface 变量不存在',
  INTERFACE_VAR_NOT_ACCEPTED: 'Interface 变量未被当前模板接受',
  EMPTY_NODE_ID: '节点 ID 不能为空',
  DUPLICATE_NODE_ID: '节点 ID 重复',
  EMPTY_CONTENT_BLOCK_ID: '内容块 ID 不能为空',
  DUPLICATE_CONTENT_BLOCK_ID: '内容块 ID 重复',
  EMPTY_PAGE_TIMELINE: '页面时间线不能为空',
  INVALID_RECORDING_DURATION: '录音时长必须大于 0',
  UNKNOWN_CHOICE_VIEW_OVERRIDE: '选择题视图覆盖指向未知内容块',
  INVALID_LOCAL_NAME: '变量名称格式无效',
  DUPLICATE_LOCAL_NAME: '变量名称重复',
  CYCLIC_VARIABLE_DEFINITION: '变量之间存在循环引用',
  UNKNOWN_LOCAL_VARIABLE: '引用的局部变量不存在',
  UNKNOWN_INTERFACE_ALIAS: '引用的 Interface 别名不存在',
  INTERFACE_VARIABLE_IN_FUNCTION: '本地函数不能直接引用 Interface 变量',
  EXPRESSION_TYPE_MISMATCH: '表达式类型与目标类型不匹配',
  UNKNOWN_FUNCTION: '引用的函数不存在',
  RECURSIVE_FUNCTION_CALL: '函数调用存在递归',
  MISSING_FUNCTION_INPUT: '函数缺少必需入参',
  UNKNOWN_FUNCTION_INPUT: '函数包含未知入参',
  MISSING_FUNCTION_OUTPUT_NAME: '函数出参未绑定变量名',
  UNKNOWN_FUNCTION_OUTPUT_NAME: '函数包含未知出参',
  INVALID_CHOICE_OPTION_COUNT: '选择题选项数量必须为 2 到 26 个',
  EMPTY_CHOICE_OPTION_ID: '选择题选项 ID 不能为空',
  DUPLICATE_CHOICE_OPTION_ID: '选择题选项 ID 重复',
  INVALID_SCHEMA_USE_ID: '评分单元 ID 格式无效',
  DUPLICATE_SCHEMA_USE_ID: '评分单元 ID 重复',
  UNKNOWN_SCHEMA: '引用的 Schema 不存在',
  MISSING_SCHEMA_INPUT_BINDING: 'Schema 缺少题目输入绑定',
  UNKNOWN_SCHEMA_INPUT_BINDING: 'Schema 包含未知题目输入绑定',
  MISSING_SCHEMA_ANSWER_BINDING: 'Schema 缺少答案绑定',
  UNKNOWN_SCHEMA_ANSWER_BINDING: 'Schema 包含未知答案绑定',
  SCHEMA_ANSWER_TYPE_MISMATCH: 'Schema 答案绑定类型不匹配',
  INVALID_SCHEMA_ATTACHMENT_NAME: 'Schema 附件变量名格式无效',
  DUPLICATE_SCHEMA_ATTACHMENT_NAME: 'Schema 附件变量名重复',
  UNKNOWN_SCHEMA_ATTACHMENT: '引用的 Schema 附件不存在',
  EMPTY_CHOICE_COLLECTOR: '选择题收集器没有收集到题目',
  EMPTY_CHOICE_COLLECTOR_PAGES: '选择题收集器没有分页',
  INVALID_CHOICE_PAGE_SIZE: '选择题分页大小无效',
  CHOICE_PAGE_TOTAL_MISMATCH: '选择题分页总数与题目数不一致',
  NESTED_CHOICE_COLLECTOR: '选择题收集器不能嵌套',
  MULTIPLE_CHOICE_COLLECTORS: '模板只能生成一份选择题元数据',
  UNCOLLECTED_CHOICE_QUESTIONS: '存在未被收集的选择题',
  CHOICE_VIEW_WITHOUT_META: '选择题视图缺少选择题元数据',
  FUNCTION_CHOICE_VIEW_WITHOUT_LOCAL_COLLECTOR: '函数内选择题视图缺少本地收集器',
  INVALID_CHOICE_VIEWPORT: '选择题视图范围无效',
  INVALID_CHOICE_GROUP_SHAPE: '选择题组形状无效',
  INVALID_CHOICE_GROUP_SELECTION: '选择题组选择范围无效',
  EMPTY_FOCUS_REFERENCE: '聚焦题目引用不能为空',
  INVALID_FOCUS_CALL_PATH: '聚焦题目的函数调用路径无效'
}

const COMPILE_MESSAGES: Record<string, string> = {
  DUPLICATE_INTERFACE_BINDING: '同一个 Interface 被绑定了多次',
  MISSING_INTERFACE_BINDING: '缺少 Interface 实例',
  UNKNOWN_INTERFACE_BINDING: '选择了模板未使用的 Interface 实例',
  INTERFACE_BINDING_ID_MISMATCH: 'Interface 实例与模板要求不匹配',
  INTERFACE_INSTANCE_NOT_FOUND: '找不到所选 Interface 实例',
  MISSING_INTERFACE_VALUE: 'Interface 实例缺少必需变量',
  STATIC_VALUE_CYCLE: '静态变量之间存在循环引用',
  UNRESOLVED_VALUE: '表达式无法求值',
  RESOURCE_SOURCE_NOT_FOUND: '找不到资源文件',
  SPEECH_SYNTHESIZER_MISSING: '当前没有可用的语音合成器',
  SPEECH_SYNTHESIS_FAILED: '语音合成失败',
  INVALID_SYNTHESIZED_AUDIO: '语音合成结果无效',
  EMPTY_PLAYER_PAGES: '模板没有生成任何页面',
  INVALID_RECORDING_DURATION: '录音时长必须大于 0',
  UNKNOWN_FOCUS_QUESTION: '选择题视图聚焦的题目不存在',
  UNKNOWN_CHOICE_GROUP: '选择题组不存在',
  CHOICE_GROUP_NOT_AVAILABLE: '当前模板没有可用的全局选择题组',
  CHOICE_GROUP_OUT_OF_RANGE: '选择题组选择范围越界',
  CHOICE_GROUP_SHAPE_MISMATCH: '选择题组形状与函数声明不匹配'
}

export function templateCompileErrorDetails(error: TemplateCompileError): {
  message: string
  path: string
} {
  const value = error.stage === 'validation' ? error.error : error
  const fallback = error.stage === 'validation' ? VALIDATION_MESSAGES[error.error.code] : undefined
  const message = typeof value.params.message === 'string' ? value.params.message : ''
  return {
    message: message || fallback || COMPILE_MESSAGES[value.code] || '模板处理失败',
    path: value.path
  }
}

export function templateCompileErrorsMessage(errors: readonly TemplateCompileError[]): string {
  if (errors.length === 0) return '试卷编译失败'
  return errors
    .map((error) => {
      const details = templateCompileErrorDetails(error)
      return `${details.message}\n位置：${details.path}`
    })
    .join('\n')
}

export function templateErrorNodeId(root: FrameNode, path: string): string | null {
  if (!path.startsWith('root') && !path.startsWith('body')) return null
  let node: TemplateNode = root
  const segments = [...path.matchAll(/\.children\[(\d+)\]/g)]
  for (const match of segments) {
    if (node.type !== 'frame') return node.id
    const child: TemplateNode | undefined = node.children[Number(match[1])]
    if (!child) return node.id
    node = child
  }
  return node.id
}
