import type {
  CompiledSchemaInput,
  CompiledSchemaPipeline,
  SchemaBlockDefinition,
  SchemaInstanceBundle,
  SchemaInstanceInput,
  SchemaRuntimeData
} from '@ls101/core-types'
import { validateCompiledSchemaPipeline, type SchemaValidationError } from './validation'

export type SchemaInstantiationResult =
  | { success: true; instance: SchemaInstanceBundle }
  | { success: false; errors: readonly SchemaValidationError[] }

/** 将 Template 编译映射和 ExamPlayer 运行期数据还原为批改引擎输入。 */
export function instantiateSchemaPipeline(
  pipeline: CompiledSchemaPipeline,
  runtime: SchemaRuntimeData
): SchemaInstantiationResult {
  const validation = validateCompiledSchemaPipeline(pipeline)
  if (!validation.valid) return { success: false, errors: validation.errors }

  return {
    success: true,
    instance: {
      formatVersion: 1,
      schemas: pipeline.definitions.map((schema) => ({
        schemaId: schema.schemaId,
        name: schema.name,
        blocks: pipeline.blocks
          .filter((block) => block.schemaId === schema.schemaId)
          .map((block) => {
            const definition = schema.blocks.find(
              (candidate) => candidate.blockId === block.blockId
            ) as SchemaBlockDefinition
            const definitionsById = new Map(
              definition.inputs.map((input) => [input.inputId, input])
            )
            return {
              instanceId: block.instanceId,
              blockId: block.blockId,
              name: definition.name,
              maxScore: definition.maxScore,
              inputs: block.inputs.map((input) =>
                instantiateInput(
                  input,
                  definitionsById.get(input.inputId)?.name ?? input.inputId,
                  runtime
                )
              )
            }
          })
      }))
    }
  }
}

function instantiateInput(
  input: CompiledSchemaInput,
  name: string,
  runtime: SchemaRuntimeData
): SchemaInstanceInput {
  if (input.source === 'static') {
    return {
      inputId: input.inputId,
      name,
      type: 'string',
      status: 'resolved',
      value: input.value
    }
  }
  if (input.source === 'choice') {
    const value = runtime.choices[input.choiceIndex]
    return value === undefined || value === null
      ? {
          inputId: input.inputId,
          name,
          type: 'string',
          status: 'missing',
          reason: 'unanswered'
        }
      : {
          inputId: input.inputId,
          name,
          type: 'string',
          status: 'resolved',
          value
        }
  }

  const assetKey = runtime.recordings[input.recordIndex]
  return assetKey === undefined
    ? {
        inputId: input.inputId,
        name,
        type: 'audio',
        status: 'missing',
        reason: 'recording-missing'
      }
    : {
        inputId: input.inputId,
        name,
        type: 'audio',
        status: 'resolved',
        assetKey
      }
}
