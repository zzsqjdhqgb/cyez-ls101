// @cyez/interface-editor — Interface 校验
//
// 在保存或生成之前检查 InterfaceDef 合法性。
//
// 已实现:
//   validateInterfaceDef(def) → ValidationResult
//     — 检查: promptTemplate 非空、fields 非空、
//       varName 全局唯一、varName 格式合法、
//       每个 FieldLeaf 的 description 和 example 非空、
//       FieldGroup.children 非空
//
// 待实现:
//   [无 — 校验层已完整]

import type { InterfaceDef, FieldNode } from './types'
import { flattenFields } from './queries'

/**
 * 单条校验错误。
 * path 为出错字段在 fields 树中的路径（"."分隔），
 * 顶层错误（如 promptTemplate 为空）path 为 ""。
 */
export interface ValidationError {
  path: string
  message: string
}

/** 校验结果 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/**
 * varName 合法格式:
 * - 以字母或下划线开头
 * - 后续字符为字母、数字、下划线或连字符
 * - 不含空格和其他特殊字符
 */
const VAR_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

/**
 * 校验 InterfaceDef 是否合法。
 * 返回 ValidationResult，valid=true 表示无错误。
 */
export function validateInterfaceDef(def: InterfaceDef): ValidationResult {
  const errors: ValidationError[] = []

  // — 顶层校验 —

  if (!def.promptTemplate.trim()) {
    errors.push({ path: '', message: '提示词模板不能为空' })
  }

  if (Object.keys(def.fields).length === 0) {
    errors.push({ path: '', message: '字段结构不能为空（至少需要一个字段）' })
  }

  // — 递归校验字段树 —

  validateNodes(def.fields, '', errors)

  // — varName 全局唯一性 —

  const seen = new Set<string>()
  for (const { path, leaf } of flattenFields(def.fields)) {
    if (seen.has(leaf.varName)) {
      errors.push({ path, message: `变量名 "${leaf.varName}" 重复` })
    }
    seen.add(leaf.varName)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 递归校验字段节点。
 * parentPath 为父级路径（"."分隔），根级传 ""。
 */
function validateNodes(
  fields: Record<string, FieldNode>,
  parentPath: string,
  errors: ValidationError[]
): void {
  for (const [key, node] of Object.entries(fields)) {
    const path = parentPath ? `${parentPath}.${key}` : key

    if (node.type === 'group') {
      // FieldGroup: children 不能为空
      if (Object.keys(node.children).length === 0) {
        errors.push({ path, message: '字段组不能为空（至少需要一个子字段）' })
      } else {
        validateNodes(node.children, path, errors)
      }
    } else {
      // FieldLeaf: 校验三个必填字段

      if (!node.varName.trim()) {
        errors.push({ path, message: '变量名不能为空' })
      } else if (!VAR_NAME_PATTERN.test(node.varName)) {
        errors.push({
          path,
          message: `变量名 "${node.varName}" 格式无效（仅允许字母、数字、下划线和连字符，以字母或下划线开头）`
        })
      }

      if (!node.description.trim()) {
        errors.push({ path, message: '字段描述不能为空' })
      }

      if (!node.example.trim()) {
        errors.push({ path, message: '示例值不能为空' })
      }
    }
  }
}
