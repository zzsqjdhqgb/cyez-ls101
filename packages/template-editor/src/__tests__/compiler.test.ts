import type { InterfaceVarManifest, SchemaBlockManifest } from '@ls101/core-types'
import { describe, expect, it } from 'vitest'
import { compileTemplate, type TemplateCompileContext } from '../compiler'
import type {
  FrameNode,
  FunctionDef,
  FunctionNode,
  PageNode,
  SchemaUse,
  TemplateContent,
  TemplateDocument
} from '../types'
import { number, root, text } from './fixtures'

const INTERFACE_ID = `sha256:${'1'.repeat(64)}`
const OTHER_INTERFACE_ID = `sha256:${'9'.repeat(64)}`
const SCHEMA_ID = `sha256:${'2'.repeat(64)}`
const TEXT_FUNCTION_ID = `sha256:${'3'.repeat(64)}`
const CHOICE_FUNCTION_ID = `sha256:${'4'.repeat(64)}`

function interfaceManifest(): InterfaceVarManifest {
  return {
    interfaceId: INTERFACE_ID,
    interfaceName: 'Exam data',
    vars: [
      {
        varName: 'sentence',
        type: 'text',
        description: 'Sentence',
        example: 'Hello',
        path: 'sentence'
      },
      {
        varName: 'picture',
        type: 'image',
        description: 'Picture',
        example: 'picture.png',
        path: 'picture'
      }
    ]
  }
}

function schemaManifest(): SchemaBlockManifest {
  return {
    schemaId: SCHEMA_ID,
    schemaName: 'Scoring',
    blocks: [
      {
        blockId: 'text',
        blockName: 'Text',
        fields: [{ varName: 'prompt', type: 'text' }]
      },
      {
        blockId: 'audio',
        blockName: 'Audio',
        fields: [{ varName: 'recording', type: 'audio' }]
      },
      {
        blockId: 'choice',
        blockName: 'Choice',
        fields: [{ varName: 'answer', type: 'choice' }]
      }
    ]
  }
}

function compileContext(overrides: Partial<TemplateCompileContext> = {}): TemplateCompileContext {
  return {
    interfaceManifests: [interfaceManifest()],
    schemaManifests: [schemaManifest()],
    interfaceBindings: [
      {
        alias: 'exam',
        interfaceId: INTERFACE_ID,
        instance: {
          instanceId: 'instance-1',
          name: 'Instance',
          generatedAt: '2026-08-04T00:00:00.000Z',
          values: { sentence: 'Hello', picture: 'picture.png' }
        }
      }
    ],
    ...overrides
  }
}

function document(content: TemplateContent, functions: FunctionDef[] = []): TemplateDocument {
  return {
    templateId: 'template-1',
    content,
    resources: { functions },
    editorState: {}
  }
}

function content(overrides: Partial<TemplateContent> = {}): TemplateContent {
  return {
    name: 'Compiled exam',
    description: 'Compiler fixture',
    interfaces: [
      {
        alias: 'exam',
        interfaceId: INTERFACE_ID,
        acceptedVars: ['sentence', 'picture']
      }
    ],
    root: root(),
    schemaUses: [textSchemaUse('root-text', { type: 'literal', value: 'Prompt' })],
    ...overrides
  }
}

function textSchemaUse(useId: string, prompt: SchemaUse['bindings'][string]): SchemaUse {
  return {
    useId,
    schemaId: SCHEMA_ID,
    blockId: 'text',
    bindings: { prompt }
  }
}

function audioSchemaUse(useId: string, outputName: string): SchemaUse {
  return {
    useId,
    schemaId: SCHEMA_ID,
    blockId: 'audio',
    bindings: { recording: { type: 'record-output', name: outputName } }
  }
}

function choiceSchemaUse(useId: string, outputName: string): SchemaUse {
  return {
    useId,
    schemaId: SCHEMA_ID,
    blockId: 'choice',
    bindings: { answer: { type: 'choice-output', name: outputName } }
  }
}

function textFunction(): FunctionDef {
  return {
    id: TEXT_FUNCTION_ID,
    name: 'Append punctuation',
    inputs: [{ name: 'value', type: 'string' }],
    body: root(),
    outputs: [
      {
        name: 'result',
        type: 'string',
        expression: {
          type: 'string',
          parts: [
            { type: 'variable', ref: { scope: 'local', name: 'value' } },
            { type: 'literal', value: '!' }
          ]
        }
      }
    ],
    schemaUses: []
  }
}

function choiceFunction(withSchemaUse = true): FunctionDef {
  return {
    id: CHOICE_FUNCTION_ID,
    name: 'Single choice',
    inputs: [{ name: 'prompt', type: 'string' }],
    body: root([
      {
        id: 'inner-question',
        type: 'choice-question',
        stem: {
          type: 'string',
          parts: [{ type: 'variable', ref: { scope: 'local', name: 'prompt' } }]
        },
        options: [
          { id: 'yes', content: text('Yes') },
          { id: 'no', content: text('No') }
        ],
        outputName: 'inner-answer'
      }
    ]),
    outputs: [
      {
        name: 'answer',
        type: 'choice',
        expression: { type: 'choice', source: 'choice-output', name: 'inner-answer' }
      }
    ],
    schemaUses: withSchemaUse ? [choiceSchemaUse('inner-choice', 'inner-answer')] : []
  }
}

function functionCall(
  id: string,
  functionRef: string,
  inputs: FunctionNode['inputs'],
  outputNames: FunctionNode['outputNames']
): FunctionNode {
  return { id, type: 'function', functionRef, inputs, outputNames }
}

function collector(children: FrameNode['children'], pageSizes: number[]): FrameNode {
  return {
    id: 'root',
    type: 'frame',
    children,
    choiceCollector: {
      pages: pageSizes.map((questionCount) => ({ questionCount }))
    }
  }
}

function mainPage(): PageNode {
  return {
    id: 'main-page',
    type: 'page',
    content: {
      blocks: [
        {
          id: 'prompt',
          type: 'text',
          x: 10,
          y: 10,
          width: 80,
          fontSize: 30,
          bold: true,
          align: 'center',
          text: {
            type: 'string',
            parts: [
              { type: 'literal', value: 'Prompt: ' },
              { type: 'variable', ref: { scope: 'local', name: 'outer-text' } }
            ]
          }
        },
        {
          id: 'picture',
          type: 'image',
          x: 10,
          y: 25,
          width: 80,
          src: {
            type: 'file',
            source: 'variable',
            ref: { scope: 'interface', alias: 'exam', varName: 'picture' }
          }
        },
        {
          id: 'choices',
          type: 'choice-view',
          x: 10,
          y: 50,
          width: 80,
          height: 40,
          defaultViewport: {
            mode: 'focus',
            questionRef: {
              scope: 'relative',
              callPath: ['choice-call'],
              questionId: 'inner-question'
            }
          }
        }
      ]
    },
    timeline: [
      {
        type: 'play',
        src: {
          type: 'file',
          source: 'variable',
          ref: { scope: 'interface', alias: 'exam', varName: 'picture' }
        }
      },
      { type: 'countdown', seconds: number(3) },
      {
        type: 'record',
        duration: number(5),
        outputName: 'root-recording',
        choiceViewOverrides: {
          choices: { mode: 'range', startPage: 0, endPage: 0 }
        }
      }
    ]
  }
}

describe('compileTemplate', () => {
  it('展开完整 Template 为 Player 数据和 Schema 映射', () => {
    const textCall = functionCall(
      'text-call',
      TEXT_FUNCTION_ID,
      {
        value: {
          type: 'string',
          source: 'variable',
          ref: { scope: 'interface', alias: 'exam', varName: 'sentence' }
        }
      },
      { result: 'outer-text' }
    )
    const choiceCall = functionCall(
      'choice-call',
      CHOICE_FUNCTION_ID,
      {
        prompt: {
          type: 'string',
          source: 'variable',
          ref: { scope: 'interface', alias: 'exam', varName: 'sentence' }
        }
      },
      { answer: 'outer-answer' }
    )
    const exam = content({
      root: collector([mainPage(), textCall, choiceCall], [1]),
      schemaUses: [
        textSchemaUse('root-text', {
          type: 'concat',
          parts: [
            { type: 'literal', value: 'Resolved: ' },
            { type: 'variable', scope: 'local', name: 'outer-text' }
          ]
        }),
        audioSchemaUse('root-audio', 'root-recording'),
        choiceSchemaUse('root-choice', 'outer-answer')
      ]
    })

    const result = compileTemplate(
      document(exam, [textFunction(), choiceFunction()]),
      compileContext()
    )
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.examPackage.title).toBe('Compiled exam')
    expect(result.examPackage.player.recordingIndices).toEqual([0])
    expect(result.examPackage.player.choiceMeta).toEqual({
      pages: [{ questionIndices: [0] }],
      questions: [
        {
          choiceIndex: 0,
          stem: 'Hello',
          options: [
            { label: 'A', content: 'Yes' },
            { label: 'B', content: 'No' }
          ]
        }
      ]
    })

    const compiledPage = result.examPackage.player.pages[0]
    expect(compiledPage.id).toBe('page:main-page')
    expect(compiledPage.content[0]).toEqual({
      id: 'block:main-page/prompt',
      type: 'text',
      x: 10,
      y: 10,
      width: 80,
      fontSize: 30,
      bold: true,
      align: 'center',
      text: 'Prompt: Hello!'
    })
    expect(compiledPage.content[1]).toMatchObject({
      id: 'block:main-page/picture',
      type: 'image',
      src: 'picture.png'
    })
    expect(compiledPage.content[2]).toMatchObject({
      id: 'block:main-page/choices',
      defaultViewport: { mode: 'focus', choiceIndex: 0 }
    })
    expect(compiledPage.timeline).toEqual([
      { type: 'play', src: 'picture.png' },
      { type: 'countdown', seconds: 3 },
      {
        type: 'record',
        duration: 5,
        recordIndex: 0,
        choiceViewOverrides: {
          'block:main-page/choices': { mode: 'range', startPage: 0, endPage: 0 }
        }
      }
    ])

    expect(result.examPackage.schema.usages).toEqual([
      {
        useId: 'schema-use:choice-call/inner-choice',
        schemaId: SCHEMA_ID,
        blockId: 'choice',
        fields: [{ varName: 'answer', type: 'choice', choiceIndex: 0 }]
      },
      {
        useId: 'schema-use:root-text',
        schemaId: SCHEMA_ID,
        blockId: 'text',
        fields: [{ varName: 'prompt', type: 'text', value: 'Resolved: Hello!' }]
      },
      {
        useId: 'schema-use:root-audio',
        schemaId: SCHEMA_ID,
        blockId: 'audio',
        fields: [{ varName: 'recording', type: 'audio', recordIndex: 0 }]
      },
      {
        useId: 'schema-use:root-choice',
        schemaId: SCHEMA_ID,
        blockId: 'choice',
        fields: [{ varName: 'answer', type: 'choice', choiceIndex: 0 }]
      }
    ])
  })

  it('为重复函数调用生成独立题目、出参和 Schema useId', () => {
    const call = (id: string, prompt: string, outputName: string): FunctionNode =>
      functionCall(
        id,
        CHOICE_FUNCTION_ID,
        { prompt: { type: 'string', source: 'literal', value: prompt } },
        { answer: outputName }
      )
    const focusPage: PageNode = {
      id: 'focus-page',
      type: 'page',
      content: {
        blocks: [
          {
            id: 'view',
            type: 'choice-view',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            defaultViewport: {
              mode: 'focus',
              questionRef: {
                scope: 'absolute',
                callPath: ['call-2'],
                questionId: 'inner-question'
              }
            }
          }
        ]
      },
      timeline: []
    }
    const exam = content({
      root: collector(
        [focusPage, call('call-1', 'First', 'answer-1'), call('call-2', 'Second', 'answer-2')],
        [1, 1]
      ),
      schemaUses: []
    })

    const result = compileTemplate(document(exam, [choiceFunction()]), compileContext())
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.examPackage.player.choiceMeta?.pages).toEqual([
      { questionIndices: [0] },
      { questionIndices: [1] }
    ])
    expect(
      result.examPackage.player.choiceMeta?.questions.map((question) => question.stem)
    ).toEqual(['First', 'Second'])
    expect(result.examPackage.player.pages[0].content[0]).toMatchObject({
      defaultViewport: { mode: 'focus', choiceIndex: 1 }
    })
    expect(result.examPackage.schema.usages.map((usage) => usage.useId)).toEqual([
      'schema-use:call-1/inner-choice',
      'schema-use:call-2/inner-choice'
    ])
  })

  it('检测跨函数调用的静态值循环', () => {
    const echo: FunctionDef = {
      id: TEXT_FUNCTION_ID,
      name: 'Echo',
      inputs: [{ name: 'value', type: 'string' }],
      body: root(),
      outputs: [
        {
          name: 'result',
          type: 'string',
          expression: {
            type: 'string',
            source: 'variable',
            ref: { scope: 'local', name: 'value' }
          }
        }
      ],
      schemaUses: []
    }
    const call = (id: string, inputName: string, outputName: string): FunctionNode =>
      functionCall(
        id,
        TEXT_FUNCTION_ID,
        {
          value: {
            type: 'string',
            source: 'variable',
            ref: { scope: 'local', name: inputName }
          }
        },
        { result: outputName }
      )
    const exam = content({
      interfaces: [],
      root: root([call('call-a', 'value-b', 'value-a'), call('call-b', 'value-a', 'value-b')]),
      schemaUses: [
        textSchemaUse('cycle', {
          type: 'variable',
          scope: 'local',
          name: 'value-a'
        })
      ]
    })

    const result = compileTemplate(
      document(exam, [echo]),
      compileContext({ interfaceBindings: [] })
    )
    expect(result).toMatchObject({
      success: false,
      errors: [{ stage: 'compile', code: 'STATIC_VALUE_CYCLE' }]
    })
  })

  it('返回 Interface 绑定缺失、归属不符和变量缺失错误', () => {
    const missing = compileTemplate(document(content()), compileContext({ interfaceBindings: [] }))
    expect(missing).toMatchObject({
      success: false,
      errors: [{ stage: 'compile', code: 'MISSING_INTERFACE_BINDING' }]
    })

    const mismatch = compileTemplate(
      document(content()),
      compileContext({
        interfaceBindings: [
          {
            ...compileContext().interfaceBindings[0],
            interfaceId: OTHER_INTERFACE_ID
          }
        ]
      })
    )
    expect(mismatch).toMatchObject({
      success: false,
      errors: [{ stage: 'compile', code: 'INTERFACE_BINDING_ID_MISMATCH' }]
    })

    const missingValue = compileTemplate(
      document(content()),
      compileContext({
        interfaceBindings: [
          {
            ...compileContext().interfaceBindings[0],
            instance: {
              ...compileContext().interfaceBindings[0].instance,
              values: { sentence: 'Hello' }
            }
          }
        ]
      })
    )
    expect(missingValue).toMatchObject({
      success: false,
      errors: [{ stage: 'compile', code: 'MISSING_INTERFACE_VALUE' }]
    })
  })

  it('返回严格校验错误而不进入编译', () => {
    const result = compileTemplate(
      document(content({ name: '', schemaUses: [] })),
      compileContext()
    )

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors.every((error) => error.stage === 'validation')).toBe(true)
  })

  it('focus 地址不存在时返回编译错误', () => {
    const pageWithUnknownFocus: PageNode = {
      id: 'page',
      type: 'page',
      content: {
        blocks: [
          {
            id: 'view',
            type: 'choice-view',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            defaultViewport: {
              mode: 'focus',
              questionRef: {
                scope: 'absolute',
                callPath: [],
                questionId: 'missing'
              }
            }
          }
        ]
      },
      timeline: []
    }
    const directQuestion = {
      id: 'question',
      type: 'choice-question' as const,
      stem: text('Question'),
      options: [
        { id: 'a', content: text('A') },
        { id: 'b', content: text('B') }
      ],
      outputName: 'answer'
    }
    const exam = content({
      interfaces: [],
      root: collector([pageWithUnknownFocus, directQuestion], [1]),
      schemaUses: [choiceSchemaUse('choice', 'answer')]
    })

    const result = compileTemplate(document(exam), compileContext({ interfaceBindings: [] }))
    expect(result).toMatchObject({
      success: false,
      errors: [{ stage: 'compile', code: 'UNKNOWN_FOCUS_QUESTION' }]
    })
  })
})
