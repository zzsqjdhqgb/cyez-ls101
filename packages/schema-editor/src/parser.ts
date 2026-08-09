import type {
  SchemaData,
  SchemaDefinition,
  SchemaDraft,
  SchemaDraftLibraryDocument,
  SchemaStructure
} from '@ls101/core-types'

export function parseSchemaDraftLibrary(value: unknown): SchemaDraftLibraryDocument | null {
  if (
    !isRecord(value) ||
    typeof value.libraryId !== 'string' ||
    !isRevision(value.revision) ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.drafts) ||
    !value.drafts.every(isSchemaDraft)
  ) {
    return null
  }
  return value as unknown as SchemaDraftLibraryDocument
}

export function parseSchemaDefinition(value: unknown): SchemaDefinition | null {
  if (
    !isRecord(value) ||
    value.formatVersion !== 2 ||
    typeof value.schemaId !== 'string' ||
    typeof value.sourceDraftId !== 'string' ||
    typeof value.structureHash !== 'string' ||
    !isRevision(value.revision) ||
    !isSchemaStructure(value.structure) ||
    !isSchemaData(value.data)
  ) {
    return null
  }
  return value as unknown as SchemaDefinition
}

function isSchemaDraft(value: unknown): value is SchemaDraft {
  return (
    isRecord(value) &&
    typeof value.draftId === 'string' &&
    isRevision(value.revision) &&
    typeof value.name === 'string' &&
    isSchemaStructure(value.structure)
  )
}

function isSchemaStructure(value: unknown): value is SchemaStructure {
  return (
    isRecord(value) &&
    (value.questionType === 'objective' ||
      value.questionType === 'fixed-reading' ||
      value.questionType === 'freetalk') &&
    Array.isArray(value.answerFormat) &&
    value.answerFormat.every(
      (answer) =>
        isRecord(answer) &&
        typeof answer.answerId === 'string' &&
        (answer.type === 'text' || answer.type === 'fixed-speech' || answer.type === 'free-speech')
    ) &&
    Array.isArray(value.templateInputs) &&
    value.templateInputs.every(
      (input) =>
        isRecord(input) &&
        typeof input.inputId === 'string' &&
        input.type === 'text' &&
        typeof input.required === 'boolean'
    )
  )
}

function isSchemaData(value: unknown): value is SchemaData {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.maxScore === 'number' &&
    isStringRecord(value.answerDescriptions) &&
    isStringRecord(value.inputDescriptions) &&
    typeof value.rubricMarkdown === 'string' &&
    (value.extraPromptMarkdown === undefined || typeof value.extraPromptMarkdown === 'string')
  )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
