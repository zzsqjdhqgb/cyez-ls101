// @ls101/interface-editor — 校验错误消息映射
//
// 集中管理 ValidationErrorCode → 人类可读消息的映射。
// 校验函数（validation.ts）不直接拼接字符串，由本模块统一提供消息渲染。
//
// 设计意图:
//   - UI 层可以直接调用 formatError(e) 获取可显示的消息文本
//   - 需要国际化时，只需替换本文件的映射表，校验逻辑无需改动

import type { ValidationError, ValidationErrorCode } from './validation'

/**
 * 错误代码 → 消息模板的映射。
 * 模板中使用 {{paramName}} 占位符，由 formatError 根据 error.params 插值。
 */
const MESSAGES: Record<ValidationErrorCode, string> = {
  INVALID_ID: 'Interface ID "{{id}}" 不是有效的 SHA-256 内容 ID',
  EMPTY_NAME: 'Interface 名称不能为空',
  EMPTY_PROMPT_TEMPLATE: '提示词模板不能为空',
  EMPTY_FIELDS: '字段结构不能为空（至少需要一个字段）',
  EMPTY_GROUP: '字段组不能为空（至少需要一个子字段）',
  INVALID_FIELD_ORDER: '字段顺序与字段集合不一致',
  INVALID_FIELD_KEY: '字段名称 "{{key}}" 不能为空、包含点号或带有首尾空格',
  EMPTY_VAR_NAME: '变量名不能为空',
  INVALID_VAR_NAME: '变量名 "{{varName}}" 格式无效（仅允许字母、数字、下划线和连字符）',
  EMPTY_DESCRIPTION: '字段描述不能为空',
  EMPTY_EXAMPLE: '示例值不能为空',
  DUPLICATE_VAR_NAME: '变量名 "{{varName}}" 重复'
}

/**
 * 将一条 ValidationError 渲染为人类可读的消息文本。
 * 根据 error.code 查找模板，用 error.params 替换占位符。
 *
 * @example
 * formatError({ path: "s1", code: "INVALID_VAR_NAME", params: { varName: "foo bar" } })
 * // → '变量名 "foo bar" 格式无效（...）'
 */
export function formatError(error: ValidationError): string {
  const template = MESSAGES[error.code] ?? `未知错误: ${error.code}`
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return error.params[key] ?? `{{${key}}}`
  })
}

/**
 * 批量格式化错误列表。
 */
export function formatErrors(errors: readonly ValidationError[]): string[] {
  return errors.map(formatError)
}
