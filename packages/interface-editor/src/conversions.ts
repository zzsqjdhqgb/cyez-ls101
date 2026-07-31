// @ls101/interface-editor — 转换层
//
// 以 InterfaceDef 为输入，产出三种不同形态的外部 artifact：
//   1. buildAIPrompt(def) → string
//      — 拼接 promptTemplate + JSON Schema + JSON Example，发给 LLM
//
//   2. buildVarManifest(def) → InterfaceVarManifest
//      — 平铺字段树，生成 Template 编辑器可导入的变量清单
//
//   3. buildInstanceFromJson(def, data) → InterfaceInstance
//      — 将 LLM 返回的 JSON（已通过 schema 校验）映射为 Interface 实例

import type { InterfaceDef } from './types'
import type { InterfaceVarManifest, InterfaceInstance } from '@ls101/core-types'
import { flattenFields } from './queries'
import { buildJsonSchema, buildJsonExample } from './schema'

// ============================================================
// 1. buildAIPrompt — 拼接发给 LLM 的完整 prompt
// ============================================================

/**
 * 合成发送给 LLM 的完整提示词，包含三部分：
 * 1. 教师编写的 promptTemplate（界面中编辑的提示词）
 * 2. JSON Schema（由字段树自动生成，描述期望的 JSON 结构）
 * 3. JSON Example（由字段的 example 值填充的示例输出）
 *
 * LLM 应直接返回符合 Schema 的 JSON，不要包含任何 JSON 之外的文本。
 */
export function buildAIPrompt(def: InterfaceDef): string {
  return `${def.promptTemplate}\n\n${buildFormatInstructions(def)}`
}

/** 构建由字段结构派生的格式限制提示词。 */
export function buildFormatInstructions(def: InterfaceDef): string {
  const schema = buildJsonSchema(def.fields)
  const example = buildJsonExample(def.fields)

  const schemaStr = JSON.stringify(schema, null, 2)
  const exampleStr = JSON.stringify(example, null, 2)

  return `请严格按照以下 JSON Schema 输出，不要输出任何 JSON 之外的文本：
其中图片字段应返回可直接用于图片生成模型的详细提示词，不要返回图片 URL。

${schemaStr}

示例输出：

${exampleStr}`
}

// ============================================================
// 2. buildVarManifest — 生成 Template 可用的变量清单
// ============================================================

/**
 * 将 InterfaceDef 的字段树平铺为 InterfaceVarManifest。
 *
 * Template 编辑器导入此清单后即可构建变量选择器，
 * 教师以 [@varName] 语法引用 Interface 实例中的数据。
 *
 * 即使尚未调用 AI 生成实例，清单也可用——教师可以先编辑 Template 后生成数据。
 */
export function buildVarManifest(def: InterfaceDef): InterfaceVarManifest {
  return {
    interfaceId: def.id,
    interfaceName: def.name,
    vars: flattenFields(def.fields).map(({ path, leaf }) => ({
      varName: leaf.varName,
      type: leaf.type,
      description: leaf.description,
      example: leaf.example,
      path
    }))
  }
}

// ============================================================
// 3. buildInstanceFromJson — JSON → InterfaceInstance
// ============================================================

/**
 * 将 LLM 返回的 JSON 数据（已通过 schema 校验）映射为 InterfaceInstance。
 *
 * 映射过程：
 *   字段树叶子 → 其路径（如 "sectionA.sentences.s1"）定位 JSON 中的值
 *             → 以其 varName 作为 key 存入 values。
 *
 * 调用方应确保 data 已通过 validateJson(schema, llmResponse) 校验。
 * 本函数不做重复校验。路径遍历失败时降级为空字符串，不会抛异常。
 *
 * @param def  Interface 定义（提供字段树结构）
 * @param data 已校验通过的 LLM 返回 JSON 对象
 */
export function buildInstanceFromJson(
  def: InterfaceDef,
  data: Record<string, unknown>,
  name = '未命名实例'
): InterfaceInstance {
  const values: Record<string, string> = {}

  for (const { path, leaf } of flattenFields(def.fields)) {
    values[leaf.varName] = getValueAtPath(data, path)
  }

  return {
    instanceId: crypto.randomUUID(),
    name,
    generatedAt: new Date().toISOString(),
    values
  }
}

/** 按 "." 分隔的路径从嵌套对象中取值，失败时返回空字符串 */
function getValueAtPath(data: Record<string, unknown>, path: string): string {
  const segments = path.split('.')
  let current: unknown = data

  for (const seg of segments) {
    if (current == null || typeof current !== 'object') {
      return ''
    }
    current = (current as Record<string, unknown>)[seg]
  }

  return String(current ?? '')
}
