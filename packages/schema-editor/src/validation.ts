import type {
  GradingResult,
  SchemaData,
  SchemaDefinition,
  SchemaDraft,
  SchemaDraftLibraryDocument,
  SchemaStructure,
  SchemaTemplateInputDefinition
} from '@ls101/core-types'
import { isSchemaDraftId, isSchemaId, isSchemaLibraryId, isSchemaStructureHash } from './identity'
import {
  SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID,
  SCHEMA_QUESTION_DESCRIPTION_INPUT_ID
} from './structure'

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

export type SchemaValidationErrorCode =
  | 'INVALID_FORMAT_VERSION'
  | 'INVALID_SCHEMA_ID'
  | 'INVALID_SOURCE_DRAFT_ID'
  | 'INVALID_STRUCTURE_HASH'
  | 'INVALID_REVISION'
  | 'EMPTY_NAME'
  | 'EMPTY_DESCRIPTION'
  | 'INVALID_MAX_SCORE'
  | 'INVALID_QUESTION_TYPE'
  | 'EMPTY_ANSWER_FORMAT'
  | 'INVALID_ANSWER_ID'
  | 'DUPLICATE_ANSWER_ID'
  | 'EMPTY_ANSWER_DESCRIPTION'
  | 'MISSING_ANSWER_DESCRIPTION'
  | 'UNKNOWN_ANSWER_DESCRIPTION'
  | 'INVALID_ANSWER_TYPE'
  | 'INVALID_ANSWER_FORMAT_FOR_QUESTION_TYPE'
  | 'INVALID_INPUT_ID'
  | 'DUPLICATE_INPUT_ID'
  | 'EMPTY_INPUT_DESCRIPTION'
  | 'MISSING_INPUT_DESCRIPTION'
  | 'UNKNOWN_INPUT_DESCRIPTION'
  | 'INVALID_INPUT_TYPE'
  | 'INVALID_INPUT_REQUIRED'
  | 'MISSING_QUESTION_DESCRIPTION'
  | 'MISSING_OBJECTIVE_ANALYSIS'
  | 'EMPTY_RUBRIC'
  | 'INVALID_EXTRA_PROMPT'
  | 'INVALID_DRAFT_ID'
  | 'INVALID_LIBRARY_ID'
  | 'DUPLICATE_DRAFT_ID'
  | 'INVALID_SCORE'
  | 'INVALID_COMMENT'

export interface SchemaValidationError {
  path: string
  code: SchemaValidationErrorCode
  params: Readonly<Record<string, string | number | boolean>>
}

export interface SchemaValidationResult {
  readonly valid: boolean
  readonly errors: readonly SchemaValidationError[]
}

export function validateSchemaStructure(structure: SchemaStructure): SchemaValidationResult {
  const errors: SchemaValidationError[] = []
  validateStructure(structure, '', errors)
  return result(errors)
}

export function validateSchemaData(
  data: SchemaData,
  structure: SchemaStructure
): SchemaValidationResult {
  const errors: SchemaValidationError[] = []
  validateData(data, structure, '', errors)
  return result(errors)
}

export function validateSchemaDefinition(definition: SchemaDefinition): SchemaValidationResult {
  const errors: SchemaValidationError[] = []
  if (definition.formatVersion !== 2) {
    errors.push(
      error('formatVersion', 'INVALID_FORMAT_VERSION', { actual: definition.formatVersion })
    )
  }
  if (!isSchemaId(definition.schemaId)) {
    errors.push(error('schemaId', 'INVALID_SCHEMA_ID', { schemaId: definition.schemaId }))
  }
  if (!isSchemaDraftId(definition.sourceDraftId)) {
    errors.push(
      error('sourceDraftId', 'INVALID_SOURCE_DRAFT_ID', { sourceDraftId: definition.sourceDraftId })
    )
  }
  if (!isSchemaStructureHash(definition.structureHash)) {
    errors.push(
      error('structureHash', 'INVALID_STRUCTURE_HASH', { structureHash: definition.structureHash })
    )
  }
  if (!isRevision(definition.revision)) {
    errors.push(error('revision', 'INVALID_REVISION', { revision: definition.revision }))
  }
  errors.push(
    ...validateSchemaStructure(definition.structure).errors.map((item) => prefix(item, 'structure'))
  )
  errors.push(
    ...validateSchemaData(definition.data, definition.structure).errors.map((item) =>
      prefix(item, 'data')
    )
  )
  return result(errors)
}

export function validateSchemaDraft(draft: SchemaDraft): SchemaValidationResult {
  const errors: SchemaValidationError[] = []
  if (!isSchemaDraftId(draft.draftId)) {
    errors.push(error('draftId', 'INVALID_DRAFT_ID', { draftId: draft.draftId }))
  }
  if (!isRevision(draft.revision)) {
    errors.push(error('revision', 'INVALID_REVISION', { revision: draft.revision }))
  }
  if (!draft.name.trim()) errors.push(error('name', 'EMPTY_NAME'))
  errors.push(
    ...validateSchemaStructure(draft.structure).errors.map((item) => prefix(item, 'structure'))
  )
  return result(errors)
}

export function validateSchemaDraftLibrary(
  library: SchemaDraftLibraryDocument
): SchemaValidationResult {
  const errors: SchemaValidationError[] = []
  if (!isSchemaLibraryId(library.libraryId)) {
    errors.push(error('libraryId', 'INVALID_LIBRARY_ID', { libraryId: library.libraryId }))
  }
  if (!isRevision(library.revision)) {
    errors.push(error('revision', 'INVALID_REVISION', { revision: library.revision }))
  }
  if (!library.name.trim()) errors.push(error('name', 'EMPTY_NAME'))

  const draftIds = new Set<string>()
  library.drafts.forEach((draft, index) => {
    const path = `drafts[${index}]`
    if (draftIds.has(draft.draftId)) {
      errors.push(error(`${path}.draftId`, 'DUPLICATE_DRAFT_ID', { draftId: draft.draftId }))
    }
    draftIds.add(draft.draftId)
    errors.push(...validateSchemaDraft(draft).errors.map((item) => prefix(item, path)))
  })
  return result(errors)
}

export function validateGradingResult(
  gradingResult: GradingResult,
  maxScore: number
): SchemaValidationResult {
  const errors: SchemaValidationError[] = []
  if (
    !Number.isFinite(gradingResult.score) ||
    gradingResult.score < 0 ||
    gradingResult.score > maxScore
  ) {
    errors.push(error('score', 'INVALID_SCORE', { score: gradingResult.score, maxScore }))
  }
  if (typeof gradingResult.comment !== 'string') {
    errors.push(error('comment', 'INVALID_COMMENT'))
  }
  return result(errors)
}

function validateStructure(
  structure: SchemaStructure,
  path: string,
  errors: SchemaValidationError[]
): void {
  if (
    structure.questionType !== 'objective' &&
    structure.questionType !== 'fixed-reading' &&
    structure.questionType !== 'freetalk'
  ) {
    errors.push(
      error(at(path, 'questionType'), 'INVALID_QUESTION_TYPE', {
        actual: String(structure.questionType)
      })
    )
  }

  if (!Array.isArray(structure.answerFormat) || structure.answerFormat.length === 0) {
    errors.push(error(at(path, 'answerFormat'), 'EMPTY_ANSWER_FORMAT'))
  }

  const answerIds = new Set<string>()
  structure.answerFormat.forEach((answer, index) => {
    const answerPath = `${at(path, 'answerFormat')}[${index}]`
    if (!IDENTIFIER_PATTERN.test(answer.answerId)) {
      errors.push(
        error(`${answerPath}.answerId`, 'INVALID_ANSWER_ID', { answerId: answer.answerId })
      )
    } else if (answerIds.has(answer.answerId)) {
      errors.push(
        error(`${answerPath}.answerId`, 'DUPLICATE_ANSWER_ID', { answerId: answer.answerId })
      )
    }
    answerIds.add(answer.answerId)
    if (!isAnswerType(answer.type)) {
      errors.push(
        error(`${answerPath}.type`, 'INVALID_ANSWER_TYPE', { actual: String(answer.type) })
      )
    }
  })

  const answers = structure.answerFormat
  if (
    structure.questionType === 'objective' &&
    (answers.length !== 1 || answers[0]?.type !== 'text')
  ) {
    errors.push(
      error(at(path, 'answerFormat'), 'INVALID_ANSWER_FORMAT_FOR_QUESTION_TYPE', {
        questionType: structure.questionType
      })
    )
  }
  if (
    structure.questionType === 'fixed-reading' &&
    (answers.length === 0 || answers.some((answer) => answer.type !== 'fixed-speech'))
  ) {
    errors.push(
      error(at(path, 'answerFormat'), 'INVALID_ANSWER_FORMAT_FOR_QUESTION_TYPE', {
        questionType: structure.questionType
      })
    )
  }
  if (
    structure.questionType === 'freetalk' &&
    (answers.length === 0 || answers.some((answer) => answer.type !== 'free-speech'))
  ) {
    errors.push(
      error(at(path, 'answerFormat'), 'INVALID_ANSWER_FORMAT_FOR_QUESTION_TYPE', {
        questionType: structure.questionType
      })
    )
  }

  validateInputs(structure.templateInputs, path, structure.questionType, errors)
}

function validateInputs(
  inputs: readonly SchemaTemplateInputDefinition[],
  path: string,
  questionType: SchemaStructure['questionType'],
  errors: SchemaValidationError[]
): void {
  const inputIds = new Set<string>()
  inputs.forEach((input, index) => {
    const inputPath = `${at(path, 'templateInputs')}[${index}]`
    if (!IDENTIFIER_PATTERN.test(input.inputId)) {
      errors.push(error(`${inputPath}.inputId`, 'INVALID_INPUT_ID', { inputId: input.inputId }))
    } else if (inputIds.has(input.inputId)) {
      errors.push(error(`${inputPath}.inputId`, 'DUPLICATE_INPUT_ID', { inputId: input.inputId }))
    }
    inputIds.add(input.inputId)
    if (input.type !== 'text') {
      errors.push(error(`${inputPath}.type`, 'INVALID_INPUT_TYPE', { actual: String(input.type) }))
    }
    if (typeof input.required !== 'boolean') {
      errors.push(
        error(`${inputPath}.required`, 'INVALID_INPUT_REQUIRED', { actual: String(input.required) })
      )
    }
  })

  const inputsById = new Map(inputs.map((input) => [input.inputId, input]))
  const questionDescription = inputsById.get(SCHEMA_QUESTION_DESCRIPTION_INPUT_ID)
  if (!questionDescription) {
    errors.push(error(at(path, 'templateInputs'), 'MISSING_QUESTION_DESCRIPTION'))
  } else if (!questionDescription.required) {
    errors.push(
      error(at(path, 'templateInputs'), 'INVALID_INPUT_REQUIRED', {
        inputId: SCHEMA_QUESTION_DESCRIPTION_INPUT_ID
      })
    )
  }
  if (questionType === 'objective') {
    const analysis = inputsById.get(SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID)
    if (!analysis) {
      errors.push(error(at(path, 'templateInputs'), 'MISSING_OBJECTIVE_ANALYSIS'))
    } else if (!analysis.required) {
      errors.push(
        error(at(path, 'templateInputs'), 'INVALID_INPUT_REQUIRED', {
          inputId: SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID
        })
      )
    }
  }
}

function validateData(
  data: SchemaData,
  structure: SchemaStructure,
  path: string,
  errors: SchemaValidationError[]
): void {
  if (!data.name.trim()) errors.push(error(at(path, 'name'), 'EMPTY_NAME'))
  if (!data.description.trim()) errors.push(error(at(path, 'description'), 'EMPTY_DESCRIPTION'))
  if (!Number.isFinite(data.maxScore) || data.maxScore <= 0) {
    errors.push(error(at(path, 'maxScore'), 'INVALID_MAX_SCORE', { maxScore: data.maxScore }))
  }
  validateDescriptions(
    data.answerDescriptions,
    structure.answerFormat.map((answer) => answer.answerId),
    at(path, 'answerDescriptions'),
    'ANSWER',
    errors
  )
  validateDescriptions(
    data.inputDescriptions,
    structure.templateInputs.map((input) => input.inputId),
    at(path, 'inputDescriptions'),
    'INPUT',
    errors
  )
  if (structure.questionType !== 'objective' && !data.rubricMarkdown.trim()) {
    errors.push(error(at(path, 'rubricMarkdown'), 'EMPTY_RUBRIC'))
  }
  if (data.extraPromptMarkdown !== undefined && typeof data.extraPromptMarkdown !== 'string') {
    errors.push(error(at(path, 'extraPromptMarkdown'), 'INVALID_EXTRA_PROMPT'))
  }
}

function validateDescriptions(
  descriptions: Readonly<Record<string, string>>,
  ids: readonly string[],
  path: string,
  kind: 'ANSWER' | 'INPUT',
  errors: SchemaValidationError[]
): void {
  const expected = new Set(ids)
  const missingCode: SchemaValidationErrorCode =
    kind === 'ANSWER' ? 'MISSING_ANSWER_DESCRIPTION' : 'MISSING_INPUT_DESCRIPTION'
  const emptyCode: SchemaValidationErrorCode =
    kind === 'ANSWER' ? 'EMPTY_ANSWER_DESCRIPTION' : 'EMPTY_INPUT_DESCRIPTION'
  const unknownCode: SchemaValidationErrorCode =
    kind === 'ANSWER' ? 'UNKNOWN_ANSWER_DESCRIPTION' : 'UNKNOWN_INPUT_DESCRIPTION'
  for (const id of ids) {
    if (!Object.hasOwn(descriptions, id)) {
      errors.push(error(path, missingCode, { id }))
      continue
    }
    if (!descriptions[id]?.trim()) {
      errors.push(error(`${path}.${id}`, emptyCode, { id }))
    }
  }
  for (const id of Object.keys(descriptions)) {
    if (!expected.has(id)) {
      errors.push(error(`${path}.${id}`, unknownCode, { id }))
    }
  }
}

function isAnswerType(value: unknown): value is SchemaStructure['answerFormat'][number]['type'] {
  return value === 'text' || value === 'fixed-speech' || value === 'free-speech'
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function at(path: string, field: string): string {
  return path ? `${path}.${field}` : field
}

function prefix(item: SchemaValidationError, path: string): SchemaValidationError {
  return { ...item, path: `${path}.${item.path}` }
}

function error(
  path: string,
  code: SchemaValidationErrorCode,
  params: Readonly<Record<string, string | number | boolean>> = {}
): SchemaValidationError {
  return { path, code, params }
}

function result(errors: readonly SchemaValidationError[]): SchemaValidationResult {
  return { valid: errors.length === 0, errors }
}
