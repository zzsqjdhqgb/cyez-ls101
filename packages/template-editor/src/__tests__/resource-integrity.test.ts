import { describe, expect, it } from 'vitest'
import { compileTemplate, type TemplateCompileContext } from '../compiler'
import { createFunctionResource } from '../id'
import type { FunctionDef, TemplateContent, TemplateDocument } from '../types'
import { validateTemplateDocument } from '../validation'
import { root, schemaDefinition, schemaText } from './fixtures'

const SCHEMA_ID = `sha256:${'2'.repeat(64)}`
const MISSING_FUNCTION_ID = `sha256:${'9'.repeat(64)}`

const schemaManifest = schemaDefinition(SCHEMA_ID, {
  questionType: 'freetalk',
  answerFormat: [],
  templateInputs: [{ inputId: 'prompt', type: 'text', required: true }]
})

function content(functionRef: string): TemplateContent {
  return {
    name: 'Resource integrity',
    description: '',
    interfaces: [],
    root: root([
      { id: 'function-call', type: 'function', functionRef, inputs: {}, outputNames: {} }
    ]),
    schemaUses: [
      {
        useId: 'text-use',
        schemaId: SCHEMA_ID,
        inputBindings: { prompt: schemaText('Prompt') },
        answerBindings: {},
        attachments: []
      }
    ]
  }
}

function document(functionDef: FunctionDef): TemplateDocument {
  return {
    templateId: 'template-id',
    revision: 0,
    content: content(functionDef.id),
    resources: { functions: [functionDef] },
    editorState: {}
  }
}

const validationContext = {
  interfaceManifests: [],
  schemaDefinitions: [schemaManifest]
}

function compileContext(): TemplateCompileContext {
  return {
    ...validationContext,
    interfaceBindings: [],
    locateInterfaceInstance: () => null
  }
}

describe('函数资源入口完整性', () => {
  it('拒绝不符合 sha256 格式的函数资源 ID', async () => {
    const invalid: FunctionDef = {
      id: 'function-id',
      name: 'Invalid ID',
      inputs: [],
      body: root(),
      outputs: [],
      schemaUses: []
    }

    await expect(validateTemplateDocument(document(invalid), validationContext)).resolves.toEqual({
      valid: false,
      errors: [
        {
          path: 'resources.functions[0].id',
          code: 'INVALID_FUNCTION_RESOURCE_ID',
          params: { id: 'function-id' }
        }
      ]
    })
  })

  it('拒绝保留旧 ID 的已篡改函数正文', async () => {
    const resource = await createFunctionResource({
      name: 'Original',
      inputs: [],
      body: root(),
      outputs: [],
      schemaUses: []
    })
    const tampered = { ...resource, name: 'Tampered' }
    const result = await compileTemplate(document(tampered), compileContext())

    expect(result).toMatchObject({
      success: false,
      errors: [
        {
          stage: 'validation',
          error: {
            path: 'resources.functions[0].id',
            code: 'FUNCTION_RESOURCE_ID_MISMATCH',
            params: {
              actual: resource.id,
              expected: expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
            }
          }
        }
      ]
    })
  })

  it('拒绝缺失的嵌套函数资源闭包', async () => {
    const parent = await createFunctionResource({
      name: 'Parent',
      inputs: [],
      body: root([
        {
          id: 'nested-call',
          type: 'function',
          functionRef: MISSING_FUNCTION_ID,
          inputs: {},
          outputNames: {}
        }
      ]),
      outputs: [],
      schemaUses: []
    })
    const result = await compileTemplate(document(parent), compileContext())

    expect(result).toEqual({
      success: false,
      errors: [
        {
          stage: 'validation',
          error: {
            path: 'root.children[0].function.body.children[0].functionRef',
            code: 'UNKNOWN_FUNCTION',
            params: { functionRef: MISSING_FUNCTION_ID }
          }
        }
      ]
    })
  })
})
