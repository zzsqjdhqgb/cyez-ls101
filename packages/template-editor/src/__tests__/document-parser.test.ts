import { describe, expect, it } from 'vitest'
import { parseFunctionDocument, parseTemplateDocument } from '../document-parser'
import type { FunctionContent, FunctionDocument, TemplateDocument } from '../types'

const nestedCall = {
  id: 'nested-call',
  type: 'function' as const,
  functionRef: 'nested-function',
  inputs: {
    text: {
      type: 'string' as const,
      parts: [
        { type: 'literal' as const, value: 'Prefix ' },
        {
          type: 'variable' as const,
          ref: { scope: 'local' as const, name: 'local-text' }
        }
      ]
    },
    count: { type: 'number' as const, source: 'literal' as const, value: 2 },
    image: {
      type: 'file' as const,
      source: 'variable' as const,
      ref: { scope: 'interface' as const, alias: 'data', varName: 'image' }
    }
  },
  outputNames: { result: 'nested-result' }
}

function completeFunctionContent(): FunctionContent {
  return {
    name: 'Complete function',
    inputs: [
      { name: 'text', type: 'string' },
      { name: 'count', type: 'number' },
      { name: 'image', type: 'file' }
    ],
    body: {
      id: 'function-root',
      type: 'frame',
      children: [nestedCall]
    },
    outputs: [
      {
        name: 'literal-text',
        type: 'string',
        expression: { type: 'string', source: 'literal', value: 'Text' }
      },
      {
        name: 'joined-text',
        type: 'string',
        expression: {
          type: 'string',
          parts: [
            { type: 'literal', value: 'Value: ' },
            { type: 'variable', ref: { scope: 'local', name: 'text' } }
          ]
        }
      },
      {
        name: 'number',
        type: 'number',
        expression: {
          type: 'number',
          source: 'variable',
          ref: { scope: 'local', name: 'count' }
        }
      },
      {
        name: 'file',
        type: 'file',
        expression: { type: 'file', source: 'literal', value: 'file.png' }
      },
      {
        name: 'audio',
        type: 'audio',
        expression: { type: 'audio', source: 'record-output', name: 'recording' }
      },
      {
        name: 'choice',
        type: 'choice',
        expression: { type: 'choice', source: 'choice-output', name: 'answer' }
      }
    ],
    schemaUses: [completeSchemaUse()]
  }
}

function completeSchemaUse() {
  return {
    useId: 'all-bindings',
    schemaId: 'schema-id',
    blockId: 'block-id',
    bindings: {
      literalText: { type: 'literal' as const, value: 'Text' },
      literalNumber: { type: 'literal' as const, value: 1 },
      localVariable: { type: 'variable' as const, scope: 'local' as const, name: 'text' },
      interfaceVariable: {
        type: 'variable' as const,
        scope: 'interface' as const,
        alias: 'data',
        varName: 'prompt'
      },
      concat: {
        type: 'concat' as const,
        parts: [
          { type: 'literal' as const, value: 'Prefix ' },
          { type: 'variable' as const, scope: 'local' as const, name: 'text' }
        ]
      },
      recording: { type: 'record-output' as const, name: 'recording' },
      answer: { type: 'choice-output' as const, name: 'answer' }
    }
  }
}

function completeTemplate(): TemplateDocument {
  return {
    templateId: '10000000-0000-4000-8000-000000000001',
    revision: 3,
    content: {
      name: 'Complete template',
      description: '',
      interfaces: [
        { alias: 'data', interfaceId: 'interface-id', acceptedVars: ['prompt', 'image'] }
      ],
      root: {
        id: 'root',
        type: 'frame',
        choiceCollector: { pages: [{ questionCount: 1 }] },
        children: [
          {
            id: 'nested-frame',
            type: 'frame',
            children: [nestedCall]
          },
          {
            id: 'page',
            type: 'page',
            content: {
              blocks: [
                {
                  id: 'text',
                  type: 'text',
                  x: 0,
                  y: 0,
                  width: 50,
                  fontSize: 20,
                  bold: true,
                  align: 'center',
                  text: {
                    type: 'string',
                    parts: [
                      { type: 'literal', value: 'Prompt ' },
                      {
                        type: 'variable',
                        ref: { scope: 'interface', alias: 'data', varName: 'prompt' }
                      }
                    ]
                  }
                },
                {
                  id: 'image',
                  type: 'image',
                  x: 0,
                  y: 20,
                  width: 100,
                  src: { type: 'file', source: 'literal', value: 'image.png' }
                },
                {
                  id: 'choice-free',
                  type: 'choice-view',
                  x: 0,
                  y: 40,
                  width: 100,
                  height: 50,
                  defaultViewport: { mode: 'free', initialPage: 0 }
                }
              ]
            },
            timeline: [
              {
                type: 'play',
                src: {
                  type: 'file',
                  source: 'variable',
                  ref: { scope: 'interface', alias: 'data', varName: 'image' }
                },
                choiceViewOverrides: {
                  'choice-free': {
                    mode: 'focus',
                    questionRef: {
                      scope: 'absolute',
                      callPath: ['call'],
                      questionId: 'question'
                    }
                  }
                }
              },
              {
                type: 'countdown',
                seconds: { type: 'number', source: 'literal', value: 3 },
                choiceViewOverrides: {
                  'choice-free': { mode: 'range', startPage: 0, endPage: 1, initialPage: 0 }
                }
              },
              {
                type: 'record',
                duration: {
                  type: 'number',
                  source: 'variable',
                  ref: { scope: 'local', name: 'duration' }
                },
                outputName: 'recording'
              }
            ]
          },
          {
            id: 'question',
            type: 'choice-question',
            stem: { type: 'string', parts: [{ type: 'literal', value: 'Question' }] },
            options: [
              { id: 'a', content: { type: 'string', parts: [{ type: 'literal', value: 'A' }] } },
              { id: 'b', content: { type: 'string', parts: [{ type: 'literal', value: 'B' }] } }
            ],
            outputName: 'answer'
          }
        ]
      },
      schemaUses: [completeSchemaUse()]
    },
    resources: {
      functions: [{ id: 'resource-id', ...completeFunctionContent() }]
    },
    editorState: {
      zoom: 1.25,
      selected: null,
      flags: [true, false],
      viewport: { x: 0, y: 10 }
    }
  }
}

describe('工作文档结构解析器', () => {
  it('接受所有已定义节点、表达式、时间线、Schema 绑定和函数出参结构', () => {
    const template = completeTemplate()
    const func: FunctionDocument = {
      functionId: '20000000-0000-4000-8000-000000000001',
      revision: 2,
      content: completeFunctionContent(),
      editorState: { collapsed: ['root'] }
    }

    expect(parseTemplateDocument(template)).toBe(template)
    expect(parseFunctionDocument(func)).toBe(func)
  })

  it('拒绝不能安全遍历的判别联合和字段类型', () => {
    const cyclicEditorState: Record<string, unknown> = {}
    cyclicEditorState.self = cyclicEditorState
    const invalidValues: unknown[] = [
      null,
      { ...completeTemplate(), revision: -1 },
      { ...completeTemplate(), editorState: { invalid: Number.NaN } },
      { ...completeTemplate(), editorState: new Date() },
      { ...completeTemplate(), editorState: new Map([['zoom', 1]]) },
      { ...completeTemplate(), editorState: cyclicEditorState },
      {
        ...completeTemplate(),
        content: { ...completeTemplate().content, root: { id: 'root', type: 'unknown' } }
      },
      {
        ...completeTemplate(),
        content: {
          ...completeTemplate().content,
          root: {
            id: 'root',
            type: 'frame',
            children: [{ id: 'page', type: 'page', content: { blocks: [{}] }, timeline: [] }]
          }
        }
      },
      {
        ...completeTemplate(),
        content: { ...completeTemplate().content, schemaUses: [{ bindings: [] }] }
      }
    ]

    invalidValues.forEach((value) => expect(parseTemplateDocument(value)).toBeNull())
    expect(
      parseFunctionDocument({
        functionId: 'id',
        revision: 0,
        content: { ...completeFunctionContent(), outputs: [{ type: 'unknown' }] },
        editorState: {}
      })
    ).toBeNull()
  })
})
