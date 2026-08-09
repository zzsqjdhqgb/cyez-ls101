import type { SchemaContent, SchemaDefinition } from '@ls101/core-types'

const SCHEMA_ID_PATTERN = /^sha256:[0-9a-f]{64}$/

/** 规范表示保留评分块和接入口的业务顺序，并固定所有对象字段顺序。 */
export function canonicalizeSchemaContent(content: SchemaContent): string {
  return JSON.stringify({
    name: normalizeText(content.name),
    blocks: content.blocks.map((block) => ({
      blockId: normalizeText(block.blockId),
      name: normalizeText(block.name),
      maxScore: block.maxScore,
      inputs: block.inputs.map((input) => ({
        inputId: normalizeText(input.inputId),
        name: normalizeText(input.name),
        type: input.type
      }))
    }))
  })
}

export async function deriveSchemaId(content: SchemaContent): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeSchemaContent(content))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
  return `sha256:${hex}`
}

export async function createSchemaDefinition(content: SchemaContent): Promise<SchemaDefinition> {
  return {
    formatVersion: 1,
    schemaId: await deriveSchemaId(content),
    name: content.name,
    blocks: content.blocks
  }
}

export async function verifySchemaId(definition: SchemaDefinition): Promise<boolean> {
  return (
    isSchemaId(definition.schemaId) && definition.schemaId === (await deriveSchemaId(definition))
  )
}

export function isSchemaId(value: string): boolean {
  return SCHEMA_ID_PATTERN.test(value)
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC')
}
