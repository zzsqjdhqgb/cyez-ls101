import type {
  CompiledSchemaInput,
  CompiledSchemaPipeline,
  SchemaBlockDefinition,
  SchemaDefinition,
  SchemaInputDefinition
} from '@ls101/core-types'
import { isSchemaId } from './identity'

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

export type SchemaValidationErrorCode =
  | 'INVALID_FORMAT_VERSION'
  | 'INVALID_SCHEMA_ID'
  | 'EMPTY_SCHEMA_NAME'
  | 'INVALID_BLOCK_ID'
  | 'DUPLICATE_BLOCK_ID'
  | 'EMPTY_BLOCK_NAME'
  | 'INVALID_MAX_SCORE'
  | 'INVALID_INPUT_ID'
  | 'DUPLICATE_INPUT_ID'
  | 'EMPTY_INPUT_NAME'
  | 'INVALID_INPUT_TYPE'
  | 'DUPLICATE_SCHEMA_ID'
  | 'DUPLICATE_INSTANCE_ID'
  | 'UNKNOWN_SCHEMA'
  | 'UNKNOWN_BLOCK'
  | 'MISSING_INPUT_BINDING'
  | 'UNKNOWN_INPUT_BINDING'
  | 'DUPLICATE_INPUT_BINDING'
  | 'INPUT_TYPE_MISMATCH'
  | 'INVALID_INPUT_SOURCE'

export interface SchemaValidationError {
  path: string
  code: SchemaValidationErrorCode
  params: Readonly<Record<string, string | number>>
}

export interface SchemaValidationResult {
  readonly valid: boolean
  readonly errors: readonly SchemaValidationError[]
}

export function validateSchemaDefinition(definition: SchemaDefinition): SchemaValidationResult {
  const errors: SchemaValidationError[] = []
  validateDefinition(definition, '', errors)
  return result(errors)
}

export function validateCompiledSchemaPipeline(
  pipeline: CompiledSchemaPipeline
): SchemaValidationResult {
  const errors: SchemaValidationError[] = []
  if (pipeline.formatVersion !== 1) {
    errors.push(
      error('formatVersion', 'INVALID_FORMAT_VERSION', {
        actual: pipeline.formatVersion
      })
    )
  }

  const schemas = new Map<string, SchemaDefinition>()
  pipeline.definitions.forEach((definition, index) => {
    const path = `definitions[${index}]`
    validateDefinition(definition, path, errors)
    if (schemas.has(definition.schemaId)) {
      errors.push(
        error(`${path}.schemaId`, 'DUPLICATE_SCHEMA_ID', { schemaId: definition.schemaId })
      )
    } else {
      schemas.set(definition.schemaId, definition)
    }
  })

  const instanceIds = new Set<string>()
  pipeline.blocks.forEach((block, index) => {
    const path = `blocks[${index}]`
    if (!block.instanceId.trim() || instanceIds.has(block.instanceId)) {
      errors.push(
        error(`${path}.instanceId`, 'DUPLICATE_INSTANCE_ID', {
          instanceId: block.instanceId
        })
      )
    }
    instanceIds.add(block.instanceId)

    const schema = schemas.get(block.schemaId)
    if (!schema) {
      errors.push(error(`${path}.schemaId`, 'UNKNOWN_SCHEMA', { schemaId: block.schemaId }))
      return
    }
    const definition = schema.blocks.find((candidate) => candidate.blockId === block.blockId)
    if (!definition) {
      errors.push(error(`${path}.blockId`, 'UNKNOWN_BLOCK', { blockId: block.blockId }))
      return
    }
    validateBindings(definition, block.inputs, path, errors)
  })

  return result(errors)
}

function validateDefinition(
  definition: SchemaDefinition,
  path: string,
  errors: SchemaValidationError[]
): void {
  const at = (field: string): string => (path ? `${path}.${field}` : field)
  if (definition.formatVersion !== 1) {
    errors.push(
      error(at('formatVersion'), 'INVALID_FORMAT_VERSION', {
        actual: definition.formatVersion
      })
    )
  }
  if (!isSchemaId(definition.schemaId)) {
    errors.push(error(at('schemaId'), 'INVALID_SCHEMA_ID', { schemaId: definition.schemaId }))
  }
  if (!definition.name.trim()) errors.push(error(at('name'), 'EMPTY_SCHEMA_NAME'))

  const blockIds = new Set<string>()
  definition.blocks.forEach((block, index) => {
    const blockPath = `${at('blocks')}[${index}]`
    if (!IDENTIFIER_PATTERN.test(block.blockId)) {
      errors.push(error(`${blockPath}.blockId`, 'INVALID_BLOCK_ID', { blockId: block.blockId }))
    } else if (blockIds.has(block.blockId)) {
      errors.push(error(`${blockPath}.blockId`, 'DUPLICATE_BLOCK_ID', { blockId: block.blockId }))
    }
    blockIds.add(block.blockId)
    if (!block.name.trim()) errors.push(error(`${blockPath}.name`, 'EMPTY_BLOCK_NAME'))
    if (!Number.isFinite(block.maxScore) || block.maxScore <= 0) {
      errors.push(
        error(`${blockPath}.maxScore`, 'INVALID_MAX_SCORE', {
          maxScore: block.maxScore
        })
      )
    }
    validateInputs(block.inputs, blockPath, errors)
  })
}

function validateInputs(
  inputs: readonly SchemaInputDefinition[],
  blockPath: string,
  errors: SchemaValidationError[]
): void {
  const inputIds = new Set<string>()
  inputs.forEach((input, index) => {
    const path = `${blockPath}.inputs[${index}]`
    if (!IDENTIFIER_PATTERN.test(input.inputId)) {
      errors.push(error(`${path}.inputId`, 'INVALID_INPUT_ID', { inputId: input.inputId }))
    } else if (inputIds.has(input.inputId)) {
      errors.push(error(`${path}.inputId`, 'DUPLICATE_INPUT_ID', { inputId: input.inputId }))
    }
    inputIds.add(input.inputId)
    if (!input.name.trim()) errors.push(error(`${path}.name`, 'EMPTY_INPUT_NAME'))
    if (input.type !== 'string' && input.type !== 'audio') {
      errors.push(error(`${path}.type`, 'INVALID_INPUT_TYPE', { actual: String(input.type) }))
    }
  })
}

function validateBindings(
  block: SchemaBlockDefinition,
  bindings: readonly CompiledSchemaInput[],
  path: string,
  errors: SchemaValidationError[]
): void {
  const definitions = new Map(block.inputs.map((input) => [input.inputId, input]))
  const seen = new Set<string>()
  bindings.forEach((binding, index) => {
    const bindingPath = `${path}.inputs[${index}]`
    const input = definitions.get(binding.inputId)
    if (!input) {
      errors.push(
        error(`${bindingPath}.inputId`, 'UNKNOWN_INPUT_BINDING', {
          inputId: binding.inputId
        })
      )
      return
    }
    if (seen.has(binding.inputId)) {
      errors.push(
        error(`${bindingPath}.inputId`, 'DUPLICATE_INPUT_BINDING', {
          inputId: binding.inputId
        })
      )
    }
    seen.add(binding.inputId)
    if (binding.type !== input.type) {
      errors.push(
        error(`${bindingPath}.type`, 'INPUT_TYPE_MISMATCH', {
          inputId: binding.inputId,
          expected: input.type,
          actual: binding.type
        })
      )
    }
    const source = String((binding as { source: unknown }).source)
    if (
      (binding.type === 'audio' && source !== 'recording') ||
      (binding.type === 'string' && source !== 'static' && source !== 'choice')
    ) {
      errors.push(
        error(`${bindingPath}.source`, 'INVALID_INPUT_SOURCE', {
          inputId: binding.inputId,
          source
        })
      )
    }
  })
  block.inputs.forEach((input) => {
    if (!seen.has(input.inputId)) {
      errors.push(error(`${path}.inputs`, 'MISSING_INPUT_BINDING', { inputId: input.inputId }))
    }
  })
}

function error(
  path: string,
  code: SchemaValidationErrorCode,
  params: Record<string, string | number> = {}
): SchemaValidationError {
  return { path, code, params }
}

function result(errors: SchemaValidationError[]): SchemaValidationResult {
  return { valid: errors.length === 0, errors }
}
