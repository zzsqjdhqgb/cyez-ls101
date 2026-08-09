import type { InterfaceVarManifest, SchemaBlockManifest } from '@ls101/core-types'
import { describe, expect, it } from 'vitest'
import type {
  ChoiceQuestionNode,
  ChoiceViewport,
  FunctionDef,
  PageNode,
  SchemaUse,
  TemplateContent
} from '../types'
import { validateTemplateContent, type TemplateValidationContext } from '../validation'
import { number, root, text } from './fixtures'

const INTERFACE_ID = `sha256:${'1'.repeat(64)}`
const SCHEMA_ID = `sha256:${'2'.repeat(64)}`
const FUNCTION_ID = `sha256:${'3'.repeat(64)}`

function interfaceManifest(): InterfaceVarManifest {
  return {
    interfaceId: INTERFACE_ID,
    interfaceName: 'Speaking',
    vars: [
      {
        varName: 'sentence',
        type: 'text',
        description: 'Sentence',
        example: 'Hello',
        path: 'sentence'
      }
    ]
  }
}

function schemaManifest(): SchemaBlockManifest {
  return {
    formatVersion: 1,
    schemaId: SCHEMA_ID,
    name: 'Scoring',
    blocks: [
      {
        blockId: 'text',
        name: 'Text',
        maxScore: 10,
        inputs: [{ inputId: 'prompt', name: 'Prompt', type: 'string' }]
      },
      {
        blockId: 'choice',
        name: 'Choice',
        maxScore: 10,
        inputs: [{ inputId: 'answer', name: 'Answer', type: 'string' }]
      }
    ]
  }
}

function context(overrides: Partial<TemplateValidationContext> = {}): TemplateValidationContext {
  return {
    interfaceManifests: [interfaceManifest()],
    schemaManifests: [schemaManifest()],
    functions: [],
    ...overrides
  }
}

function textUse(): SchemaUse {
  return {
    useId: 'text-use',
    schemaId: SCHEMA_ID,
    blockId: 'text',
    bindings: { prompt: { type: 'literal', value: 'Prompt' } }
  }
}

function choiceUse(outputName = 'answer-1'): SchemaUse {
  return {
    useId: 'choice-use',
    schemaId: SCHEMA_ID,
    blockId: 'choice',
    bindings: { answer: { type: 'choice-output', name: outputName } }
  }
}

function content(overrides: Partial<TemplateContent> = {}): TemplateContent {
  return {
    name: 'Template',
    description: '',
    interfaces: [{ alias: 'speaking', interfaceId: INTERFACE_ID, acceptedVars: ['sentence'] }],
    root: root(),
    schemaUses: [textUse()],
    ...overrides
  }
}

function question(id = 'question-1', outputName = 'answer-1'): ChoiceQuestionNode {
  return {
    id,
    type: 'choice-question',
    stem: text('Question'),
    options: [
      { id: 'a', content: text('A') },
      { id: 'b', content: text('B') }
    ],
    outputName
  }
}

function pageWithViewport(viewport: ChoiceViewport): PageNode {
  return {
    id: 'choice-page',
    type: 'page',
    content: {
      blocks: [
        {
          id: 'choice-view',
          type: 'choice-view',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          defaultViewport: viewport
        }
      ]
    },
    timeline: []
  }
}

function twoPageChoiceContent(viewport: ChoiceViewport): TemplateContent {
  return content({
    root: {
      id: 'root',
      type: 'frame',
      children: [
        question('question-1', 'answer-1'),
        question('question-2', 'answer-2'),
        pageWithViewport(viewport)
      ],
      choiceCollector: { pages: [{ questionCount: 1 }, { questionCount: 1 }] }
    },
    schemaUses: [choiceUse()]
  })
}

describe('Template 校验错误契约', () => {
  it('返回稳定的路径和参数，而不只返回错误码', () => {
    const result = validateTemplateContent(
      content({
        interfaces: [
          { alias: 'bad alias', interfaceId: INTERFACE_ID, acceptedVars: ['sentence', 'sentence'] }
        ]
      }),
      context()
    )

    expect(result).toEqual({
      valid: false,
      errors: [
        {
          path: 'interfaces[0].alias',
          code: 'INVALID_INTERFACE_ALIAS',
          params: { alias: 'bad alias' }
        },
        {
          path: 'interfaces[0].acceptedVars[1]',
          code: 'DUPLICATE_ACCEPTED_VAR',
          params: { varName: 'sentence' }
        }
      ]
    })
  })

  it('覆盖重复的 Interface、Schema 和函数清单', () => {
    const emptyFunction: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Empty',
      inputs: [],
      body: root(),
      outputs: [],
      schemaUses: []
    }
    const result = validateTemplateContent(
      content(),
      context({
        interfaceManifests: [interfaceManifest(), interfaceManifest()],
        schemaManifests: [schemaManifest(), schemaManifest()],
        functions: [emptyFunction, emptyFunction]
      })
    )

    expect(result.errors.slice(0, 3)).toEqual([
      {
        path: 'context.interfaceManifests[1]',
        code: 'DUPLICATE_INTERFACE_MANIFEST',
        params: { id: INTERFACE_ID }
      },
      {
        path: 'context.schemaManifests[1]',
        code: 'DUPLICATE_SCHEMA_MANIFEST',
        params: { id: SCHEMA_ID }
      },
      {
        path: 'context.functions[1]',
        code: 'DUPLICATE_FUNCTION_DEF',
        params: { id: FUNCTION_ID }
      }
    ])
  })

  it('覆盖空节点、内容块、无效局部名和未知 Interface 别名', () => {
    const result = validateTemplateContent(
      content({
        root: {
          id: '',
          type: 'frame',
          children: [
            {
              id: 'page',
              type: 'page',
              content: {
                blocks: [
                  {
                    id: '',
                    type: 'text',
                    x: 0,
                    y: 0,
                    text: {
                      type: 'string',
                      parts: [
                        {
                          type: 'variable',
                          ref: { scope: 'interface', alias: 'missing', varName: 'sentence' }
                        }
                      ]
                    }
                  }
                ]
              },
              timeline: [{ type: 'record', duration: number(1), outputName: 'bad name' }]
            }
          ]
        }
      }),
      context()
    )

    expect(result.errors).toEqual([
      { path: 'root.id', code: 'EMPTY_NODE_ID', params: {} },
      {
        path: 'root.children[0].content.blocks[0].id',
        code: 'EMPTY_CONTENT_BLOCK_ID',
        params: {}
      },
      {
        path: 'root.children[0].timeline[0].outputName',
        code: 'INVALID_LOCAL_NAME',
        params: { name: 'bad name' }
      },
      {
        path: 'root.children[0].content.blocks[0].text.parts[0]',
        code: 'UNKNOWN_INTERFACE_ALIAS',
        params: { alias: 'missing' }
      }
    ])
  })

  it('覆盖重复选项 ID 和 27 个选项上限', () => {
    const duplicate = question()
    duplicate.options[1].id = 'a'
    const tooMany = question('question-2', 'answer-2')
    tooMany.options = Array.from({ length: 27 }, (_, index) => ({
      id: `option-${index}`,
      content: text(String(index))
    }))
    const result = validateTemplateContent(
      content({
        root: {
          id: 'root',
          type: 'frame',
          children: [duplicate, tooMany],
          choiceCollector: { pages: [{ questionCount: 2 }] }
        },
        schemaUses: [choiceUse()]
      }),
      context()
    )

    expect(result.errors).toEqual([
      {
        path: 'root.children[0].options[1].id',
        code: 'DUPLICATE_CHOICE_OPTION_ID',
        params: { id: 'a' }
      },
      {
        path: 'root.children[1].options',
        code: 'INVALID_CHOICE_OPTION_COUNT',
        params: { count: 27 }
      }
    ])
  })

  it('覆盖空 Collector、空分页和无效页大小', () => {
    const empty = validateTemplateContent(
      content({
        root: { id: 'root', type: 'frame', children: [], choiceCollector: { pages: [] } }
      }),
      context()
    )
    expect(empty.errors).toEqual([
      { path: 'root.choiceCollector', code: 'EMPTY_CHOICE_COLLECTOR', params: {} },
      {
        path: 'root.choiceCollector.pages',
        code: 'EMPTY_CHOICE_COLLECTOR_PAGES',
        params: {}
      }
    ])

    const invalidSize = validateTemplateContent(
      content({
        root: {
          id: 'root',
          type: 'frame',
          children: [question()],
          choiceCollector: { pages: [{ questionCount: 0 }] }
        },
        schemaUses: [choiceUse()]
      }),
      context()
    )
    expect(invalidSize.errors).toEqual([
      {
        path: 'root.choiceCollector.pages[0].questionCount',
        code: 'INVALID_CHOICE_PAGE_SIZE',
        params: { value: 0 }
      },
      {
        path: 'root.choiceCollector.pages',
        code: 'CHOICE_PAGE_TOTAL_MISMATCH',
        params: { expected: 1, actual: 0 }
      }
    ])
  })

  it('覆盖空 focus 题目和无效调用路径', () => {
    const result = validateTemplateContent(
      twoPageChoiceContent({
        mode: 'focus',
        questionRef: { scope: 'relative', callPath: [''], questionId: '' }
      }),
      context()
    )

    expect(result.errors).toEqual([
      {
        path: 'root.children[2].content.blocks[0].defaultViewport.questionRef.questionId',
        code: 'EMPTY_FOCUS_REFERENCE',
        params: {}
      },
      {
        path: 'root.children[2].content.blocks[0].defaultViewport.questionRef.callPath[0]',
        code: 'INVALID_FOCUS_CALL_PATH',
        params: {}
      }
    ])
  })

  it.each([
    [{ mode: 'range', startPage: -1, endPage: 1 }, 'startPage', { value: -1, pageCount: 2 }],
    [{ mode: 'range', startPage: 0.5, endPage: 1 }, 'startPage', { value: 0.5, pageCount: 2 }],
    [{ mode: 'range', startPage: 1, endPage: 0 }, 'defaultViewport', { startPage: 1, endPage: 0 }],
    [
      { mode: 'range', startPage: 0, endPage: 0, initialPage: 1 },
      'initialPage',
      { initialPage: 1, startPage: 0, endPage: 0 }
    ]
  ] as const)('拒绝无效 range %#', (viewport, pathSuffix, params) => {
    const result = validateTemplateContent(twoPageChoiceContent(viewport), context())
    const path = `root.children[2].content.blocks[0].defaultViewport`

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      path: pathSuffix === 'defaultViewport' ? path : `${path}.${pathSuffix}`,
      code: 'INVALID_CHOICE_VIEWPORT',
      params
    })
  })

  it('接受 range 的闭区间边界', () => {
    expect(
      validateTemplateContent(
        twoPageChoiceContent({
          mode: 'range',
          startPage: 0,
          endPage: 1,
          initialPage: 1
        }),
        context()
      )
    ).toEqual({ valid: true, errors: [] })
  })

  it('允许函数中的选择题由外部 Collector 收集', () => {
    const func: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Question source',
      inputs: [],
      body: root([question()]),
      outputs: [],
      schemaUses: []
    }
    const template = content({
      root: {
        ...root([
          { id: 'call', type: 'function', functionRef: FUNCTION_ID, inputs: {}, outputNames: {} }
        ]),
        choiceCollector: { pages: [{ questionCount: 1 }] }
      }
    })

    expect(validateTemplateContent(template, context({ functions: [func] }))).toEqual({
      valid: true,
      errors: []
    })
  })

  it('拒绝函数内 ChoiceView 依赖函数外 Collector', () => {
    const func: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Leaky choice view',
      inputs: [],
      body: root([question(), pageWithViewport({ mode: 'free' })]),
      outputs: [],
      schemaUses: []
    }
    const template = content({
      root: {
        ...root([
          { id: 'call', type: 'function', functionRef: FUNCTION_ID, inputs: {}, outputNames: {} }
        ]),
        choiceCollector: { pages: [{ questionCount: 1 }] }
      }
    })

    expect(validateTemplateContent(template, context({ functions: [func] })).errors).toEqual([
      {
        path: 'root.children[0].function.body.children[1].content.blocks[0].defaultViewport',
        code: 'FUNCTION_CHOICE_VIEW_WITHOUT_LOCAL_COLLECTOR',
        params: {}
      }
    ])
  })

  it('允许函数在内部封装题目、Collector 和 ChoiceView', () => {
    const func: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Self-contained choice section',
      inputs: [],
      body: {
        ...root([question(), pageWithViewport({ mode: 'free' })]),
        choiceCollector: { pages: [{ questionCount: 1 }] }
      },
      outputs: [],
      schemaUses: []
    }
    const template = content({
      root: root([
        { id: 'call', type: 'function', functionRef: FUNCTION_ID, inputs: {}, outputNames: {} }
      ])
    })

    expect(validateTemplateContent(template, context({ functions: [func] }))).toEqual({
      valid: true,
      errors: []
    })
  })

  it('函数正文错误路径包含稳定的 function.body 段', () => {
    const func: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Broken block',
      inputs: [],
      body: root([
        {
          id: 'inner-page',
          type: 'page',
          content: { blocks: [{ id: '', type: 'text', x: 0, y: 0, text: text('') }] },
          timeline: []
        }
      ]),
      outputs: [],
      schemaUses: []
    }
    const result = validateTemplateContent(
      content({
        root: root([
          { id: 'call', type: 'function', functionRef: FUNCTION_ID, inputs: {}, outputNames: {} }
        ])
      }),
      context({ functions: [func] })
    )

    expect(result.errors).toEqual([
      {
        path: 'root.children[0].function.body.children[0].content.blocks[0].id',
        code: 'EMPTY_CONTENT_BLOCK_ID',
        params: {}
      }
    ])
  })

  it('函数只能通过输入接收 Interface 值，不能直接引用 Template alias', () => {
    const func: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Interface consumer',
      inputs: [],
      body: root([
        {
          id: 'inner-page',
          type: 'page',
          content: {
            blocks: [
              {
                id: 'prompt',
                type: 'text',
                x: 0,
                y: 0,
                text: {
                  type: 'string',
                  parts: [
                    {
                      type: 'variable',
                      ref: { scope: 'interface', alias: 'speaking', varName: 'sentence' }
                    }
                  ]
                }
              }
            ]
          },
          timeline: []
        }
      ]),
      outputs: [],
      schemaUses: []
    }
    const result = validateTemplateContent(
      content({
        root: root([
          { id: 'call', type: 'function', functionRef: FUNCTION_ID, inputs: {}, outputNames: {} }
        ])
      }),
      context({ functions: [func] })
    )

    expect(result.errors).toEqual([
      {
        path: 'root.children[0].function.body.children[0].content.blocks[0].text.parts[0]',
        code: 'INTERFACE_VARIABLE_IN_FUNCTION',
        params: { alias: 'speaking', varName: 'sentence' }
      }
    ])
  })

  it('允许 Template 调用点把 Interface 值绑定给函数输入', () => {
    const func: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Input consumer',
      inputs: [{ name: 'prompt', type: 'string' }],
      body: root([
        {
          id: 'inner-page',
          type: 'page',
          content: {
            blocks: [
              {
                id: 'prompt',
                type: 'text',
                x: 0,
                y: 0,
                text: {
                  type: 'string',
                  parts: [{ type: 'variable', ref: { scope: 'local', name: 'prompt' } }]
                }
              }
            ]
          },
          timeline: []
        }
      ]),
      outputs: [],
      schemaUses: []
    }
    const result = validateTemplateContent(
      content({
        root: root([
          {
            id: 'call',
            type: 'function',
            functionRef: FUNCTION_ID,
            inputs: {
              prompt: {
                type: 'string',
                source: 'variable',
                ref: { scope: 'interface', alias: 'speaking', varName: 'sentence' }
              }
            },
            outputNames: {}
          }
        ])
      }),
      context({ functions: [func] })
    )

    expect(result).toEqual({ valid: true, errors: [] })
  })
})
