import stableStringify from 'fast-json-stable-stringify'
import type { TemplateContent, TemplateDef, TemplateDraft } from './types'

const CONTENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/

/** 创建仅用于本地草稿管理的随机 UUID v4。 */
export function createTemplateDraftId(): string {
  return crypto.randomUUID()
}

/** 创建草稿；发布时 draftId 不进入成品。 */
export function createTemplateDraft(content: TemplateContent): TemplateDraft {
  return {
    draftId: createTemplateDraftId(),
    status: 'draft',
    ...copyTemplateContent(content)
  }
}

/** 根据规范化 TemplateContent 生成稳定的 SHA-256 ID。 */
export async function deriveTemplateId(content: TemplateContent): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeTemplateContent(content))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
  return `sha256:${hex}`
}

/** 发布内容。相同规范化内容始终得到相同 ID。 */
export async function publishTemplate(content: TemplateContent): Promise<TemplateDef> {
  const normalizedContent = copyTemplateContent(content)
  return {
    id: await deriveTemplateId(normalizedContent),
    status: 'published',
    ...normalizedContent
  }
}

/** 导入时复算摘要，拒绝被篡改的同 ID 内容。 */
export async function verifyTemplateId(def: TemplateDef): Promise<boolean> {
  if (!isTemplateId(def.id)) return false
  return def.id === (await deriveTemplateId(def))
}

export type TemplateIdentityComparison = 'same' | 'different-id' | 'collision'

export function compareTemplateIdentity(
  existing: TemplateDef,
  incoming: TemplateDef
): TemplateIdentityComparison {
  if (existing.id !== incoming.id) return 'different-id'
  return canonicalizeTemplateContent(existing) === canonicalizeTemplateContent(incoming)
    ? 'same'
    : 'collision'
}

export function isTemplateId(value: string): boolean {
  return CONTENT_ID_PATTERN.test(value)
}

/**
 * 对象 key 使用稳定排序，业务数组保留顺序；所有字符串统一换行和 Unicode 形式。
 * 只选择 TemplateContent 顶层字段，因此草稿/发布身份和调用方附加元数据不会参与哈希。
 */
export function canonicalizeTemplateContent(content: TemplateContent): string {
  return stableStringify(
    normalizeCanonicalValue({
      name: content.name,
      description: content.description,
      interfaces: content.interfaces,
      root: content.root,
      schemaUses: content.schemaUses
    })
  )
}

function copyTemplateContent(content: TemplateContent): TemplateContent {
  return {
    name: content.name,
    description: content.description,
    interfaces: content.interfaces,
    root: content.root,
    schemaUses: content.schemaUses
  }
}

function normalizeCanonicalValue(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n').normalize('NFC')
  if (Array.isArray(value)) return value.map(normalizeCanonicalValue)

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        normalizeText(key),
        normalizeCanonicalValue(entry)
      ])
    )
  }

  return value
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC')
}
