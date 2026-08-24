import stableStringify from 'fast-json-stable-stringify'
import type {
  FieldCollection,
  FieldNode,
  InterfaceContent,
  InterfaceDef,
  InterfaceDraft
} from './types'

const CONTENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/

/** 创建仅用于本地草稿管理的随机 UUID v4。 */
export function createDraftId(): string {
  return crypto.randomUUID()
}

/** 创建草稿；发布时不会沿用 draftId。 */
export function createInterfaceDraft(content: InterfaceContent): InterfaceDraft {
  return { draftId: createDraftId(), ...content }
}

/** 根据 Interface 的规范化内容生成稳定的 SHA-256 ID。 */
export async function deriveInterfaceId(content: InterfaceContent): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeInterfaceContent(content))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
  return `sha256:${hex}`
}

/** 发布内容。相同规范化内容始终得到相同 ID。 */
export async function publishInterface(content: InterfaceContent): Promise<InterfaceDef> {
  const id = await deriveInterfaceId(content)
  return {
    id,
    name: content.name,
    description: content.description,
    promptTemplate: content.promptTemplate,
    fields: content.fields
  }
}

/** 导入时复算摘要；可阻止伪造或损坏的“同 ID、不同内容”数据。 */
export async function verifyInterfaceId(def: InterfaceDef): Promise<boolean> {
  if (!isInterfaceId(def.id)) return false
  return def.id === (await deriveInterfaceId(def))
}

export type InterfaceIdentityComparison = 'same' | 'different-id' | 'collision'

/**
 * 比较两份已发布内容。collision 必须作为损坏或攻击处理，调用方不得保存后者。
 */
export function compareInterfaceIdentity(
  existing: InterfaceDef,
  incoming: InterfaceDef
): InterfaceIdentityComparison {
  if (existing.id !== incoming.id) return 'different-id'
  return canonicalizeInterfaceContent(existing) === canonicalizeInterfaceContent(incoming)
    ? 'same'
    : 'collision'
}

export function isInterfaceId(value: string): boolean {
  return CONTENT_ID_PATTERN.test(value)
}

/**
 * 哈希输入使用固定顶层结构，并将字段树编码为有序条目数组。
 * stableStringify 递归按 key 排序且不输出额外空白；字段条目数组保留业务顺序。
 */
export function canonicalizeInterfaceContent(content: InterfaceContent): string {
  return stableStringify({
    name: normalizeText(content.name),
    description: normalizeText(content.description),
    promptTemplate: normalizeText(content.promptTemplate),
    fields: canonicalizeFields(content.fields)
  })
}

function canonicalizeFields(fields: FieldCollection): unknown[] {
  return fields.order.map((key) => [normalizeText(key), canonicalizeNode(fields.nodes[key])])
}

function canonicalizeNode(node: FieldNode): unknown {
  if (node.type === 'group') {
    return { type: 'group', children: canonicalizeFields(node.children) }
  }

  return {
    type: node.type,
    varName: normalizeText(node.varName),
    description: normalizeText(node.description),
    example: normalizeText(node.example)
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC')
}
