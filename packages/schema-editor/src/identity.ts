import type {
  SchemaData,
  SchemaDefinition,
  SchemaDraft,
  SchemaDraftLibraryDocument,
  SchemaStructure
} from '@ls101/core-types'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STRUCTURE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

export function createSchemaDraftLibrary(name = ''): SchemaDraftLibraryDocument {
  return {
    libraryId: crypto.randomUUID(),
    revision: 0,
    name,
    drafts: []
  }
}

export function createSchemaDraft(name: string, structure: SchemaStructure): SchemaDraft {
  return {
    draftId: crypto.randomUUID(),
    revision: 0,
    name,
    structure: structuredClone(structure)
  }
}

export function updateSchemaDraft(
  draft: SchemaDraft,
  update: { name?: string; structure?: SchemaStructure }
): SchemaDraft {
  return {
    ...draft,
    revision: draft.revision + 1,
    name: update.name ?? draft.name,
    structure: structuredClone(update.structure ?? draft.structure)
  }
}

export async function createSchemaDefinition(
  draft: SchemaDraft,
  data: SchemaData
): Promise<SchemaDefinition> {
  const structure = structuredClone(draft.structure)
  return {
    formatVersion: 2,
    schemaId: createSchemaId(),
    sourceDraftId: draft.draftId,
    structureHash: await deriveSchemaStructureHash(structure),
    revision: 0,
    structure,
    data: structuredClone(data)
  }
}

/** Create a Schema directly from its complete structure and editable data. */
export async function createDirectSchemaDefinition(
  structure: SchemaStructure,
  data: SchemaData
): Promise<SchemaDefinition> {
  const clonedStructure = structuredClone(structure)
  return {
    formatVersion: 2,
    schemaId: createSchemaId(),
    // Kept for compatibility with existing persisted definitions. Direct schemas do not
    // expose or use this identifier as a user-facing draft.
    sourceDraftId: createSchemaId(),
    structureHash: await deriveSchemaStructureHash(clonedStructure),
    revision: 0,
    structure: clonedStructure,
    data: structuredClone(data)
  }
}

export function updateSchemaDefinition(
  definition: SchemaDefinition,
  data: SchemaData
): SchemaDefinition {
  return {
    ...definition,
    revision: definition.revision + 1,
    structure: structuredClone(definition.structure),
    data: structuredClone(data)
  }
}

export async function updateDirectSchemaDefinition(
  definition: SchemaDefinition,
  structure: SchemaStructure,
  data: SchemaData
): Promise<SchemaDefinition> {
  const clonedStructure = structuredClone(structure)
  return {
    ...definition,
    revision: definition.revision + 1,
    structure: clonedStructure,
    structureHash: await deriveSchemaStructureHash(clonedStructure),
    data: structuredClone(data)
  }
}

export function createSchemaId(): string {
  return crypto.randomUUID()
}

export function isSchemaId(value: string): boolean {
  return UUID_V4_PATTERN.test(value)
}

export function isSchemaDraftId(value: string): boolean {
  return UUID_V4_PATTERN.test(value)
}

export function isSchemaLibraryId(value: string): boolean {
  return UUID_V4_PATTERN.test(value)
}

export function isSchemaStructureHash(value: string): boolean {
  return STRUCTURE_HASH_PATTERN.test(value)
}

export function canonicalizeSchemaStructure(structure: SchemaStructure): string {
  return JSON.stringify({
    questionType: structure.questionType,
    answerFormat: structure.answerFormat.map((answer) => ({
      answerId: normalizeText(answer.answerId),
      type: answer.type
    })),
    templateInputs: structure.templateInputs.map((input) => ({
      inputId: normalizeText(input.inputId),
      type: input.type,
      required: input.required
    }))
  })
}

export async function deriveSchemaStructureHash(structure: SchemaStructure): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeSchemaStructure(structure))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
  return `sha256:${hex}`
}

export async function verifySchemaDefinition(definition: SchemaDefinition): Promise<boolean> {
  return (
    definition.formatVersion === 2 &&
    isSchemaId(definition.schemaId) &&
    isSchemaDraftId(definition.sourceDraftId) &&
    isSchemaStructureHash(definition.structureHash) &&
    definition.structureHash === (await deriveSchemaStructureHash(definition.structure))
  )
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC')
}
