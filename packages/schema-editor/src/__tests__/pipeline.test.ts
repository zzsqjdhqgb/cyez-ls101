import { describe, expect, it } from 'vitest'
import type { CompiledSchemaPipeline, SchemaContent } from '@ls101/core-types'
import {
  createSchemaDefinition,
  deriveSchemaId,
  instantiateSchemaPipeline,
  validateCompiledSchemaPipeline,
  validateSchemaDefinition,
  verifySchemaId
} from '../index'

const content: SchemaContent = {
  name: '朗读评分',
  blocks: [
    {
      blockId: 'reading',
      name: '朗读',
      maxScore: 10,
      inputs: [
        { inputId: 'prompt', name: '题面', type: 'string' },
        { inputId: 'reference', name: '参考答案', type: 'string' },
        { inputId: 'recording', name: '学生录音', type: 'audio' }
      ]
    },
    {
      blockId: 'choice',
      name: '选择题',
      maxScore: 5,
      inputs: [{ inputId: 'answer', name: '学生答案', type: 'string' }]
    }
  ]
}

describe('Schema data pipeline', () => {
  it('creates a content-addressed definition and verifies it', async () => {
    const definition = await createSchemaDefinition(content)
    expect(definition.formatVersion).toBe(1)
    expect(definition.schemaId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(await deriveSchemaId(content)).toBe(definition.schemaId)
    await expect(verifySchemaId(definition)).resolves.toBe(true)
    expect(validateSchemaDefinition(definition)).toEqual({ valid: true, errors: [] })
  })

  it('rejects duplicate ports, invalid score and invalid source bindings', async () => {
    const definition = await createSchemaDefinition({
      ...content,
      blocks: [
        {
          ...content.blocks[0],
          maxScore: 0,
          inputs: [content.blocks[0].inputs[0], content.blocks[0].inputs[0]]
        }
      ]
    })
    const invalidDefinition = validateSchemaDefinition({
      ...definition,
      schemaId: 'sha256:' + '1'.repeat(64),
      blocks: definition.blocks
    })
    expect(invalidDefinition.valid).toBe(false)
    expect(invalidDefinition.errors.map((error) => error.code)).toContain('INVALID_MAX_SCORE')
    expect(invalidDefinition.errors.map((error) => error.code)).toContain('DUPLICATE_INPUT_ID')

    const pipeline: CompiledSchemaPipeline = {
      formatVersion: 1,
      definitions: [await createSchemaDefinition(content)],
      blocks: [
        {
          instanceId: 'reading-1',
          schemaId: definition.schemaId,
          blockId: 'reading',
          inputs: [
            { inputId: 'prompt', type: 'audio', source: 'recording', recordIndex: 0 },
            { inputId: 'reference', type: 'string', source: 'static', value: 'x' },
            { inputId: 'recording', type: 'audio', source: 'recording', recordIndex: 0 }
          ]
        }
      ]
    }
    expect(validateCompiledSchemaPipeline(pipeline).valid).toBe(false)
  })

  it('resolves static strings, choices and recordings into a grading instance', async () => {
    const definition = await createSchemaDefinition(content)
    const pipeline: CompiledSchemaPipeline = {
      formatVersion: 1,
      definitions: [definition],
      blocks: [
        {
          instanceId: 'reading-1',
          schemaId: definition.schemaId,
          blockId: 'reading',
          inputs: [
            { inputId: 'prompt', type: 'string', source: 'static', value: 'Read this.' },
            { inputId: 'reference', type: 'string', source: 'static', value: 'Hello.' },
            { inputId: 'recording', type: 'audio', source: 'recording', recordIndex: 3 }
          ]
        },
        {
          instanceId: 'choice-1',
          schemaId: definition.schemaId,
          blockId: 'choice',
          inputs: [{ inputId: 'answer', type: 'string', source: 'choice', choiceIndex: 2 }]
        }
      ]
    }
    const result = instantiateSchemaPipeline(pipeline, {
      recordings: { 3: 'recordings/3.wav' },
      choices: { 2: 'B' }
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.instance.schemas[0].blocks).toEqual([
      expect.objectContaining({
        instanceId: 'reading-1',
        maxScore: 10,
        inputs: [
          {
            inputId: 'prompt',
            name: '题面',
            type: 'string',
            status: 'resolved',
            value: 'Read this.'
          },
          {
            inputId: 'reference',
            name: '参考答案',
            type: 'string',
            status: 'resolved',
            value: 'Hello.'
          },
          {
            inputId: 'recording',
            name: '学生录音',
            type: 'audio',
            status: 'resolved',
            assetKey: 'recordings/3.wav'
          }
        ]
      }),
      expect.objectContaining({
        instanceId: 'choice-1',
        inputs: [
          { inputId: 'answer', name: '学生答案', type: 'string', status: 'resolved', value: 'B' }
        ]
      })
    ])
  })

  it('preserves explicit missing runtime data', async () => {
    const definition = await createSchemaDefinition(content)
    const result = instantiateSchemaPipeline(
      {
        formatVersion: 1,
        definitions: [definition],
        blocks: [
          {
            instanceId: 'choice-1',
            schemaId: definition.schemaId,
            blockId: 'choice',
            inputs: [{ inputId: 'answer', type: 'string', source: 'choice', choiceIndex: 8 }]
          }
        ]
      },
      { recordings: {}, choices: {} }
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.instance.schemas[0].blocks[0].inputs[0]).toMatchObject({
      type: 'string',
      status: 'missing',
      reason: 'unanswered'
    })
  })
})
