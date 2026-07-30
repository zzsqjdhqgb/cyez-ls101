// @ls101/interface-editor — JSON Schema 生成与校验
//
// 本模块负责将 InterfaceDef 的字段树结构（FieldNode）转换为
// 标准的 JSON Schema，用于与 LLM 交互。
//
// 三个职责：
//   1. buildJsonSchema(fields) → Record<string, unknown>
//      — 用 TypeBox 将字段树合成为 JSON Schema 对象
//
//   2. buildJsonExample(fields) → Record<string, unknown>
//      — 用字段的 example 值填充出一份示例 JSON
//
//   3. validateJson(schema, jsonString) → JsonValidationResult
//      — 用 Ajv 校验 JSON 字符串是否符合 Schema
//
// 设计原则：
//   - varName 不进入 JSON Schema（LLM 不应看到变量名）
//   - description 写入 Schema；图片字段会追加生图提示词约束
//   - 所有 object 节点设置 additionalProperties: false

import { Type } from '@sinclair/typebox'
import Ajv from 'ajv'
import type { ErrorObject } from 'ajv'
import type { FieldCollection } from './types'

// ============================================================
// 1. buildJsonSchema — TypeBox 构建 JSON Schema
// ============================================================

/**
 * 将字段树递归合成为 JSON Schema 对象。
 *
 * - FieldGroup → { type: "object", properties: {...}, required: [...], additionalProperties: false }
 * - FieldLeaf  → { type: "string", description: "..." }
 *
 * varName 不出现在 Schema 中。
 */
export function buildJsonSchema(fields: FieldCollection): Record<string, unknown> {
  const properties: Record<
    string,
    ReturnType<typeof Type.Object> | ReturnType<typeof Type.String>
  > = {}

  for (const key of fields.order) {
    const node = fields.nodes[key]
    if (node.type === 'group') {
      properties[key] = buildJsonSchema(node.children) as ReturnType<typeof Type.Object>
    } else {
      const description =
        node.type === 'image'
          ? `${node.description}（请返回可直接用于图片生成模型的详细提示词，而不是图片 URL）`
          : node.description
      properties[key] = Type.String({ description })
    }
  }

  return Type.Object(properties, { additionalProperties: false }) as unknown as Record<
    string,
    unknown
  >
}

// ============================================================
// 2. buildJsonExample — 用 example 值填充示例 JSON
// ============================================================

/**
 * 递归构建一份填充了 example 值的示例 JSON。
 * 结构完全镜像 fields 树，叶子字段填充其 example 值。
 *
 * 示例 JSON 随 Schema 一同发送给 LLM，辅助理解期望的输出格式。
 */
export function buildJsonExample(fields: FieldCollection): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const key of fields.order) {
    const node = fields.nodes[key]
    if (node.type === 'group') {
      result[key] = buildJsonExample(node.children)
    } else {
      result[key] = node.example
    }
  }

  return result
}

// ============================================================
// 3. validateJson — Ajv 校验 JSON 字符串
// ============================================================

/**
 * 校验 JSON 字符串是否符合指定的 JSON Schema。
 *
 * 返回三种情况：
 * - JSON 解析成功 + Schema 校验通过 → { valid: true, errors: null, data }
 * - JSON 解析成功 + Schema 校验失败 → { valid: false, errors: ErrorObject[], data: null }
 * - JSON 格式非法（parse 失败）   → { valid: false, errors: [单条], data: null }
 */
export interface JsonValidationResult {
  valid: boolean
  /** 校验通过时为 null；失败时包含 Ajv 原生错误对象列表或 JSON 解析错误 */
  errors: ErrorObject[] | null
  /** 校验通过时返回解析后的 JS 对象 */
  data: Record<string, unknown> | null
}

const _ajv = new Ajv({ allErrors: true })

export function validateJson(
  schema: Record<string, unknown>,
  jsonString: string
): JsonValidationResult {
  const validate = _ajv.compile(schema)

  let data: unknown
  try {
    data = JSON.parse(jsonString)
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          instancePath: '',
          schemaPath: '',
          keyword: 'parse',
          message: `JSON 格式不合法: ${(error as Error).message}`,
          params: {}
        }
      ],
      data: null
    }
  }

  if (validate(data)) {
    return { valid: true, errors: null, data: data as Record<string, unknown> }
  }

  return { valid: false, errors: validate.errors ?? [], data: null }
}
