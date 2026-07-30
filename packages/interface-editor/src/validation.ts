// @ls101/interface-editor — Interface 校验
//
// 在保存或生成之前检查 InterfaceDef 合法性。
//
// 错误设计原则:
//   - 每种校验错误对应一个枚举代码（ValidationErrorCode），便于调用方按类型处理
//   - 消息文本由 errorMessages.ts 集中管理，校验函数本身不拼接字符串
//   - ValidationResult.valid 是只读的派生字段

import type { FieldCollection, InterfaceDef } from './types'
import { flattenFields } from './queries'
import { isInterfaceId } from './id'

/**
 * 校验错误类型代码。
 * 每种代码代表一类独立的校验失败情形，UI 层据此决定高亮位置和消息文本。
 */
export type ValidationErrorCode =
  | 'INVALID_ID' // id 不是 SHA-256 内容 ID
  | 'EMPTY_NAME' // name 为空
  | 'EMPTY_PROMPT_TEMPLATE' // promptTemplate 为空
  | 'EMPTY_FIELDS' // fields 根级为空
  | 'EMPTY_GROUP' // FieldGroup.children 为空
  | 'INVALID_FIELD_ORDER' // order 与 nodes 的 key 集合不一致或包含重复项
  | 'INVALID_FIELD_KEY' // 字段 key 为空、含 "." 或首尾空白
  | 'EMPTY_VAR_NAME' // varName 为空
  | 'INVALID_VAR_NAME' // varName 格式不合法
  | 'EMPTY_DESCRIPTION' // description 为空
  | 'EMPTY_EXAMPLE' // example 为空
  | 'DUPLICATE_VAR_NAME' // varName 在全局作用域内重复

/**
 * 单条校验错误。
 * 不直接携带人类可读消息文本——消息渲染由 errorMessages.ts 根据 code + params 完成。
 */
export interface ValidationError {
  /** 出错字段在 fields 树中的路径（"."分隔），顶层错误为 "" */
  path: string

  /** 错误类型代码 */
  code: ValidationErrorCode

  /**
   * 错误相关的上下文数据，供 UI 消息渲染时插值。
   * 不同 code 携带的 params 结构:
   *
   *   INVALID_ID           → { id: string }
   *   INVALID_FIELD_KEY    → { key: string }
   *   INVALID_VAR_NAME     → { varName: string }
   *   DUPLICATE_VAR_NAME   → { varName: string }
   *   其他 code            → 不使用（空对象）
   */
  params: Readonly<Record<string, string>>
}

/**
 * 校验结果。只读——valid 由 errors 是否为空自动派生。
 * 始终创建 success() 或 failure(errors) 来构造，不直接 new。
 */
export interface ValidationResult {
  readonly valid: boolean
  readonly errors: readonly ValidationError[]
}

/** 构造一个全部通过的校验结果 */
export function success(): ValidationResult {
  return { valid: true, errors: [] }
}

/** 构造一个包含错误的校验结果 */
export function failure(errors: ValidationError[]): ValidationResult {
  return { valid: false, errors }
}

// ============================================================
// varName 格式
// ============================================================

/**
 * varName 合法格式:
 * - 以字母或下划线开头
 * - 后续字符为字母、数字、下划线或连字符
 */
const VAR_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

// ============================================================
// 内部工厂 — 创建 ValidationError
// ============================================================

function err(
  path: string,
  code: ValidationErrorCode,
  params: Record<string, string> = {}
): ValidationError {
  return { path, code, params }
}

// ============================================================
// 公开校验入口
// ============================================================

/**
 * 校验 InterfaceDef 是否合法。
 * 返回 failure(errors) 或 success()。
 */
export function validateInterfaceDef(def: InterfaceDef): ValidationResult {
  const errors: ValidationError[] = []

  // — 顶层 —

  if (!isInterfaceId(def.id)) {
    errors.push(err('', 'INVALID_ID', { id: def.id }))
  }

  if (!def.name.trim()) {
    errors.push(err('', 'EMPTY_NAME'))
  }

  if (!def.promptTemplate.trim()) {
    errors.push(err('', 'EMPTY_PROMPT_TEMPLATE'))
  }

  if (Object.keys(def.fields.nodes).length === 0) {
    errors.push(err('', 'EMPTY_FIELDS'))
  }

  // — 递归校验字段树 —

  const fieldOrderIsValid = validateNodes(def.fields, '', errors)

  // — varName 全局唯一性 —

  if (fieldOrderIsValid) {
    const seen = new Set<string>()
    for (const { path, leaf } of flattenFields(def.fields)) {
      if (!leaf.varName.trim() || !VAR_NAME_PATTERN.test(leaf.varName)) continue
      if (seen.has(leaf.varName)) {
        errors.push(err(path, 'DUPLICATE_VAR_NAME', { varName: leaf.varName }))
      }
      seen.add(leaf.varName)
    }
  }

  return errors.length === 0 ? success() : failure(errors)
}

// ============================================================
// 内部递归
// ============================================================

function validateNodes(
  fields: FieldCollection,
  parentPath: string,
  errors: ValidationError[]
): boolean {
  const nodeKeys = Object.keys(fields.nodes)
  const orderIsValid =
    fields.order.length === nodeKeys.length &&
    new Set(fields.order).size === fields.order.length &&
    fields.order.every((key) => Object.hasOwn(fields.nodes, key))
  if (!orderIsValid) errors.push(err(parentPath, 'INVALID_FIELD_ORDER'))

  const keys = orderIsValid ? fields.order : nodeKeys.sort()
  let descendantsAreValid = true
  for (const key of keys) {
    const node = fields.nodes[key]
    const path = parentPath ? `${parentPath}.${key}` : key

    if (!key.trim() || key !== key.trim() || key.includes('.')) {
      errors.push(err(path, 'INVALID_FIELD_KEY', { key }))
    }

    if (node.type === 'group') {
      if (Object.keys(node.children.nodes).length === 0) {
        errors.push(err(path, 'EMPTY_GROUP'))
      }
      if (!validateNodes(node.children, path, errors)) descendantsAreValid = false
    } else {
      // FieldLeaf

      if (!node.varName.trim()) {
        errors.push(err(path, 'EMPTY_VAR_NAME'))
      } else if (!VAR_NAME_PATTERN.test(node.varName)) {
        errors.push(err(path, 'INVALID_VAR_NAME', { varName: node.varName }))
      }

      if (!node.description.trim()) {
        errors.push(err(path, 'EMPTY_DESCRIPTION'))
      }

      if (!node.example.trim()) {
        errors.push(err(path, 'EMPTY_EXAMPLE'))
      }
    }
  }
  return orderIsValid && descendantsAreValid
}
