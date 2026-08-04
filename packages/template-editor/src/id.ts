import stableStringify from 'fast-json-stable-stringify'
import type {
  DslEditorState,
  FunctionContent,
  FunctionDef,
  FunctionDocument,
  TemplateContent,
  TemplateDocument,
  TemplateResources
} from './types'

const CONTENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/

export function createTemplateId(): string {
  return crypto.randomUUID()
}

export function createFunctionId(): string {
  return crypto.randomUUID()
}

export function createTemplateDocument(
  content: TemplateContent,
  resources: TemplateResources = { functions: [] },
  editorState: DslEditorState = {}
): TemplateDocument {
  return {
    templateId: createTemplateId(),
    content: structuredClone(content),
    resources: structuredClone(resources),
    editorState: structuredClone(editorState)
  }
}

export function createFunctionDocument(
  content: FunctionContent,
  editorState: DslEditorState = {}
): FunctionDocument {
  return {
    functionId: createFunctionId(),
    content: structuredClone(content),
    editorState: structuredClone(editorState)
  }
}

/** 为已经改写完嵌套 functionRef 的函数快照计算内容 ID。 */
export async function deriveFunctionResourceId(content: FunctionContent): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeFunctionContent(content))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
  return `sha256:${hex}`
}

export async function createFunctionResource(content: FunctionContent): Promise<FunctionDef> {
  const copy = structuredClone(content)
  return { ...copy, id: await deriveFunctionResourceId(copy) }
}

export async function verifyFunctionResourceId(resource: FunctionDef): Promise<boolean> {
  return (
    isFunctionResourceId(resource.id) && resource.id === (await deriveFunctionResourceId(resource))
  )
}

export function isFunctionResourceId(value: string): boolean {
  return CONTENT_ID_PATTERN.test(value)
}

export function canonicalizeFunctionContent(content: FunctionContent): string {
  return stableStringify(
    normalizeCanonicalValue({
      name: content.name,
      inputs: content.inputs,
      body: content.body,
      outputs: content.outputs,
      schemaUses: content.schemaUses
    })
  )
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
