// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import type { SchemaDefinition, SchemaRepository } from '@ls101/schema-editor'
import type { FunctionDef, FunctionNode, TemplateDocumentOperation } from '@ls101/template-editor'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SchemaApplicationProvider } from '../features/schemas/SchemaApplicationProvider'
import { TemplateFunctionCallEditor } from '../features/templates/TemplateFunctionCallEditor'
import type { TemplateChoiceGroupCandidate } from '../features/templates/TemplateChoiceTargets'

const SCHEMA_ID = `sha256:${'a'.repeat(64)}`
const ROOT_ID = `sha256:${'b'.repeat(64)}`
const NESTED_ID = `sha256:${'c'.repeat(64)}`

const schema: SchemaDefinition = {
  formatVersion: 2,
  schemaId: SCHEMA_ID,
  sourceDraftId: '20000000-0000-4000-8000-000000000001',
  structureHash: `sha256:${'d'.repeat(64)}`,
  revision: 0,
  structure: {
    questionType: 'fixed-reading',
    answerFormat: [{ answerId: 'reading', type: 'fixed-speech' }],
    templateInputs: [{ inputId: 'prompt', type: 'text', required: true }]
  },
  data: {
    name: '朗读评分',
    description: '朗读评分 Schema',
    maxScore: 10,
    answerDescriptions: { reading: '朗读答案' },
    inputDescriptions: { prompt: '朗读内容' },
    rubricMarkdown: '评分标准'
  }
}

const nested: FunctionDef = {
  id: NESTED_ID,
  name: '子函数',
  inputs: [],
  body: { id: 'nested-root', type: 'frame', children: [] },
  outputs: [],
  schemaUses: [
    {
      useId: 'nested-reading',
      schemaId: SCHEMA_ID,
      inputBindings: {
        prompt: { type: 'string', parts: [{ type: 'literal', value: '请朗读短文' }] }
      },
      answerBindings: {
        reading: {
          type: 'fixed-speech',
          text: { type: 'string', parts: [{ type: 'literal', value: '短文内容' }] },
          audio: { type: 'audio', source: 'record-output', name: 'recording' }
        }
      },
      attachments: []
    }
  ]
}

const root: FunctionDef = {
  id: ROOT_ID,
  name: '主函数',
  inputs: [],
  body: {
    id: 'root',
    type: 'frame',
    children: [
      {
        id: 'nested-call',
        type: 'function',
        functionRef: NESTED_ID,
        inputs: {},
        outputNames: {}
      }
    ]
  },
  outputs: [],
  schemaUses: [
    {
      useId: 'root-reading',
      schemaId: SCHEMA_ID,
      inputBindings: {
        prompt: { type: 'string', parts: [{ type: 'literal', value: '请朗读句子' }] }
      },
      answerBindings: {
        reading: {
          type: 'fixed-speech',
          text: { type: 'string', parts: [{ type: 'literal', value: '句子内容' }] },
          audio: { type: 'audio', source: 'record-output', name: 'root-recording' }
        }
      },
      attachments: []
    }
  ]
}

const node: FunctionNode = {
  id: 'root-call',
  type: 'function',
  functionRef: ROOT_ID,
  inputs: {},
  outputNames: {}
}

function repository(): SchemaRepository {
  return {
    listDraftLibraryIds: vi.fn().mockResolvedValue([]),
    getDraftLibrary: vi.fn().mockResolvedValue(null),
    saveDraftLibrary: vi.fn(),
    deleteDraftLibrary: vi.fn(),
    listSchemaIds: vi.fn().mockResolvedValue([SCHEMA_ID]),
    listBuiltinSchemaIds: vi.fn().mockResolvedValue([]),
    getSchema: vi.fn().mockResolvedValue(schema),
    registerBuiltinSchema: vi.fn(),
    publishDraft: vi.fn(),
    updateSchemaData: vi.fn(),
    deleteSchema: vi.fn()
  }
}

afterEach(cleanup)

describe('Function call Schema summary', () => {
  it('shows direct and nested function Schema data without edit controls', async () => {
    const apply = vi.fn((_operation: TemplateDocumentOperation) => true)
    render(
      <SchemaApplicationProvider repository={repository()}>
        <TemplateFunctionCallEditor
          apply={apply}
          definition={root}
          functions={[root, nested]}
          node={node}
          variableCandidates={[]}
        />
      </SchemaApplicationProvider>
    )

    const summary = screen.getByRole('region', { name: '函数内 Schema（只读）' })
    expect(within(summary).getByText('2 个，只读')).toBeInTheDocument()
    expect(await within(summary).findAllByText('朗读评分')).toHaveLength(2)
    expect(
      within(summary).getByRole('article', { name: '函数内评分单元 root-reading' })
    ).toHaveTextContent('主函数')
    const nestedUse = within(summary).getByRole('article', {
      name: '函数内评分单元 nested-reading'
    })
    expect(nestedUse).toHaveTextContent('主函数 / 子函数')
    expect(within(nestedUse).getByText('请朗读短文')).toBeInTheDocument()
    expect(within(nestedUse).getByText(/固定语音.*recording/)).toBeInTheDocument()
    expect(within(summary).queryByRole('button')).not.toBeInTheDocument()
    expect(within(summary).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('keeps the node-card editor compact by omitting the Schema summary', () => {
    render(
      <SchemaApplicationProvider repository={repository()}>
        <TemplateFunctionCallEditor
          compact
          apply={() => true}
          definition={root}
          functions={[root, nested]}
          node={node}
          variableCandidates={[]}
        />
      </SchemaApplicationProvider>
    )

    expect(screen.queryByRole('region', { name: '函数内 Schema（只读）' })).not.toBeInTheDocument()
  })

  it('derives choice-group source and range starts from available shapes', () => {
    const choiceDefinition: FunctionDef = {
      ...root,
      inputs: [
        {
          name: 'group',
          type: 'choice-group',
          shape: { kind: 'range', pageCounts: [2, 3, 4] }
        }
      ]
    }
    const choiceNode: FunctionNode = {
      ...node,
      inputs: {
        group: {
          type: 'choice-group',
          source: 'global',
          selection: { kind: 'range', startPage: 0 }
        }
      }
    }
    const candidates: TemplateChoiceGroupCandidate[] = [
      {
        key: 'global',
        label: '全局题组',
        source: 'global',
        shape: { kind: 'all', pageCounts: [1, 2, 3, 4, 5] }
      }
    ]

    render(
      <SchemaApplicationProvider repository={repository()}>
        <TemplateFunctionCallEditor
          compact
          apply={() => true}
          choiceGroupCandidates={candidates}
          definition={choiceDefinition}
          functions={[choiceDefinition]}
          node={choiceNode}
          variableCandidates={[]}
        />
      </SchemaApplicationProvider>
    )

    const rangeStart = screen.getByLabelText('节点 root-call 入参 group 起始页')
    expect(rangeStart).toHaveValue('1')
    expect(within(rangeStart).getAllByRole('option')).toHaveLength(1)
    expect(within(rangeStart).getByRole('option')).toHaveTextContent('第 2 页')
  })

  it('derives question page and question options from the selected group shape', () => {
    const choiceDefinition: FunctionDef = {
      ...root,
      inputs: [{ name: 'group', type: 'choice-group', shape: { kind: 'question' } }]
    }
    const choiceNode: FunctionNode = {
      ...node,
      inputs: {
        group: {
          type: 'choice-group',
          source: 'global',
          selection: { kind: 'question', pageIndex: 0, questionIndex: 0 }
        }
      }
    }
    render(
      <SchemaApplicationProvider repository={repository()}>
        <TemplateFunctionCallEditor
          compact
          apply={() => true}
          choiceGroupCandidates={[
            {
              key: 'global',
              label: '全局题组',
              source: 'global',
              shape: { kind: 'all', pageCounts: [2, 3] }
            }
          ]}
          definition={choiceDefinition}
          functions={[choiceDefinition]}
          node={choiceNode}
          variableCandidates={[]}
        />
      </SchemaApplicationProvider>
    )

    expect(screen.getByLabelText('节点 root-call 入参 group 页面')).toHaveValue('0')
    expect(screen.getByLabelText('节点 root-call 入参 group 题目')).toHaveValue('0')
    expect(
      within(screen.getByLabelText('节点 root-call 入参 group 页面')).getAllByRole('option')
    ).toHaveLength(2)
    expect(
      within(screen.getByLabelText('节点 root-call 入参 group 题目')).getAllByRole('option')
    ).toHaveLength(2)
  })
})
