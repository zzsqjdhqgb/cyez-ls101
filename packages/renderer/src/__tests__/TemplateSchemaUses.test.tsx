// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SchemaDefinition, SchemaRepository } from '@ls101/schema-editor'
import type { SchemaUse, TemplateDocumentOperation } from '@ls101/template-editor'
import { SchemaApplicationProvider } from '../features/schemas/SchemaApplicationProvider'
import { TemplateSchemaUses } from '../features/templates/TemplateSchemaUses'

const SCHEMA_ID = '30000000-0000-4000-8000-000000000001'

const definition: SchemaDefinition = {
  formatVersion: 2,
  schemaId: SCHEMA_ID,
  sourceDraftId: '20000000-0000-4000-8000-000000000001',
  structureHash: `sha256:${'a'.repeat(64)}`,
  revision: 0,
  structure: {
    questionType: 'fixed-reading',
    answerFormat: [{ answerId: 'reading', type: 'fixed-speech' }],
    templateInputs: [
      { inputId: 'question-description', type: 'text', required: true },
      { inputId: 'reference-answer', type: 'text', required: true }
    ]
  },
  data: {
    name: '固定朗读评分',
    description: '单句朗读',
    maxScore: 10,
    answerDescriptions: { reading: '朗读作答' },
    inputDescriptions: {},
    rubricMarkdown: '按准确度和流利度评分。'
  }
}

const use: SchemaUse = {
  useId: 'reading-unit',
  schemaId: SCHEMA_ID,
  inputBindings: {
    'question-description': {
      type: 'string',
      parts: [{ type: 'literal', value: '请朗读' }]
    },
    'reference-answer': {
      type: 'string',
      parts: [{ type: 'literal', value: '朗读参考文本' }]
    }
  },
  answerBindings: {
    reading: {
      type: 'fixed-speech',
      text: { type: 'string', parts: [{ type: 'literal', value: '' }] },
      audio: { type: 'audio', source: 'record-output', name: '' }
    }
  },
  attachments: []
}

function repository(): SchemaRepository {
  return {
    listDraftLibraryIds: vi.fn().mockResolvedValue([]),
    getDraftLibrary: vi.fn().mockResolvedValue(null),
    saveDraftLibrary: vi.fn(),
    deleteDraftLibrary: vi.fn(),
    listSchemaIds: vi.fn().mockResolvedValue([SCHEMA_ID]),
    listBuiltinSchemaIds: vi.fn().mockResolvedValue([]),
    getSchema: vi.fn().mockResolvedValue(definition),
    registerBuiltinSchema: vi.fn(),
    publishDraft: vi.fn(),
    updateSchemaData: vi.fn(),
    deleteSchema: vi.fn()
  }
}

afterEach(cleanup)

describe('Template SchemaUse editor', () => {
  it('edits both text and recording bindings for fixed speech', async () => {
    const apply = vi.fn((_operation: TemplateDocumentOperation) => true)

    render(
      <SchemaApplicationProvider repository={repository()}>
        <TemplateSchemaUses
          apply={apply}
          uses={[use]}
          variableCandidates={[
            {
              key: 'local:recording',
              label: 'recording',
              sourceLabel: '局部变量',
              type: 'audio',
              ref: { scope: 'local', name: 'recording' }
            }
          ]}
        />
      </SchemaApplicationProvider>
    )

    expect(await screen.findByText('固定朗读评分')).toBeInTheDocument()
    expect(screen.getByText('题目描述')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('reading-unit reading 文本'), {
      target: { value: '[@sentence]' }
    })
    fireEvent.change(screen.getByLabelText('reading-unit reading 录音'), {
      target: { value: 'recording' }
    })

    expect(apply).toHaveBeenCalledWith({
      type: 'set-schema-answer-binding',
      useId: 'reading-unit',
      answerId: 'reading',
      binding: {
        type: 'fixed-speech',
        text: {
          type: 'string',
          parts: [{ type: 'variable', ref: { scope: 'local', name: 'sentence' } }]
        },
        audio: { type: 'audio', source: 'record-output', name: '' }
      }
    })
    expect(apply).toHaveBeenCalledWith({
      type: 'set-schema-answer-binding',
      useId: 'reading-unit',
      answerId: 'reading',
      binding: {
        ...use.answerBindings.reading,
        audio: { type: 'audio', source: 'record-output', name: 'recording' }
      }
    })
  })

  it('creates fixed speech uses with both sub-bindings', async () => {
    const apply = vi.fn((_operation: TemplateDocumentOperation) => true)

    render(
      <SchemaApplicationProvider repository={repository()}>
        <TemplateSchemaUses apply={apply} uses={[]} variableCandidates={[]} />
      </SchemaApplicationProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getByLabelText('正式 Schema')).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '添加评分单元' }))

    expect(apply).toHaveBeenCalledWith({
      type: 'insert-schema-use',
      use: expect.objectContaining({
        schemaId: SCHEMA_ID,
        answerBindings: {
          reading: {
            type: 'fixed-speech',
            text: { type: 'string', parts: [{ type: 'literal', value: '' }] },
            audio: { type: 'audio', source: 'record-output', name: '' }
          }
        }
      })
    })
  })
})
