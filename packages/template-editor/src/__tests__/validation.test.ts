import type { InterfaceVarManifest, SchemaBlockManifest } from '@ls101/core-types'
import { describe, expect, it } from 'vitest'
import type {
  ChoiceQuestionNode,
  FrameNode,
  FunctionDef,
  FunctionNode,
  PageNode,
  SchemaUse,
  TemplateContent,
  TextExpression
} from '../types'
import {
  validateTemplateContent,
  type TemplateValidationContext,
  type TemplateValidationErrorCode
} from '../validation'
import { number, root, templateContent, text } from './fixtures'

const INTERFACE_ID = `sha256:${'1'.repeat(64)}`
const SCHEMA_ID = `sha256:${'2'.repeat(64)}`
const FUNCTION_ID = `sha256:${'3'.repeat(64)}`

function interfaceManifest(): InterfaceVarManifest {
  return {
    interfaceId: INTERFACE_ID,
    interfaceName: 'Speaking data',
    vars: [
      {
        varName: 'sentence',
        type: 'text',
        description: 'Sentence',
        example: 'Hello',
        path: 'sentence'
      },
      {
        varName: 'audio',
        type: 'image',
        description: 'Audio file placeholder',
        example: 'audio.mp3',
        path: 'audio'
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
    formatVersion: 1,
    schemaId: SCHEMA_ID,
    name: 'Scoring',
    blocks: [
      {
        blockId: 'reading',
        name: 'Reading',
        maxScore: 10,
        inputs: [{ inputId: 'prompt', name: 'Prompt', type: 'string' }]
      },
      {
        blockId: 'recording',
        name: 'Recording',
        maxScore: 10,
        inputs: [{ inputId: 'recording', name: 'Recording', type: 'audio' }]
      },
      {
        blockId: 'single-choice',
        name: 'Single choice',
        maxScore: 10,
        inputs: [{ inputId: 'answer', name: 'Answer', type: 'string' }]
      }
    ]
  }
}

function validationContext(
  overrides: Partial<TemplateValidationContext> = {}
): TemplateValidationContext {
  return {
    interfaceManifests: [interfaceManifest()],
    schemaManifests: [schemaManifest()],
    functions: [],
    ...overrides
  }
}

function codes(
  content: TemplateContent,
  context = validationContext()
): TemplateValidationErrorCode[] {
  return validateTemplateContent(content, context).errors.map((error) => error.code)
}

function expectCode(
  content: TemplateContent,
  code: TemplateValidationErrorCode,
  context = validationContext()
): void {
  expect(codes(content, context)).toContain(code)
}

function page(overrides: Partial<PageNode> = {}): PageNode {
  return {
    id: 'page-1',
    type: 'page',
    content: { blocks: [] },
    timeline: [],
    ...overrides
  }
}

function question(id = 'question-1', outputName = 'answer-1'): ChoiceQuestionNode {
  return {
    id,
    type: 'choice-question',
    stem: text('Choose one'),
    options: [
      { id: `${id}-a`, content: text('A') },
      { id: `${id}-b`, content: text('B') }
    ],
    outputName
  }
}

function choiceSchemaUse(outputName = 'answer-1'): SchemaUse {
  return {
    useId: 'choice-use-1',
    schemaId: SCHEMA_ID,
    blockId: 'single-choice',
    bindings: {
      answer: { type: 'choice-output', name: outputName }
    }
  }
}

function collectedRoot(children: FrameNode['children'], pageSizes: number[]): FrameNode {
  return {
    id: 'root',
    type: 'frame',
    children,
    choiceCollector: {
      pages: pageSizes.map((questionCount) => ({ questionCount }))
    }
  }
}

function interfaceText(varName: string): TextExpression {
  return {
    type: 'string',
    parts: [
      {
        type: 'variable',
        ref: { scope: 'interface', alias: 'speaking', varName }
      }
    ]
  }
}

describe('validateTemplateContent - 基础依赖', () => {
  it('接受没有选择题的完整 Template', () => {
    expect(validateTemplateContent(templateContent(), validationContext())).toEqual({
      valid: true,
      errors: []
    })
  })

  it('拒绝空名称、未知 Interface 和空变量清单', () => {
    const content = templateContent({
      name: ' ',
      interfaces: [
        {
          alias: 'speaking',
          interfaceId: `sha256:${'9'.repeat(64)}`,
          acceptedVars: []
        }
      ]
    })
    const resultCodes = codes(content)

    expect(resultCodes).toContain('EMPTY_TEMPLATE_NAME')
    expect(resultCodes).toContain('UNKNOWN_INTERFACE')
    expect(resultCodes).toContain('EMPTY_ACCEPTED_VARS')
  })

  it('拒绝重复别名和 Interface 中不存在的 acceptedVar', () => {
    const content = templateContent({
      interfaces: [
        { alias: 'speaking', interfaceId: INTERFACE_ID, acceptedVars: ['missing'] },
        { alias: 'speaking', interfaceId: INTERFACE_ID, acceptedVars: ['sentence'] }
      ]
    })
    const resultCodes = codes(content)

    expect(resultCodes).toContain('DUPLICATE_INTERFACE_ALIAS')
    expect(resultCodes).toContain('UNKNOWN_INTERFACE_VAR')
  })

  it('Interface 变量必须被当前 Template 接受', () => {
    const content = templateContent({
      root: root([
        page({
          content: {
            blocks: [
              {
                id: 'text-1',
                type: 'text',
                x: 0,
                y: 0,
                text: interfaceText('picture')
              }
            ]
          }
        })
      ])
    })

    expectCode(content, 'INTERFACE_VAR_NOT_ACCEPTED')
  })

  it('拒绝将 image Interface 变量用于文本', () => {
    const content = templateContent({
      interfaces: [
        {
          alias: 'speaking',
          interfaceId: INTERFACE_ID,
          acceptedVars: ['sentence', 'picture']
        }
      ],
      root: root([
        page({
          content: {
            blocks: [
              {
                id: 'text-1',
                type: 'text',
                x: 0,
                y: 0,
                text: interfaceText('picture')
              }
            ]
          }
        })
      ])
    })

    expectCode(content, 'EXPRESSION_TYPE_MISMATCH')
  })
})

describe('validateTemplateContent - 局部作用域', () => {
  it('允许向前引用同一作用域中的静态输出', () => {
    const content = templateContent({
      root: root([
        page({
          content: {
            blocks: [
              {
                id: 'text-1',
                type: 'text',
                x: 0,
                y: 0,
                text: {
                  type: 'string',
                  parts: [
                    {
                      type: 'variable',
                      ref: { scope: 'local', name: 'later-text' }
                    }
                  ]
                }
              }
            ]
          }
        }),
        {
          id: 'text-function',
          type: 'function',
          functionRef: FUNCTION_ID,
          inputs: {},
          outputNames: { value: 'later-text' }
        }
      ])
    })
    const func: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Text',
      inputs: [],
      body: root(),
      outputs: [
        {
          name: 'value',
          type: 'string',
          expression: { type: 'string', source: 'literal', value: 'value' }
        }
      ],
      schemaUses: []
    }

    expect(validateTemplateContent(content, validationContext({ functions: [func] })).valid).toBe(
      true
    )
  })

  it('拒绝未知局部变量和重复输出名', () => {
    const content = templateContent({
      root: root([
        page({
          content: {
            blocks: [
              {
                id: 'text-1',
                type: 'text',
                x: 0,
                y: 0,
                text: {
                  type: 'string',
                  parts: [{ type: 'variable', ref: { scope: 'local', name: 'missing' } }]
                }
              }
            ]
          },
          timeline: [
            { type: 'record', duration: number(10), outputName: 'recording-1' },
            { type: 'record', duration: number(10), outputName: 'recording-1' }
          ]
        })
      ])
    })
    const resultCodes = codes(content)

    expect(resultCodes).toContain('UNKNOWN_LOCAL_VARIABLE')
    expect(resultCodes).toContain('DUPLICATE_LOCAL_NAME')
  })

  it('拒绝重复节点 ID、内容块 ID 和无效选项列表', () => {
    const invalidQuestion = question('same-id')
    invalidQuestion.options = [{ id: '', content: text('only') }]
    const content = templateContent({
      root: root([
        invalidQuestion,
        page({
          id: 'same-id',
          content: {
            blocks: [
              { id: 'same-block', type: 'text', x: 0, y: 0, text: text('one') },
              { id: 'same-block', type: 'text', x: 0, y: 10, text: text('two') }
            ]
          }
        })
      ])
    })
    const resultCodes = codes(content)

    expect(resultCodes).toContain('DUPLICATE_NODE_ID')
    expect(resultCodes).toContain('DUPLICATE_CONTENT_BLOCK_ID')
    expect(resultCodes).toContain('INVALID_CHOICE_OPTION_COUNT')
    expect(resultCodes).toContain('EMPTY_CHOICE_OPTION_ID')
  })
})

describe('validateTemplateContent - 函数', () => {
  function recordingFunction(): FunctionDef {
    return {
      id: FUNCTION_ID,
      name: 'Record answer',
      inputs: [{ name: 'duration', type: 'number' }],
      body: root([
        page({
          timeline: [
            {
              type: 'record',
              duration: {
                type: 'number',
                source: 'variable',
                ref: { scope: 'local', name: 'duration' }
              },
              outputName: 'recording-1'
            }
          ]
        })
      ]),
      outputs: [
        {
          name: 'recording',
          type: 'audio',
          expression: { type: 'audio', source: 'record-output', name: 'recording-1' }
        }
      ],
      schemaUses: [
        {
          useId: 'recording-use',
          schemaId: SCHEMA_ID,
          blockId: 'recording',
          bindings: {
            recording: { type: 'record-output', name: 'recording-1' }
          }
        }
      ]
    }
  }

  it('校验函数输入、内部 Schema 和调用点出参重命名', () => {
    const node: FunctionNode = {
      id: 'record-call',
      type: 'function',
      functionRef: FUNCTION_ID,
      inputs: { duration: number(10) },
      outputNames: { recording: 'outer-recording' }
    }
    const content = templateContent({ root: root([node]) })

    expect(
      validateTemplateContent(content, validationContext({ functions: [recordingFunction()] }))
        .valid
    ).toBe(true)
  })

  it('拒绝缺失或额外的输入和出参名称映射', () => {
    const content = templateContent({
      root: root([
        {
          id: 'record-call',
          type: 'function',
          functionRef: FUNCTION_ID,
          inputs: { extra: number(1) },
          outputNames: { extra: 'unused' }
        }
      ])
    })
    const resultCodes = codes(content, validationContext({ functions: [recordingFunction()] }))

    expect(resultCodes).toContain('MISSING_FUNCTION_INPUT')
    expect(resultCodes).toContain('UNKNOWN_FUNCTION_INPUT')
    expect(resultCodes).toContain('MISSING_FUNCTION_OUTPUT_NAME')
    expect(resultCodes).toContain('UNKNOWN_FUNCTION_OUTPUT_NAME')
  })

  it('函数可以独立提供 Template 所需的 Schema 消费', () => {
    const content = templateContent({
      root: root([
        {
          id: 'record-call',
          type: 'function',
          functionRef: FUNCTION_ID,
          inputs: { duration: number(10) },
          outputNames: { recording: 'outer-recording' }
        }
      ]),
      schemaUses: []
    })

    expect(
      validateTemplateContent(content, validationContext({ functions: [recordingFunction()] }))
        .valid
    ).toBe(true)
  })

  it('拒绝未知函数和递归调用', () => {
    const recursive: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Recursive',
      inputs: [],
      body: root([
        {
          id: 'recursive-call',
          type: 'function',
          functionRef: FUNCTION_ID,
          inputs: {},
          outputNames: {}
        }
      ]),
      outputs: [],
      schemaUses: []
    }
    const unknownContent = templateContent({
      root: root([
        {
          id: 'unknown-call',
          type: 'function',
          functionRef: 'missing',
          inputs: {},
          outputNames: {}
        }
      ])
    })
    const recursiveContent = templateContent({
      root: root([
        {
          id: 'recursive-root-call',
          type: 'function',
          functionRef: FUNCTION_ID,
          inputs: {},
          outputNames: {}
        }
      ])
    })

    expectCode(unknownContent, 'UNKNOWN_FUNCTION')
    expectCode(
      recursiveContent,
      'RECURSIVE_FUNCTION_CALL',
      validationContext({ functions: [recursive] })
    )
  })
})

describe('validateTemplateContent - Schema 绑定', () => {
  it('要求完整绑定且拒绝评分块外字段', () => {
    const content = templateContent({
      schemaUses: [
        {
          useId: 'reading-1',
          schemaId: SCHEMA_ID,
          blockId: 'reading',
          bindings: {
            extra: { type: 'literal', value: 'extra' }
          }
        }
      ]
    })
    const resultCodes = codes(content)

    expect(resultCodes).toContain('MISSING_SCHEMA_BINDING')
    expect(resultCodes).toContain('UNKNOWN_SCHEMA_BINDING')
  })

  it('允许把 choice 作答绑定到 string 接入口', () => {
    const content = templateContent({
      root: collectedRoot([question()], [1]),
      schemaUses: [
        {
          useId: 'reading-1',
          schemaId: SCHEMA_ID,
          blockId: 'reading',
          bindings: {
            prompt: { type: 'choice-output', name: 'answer-1' }
          }
        }
      ]
    })

    expect(codes(content)).not.toContain('SCHEMA_BINDING_TYPE_MISMATCH')
  })

  it('SchemaUse 必须引用存在的 Schema 和评分块', () => {
    const unknownSchema = templateContent({
      schemaUses: [
        {
          ...templateContent().schemaUses[0],
          schemaId: 'missing'
        }
      ]
    })
    const unknownBlock = templateContent({
      schemaUses: [
        {
          ...templateContent().schemaUses[0],
          blockId: 'missing'
        }
      ]
    })

    expectCode(unknownSchema, 'UNKNOWN_SCHEMA')
    expectCode(unknownBlock, 'UNKNOWN_SCHEMA_BLOCK')
  })

  it('展开后完全没有 Schema 消费时拒绝导出', () => {
    expectCode(templateContent({ schemaUses: [] }), 'NO_SCHEMA_USE')
  })

  it('同一作用域的 Schema useId 必须非空且唯一', () => {
    const first = { ...templateContent().schemaUses[0], useId: '' }
    const second = { ...templateContent().schemaUses[0], useId: '' }
    const resultCodes = codes(templateContent({ schemaUses: [first, second] }))

    expect(resultCodes).toContain('INVALID_SCHEMA_USE_ID')
    expect(resultCodes).toContain('DUPLICATE_SCHEMA_USE_ID')
  })
})

describe('validateTemplateContent - ChoiceCollector', () => {
  it('接受单题、分页、全局视图和 choice Schema 绑定', () => {
    const content = templateContent({
      root: collectedRoot(
        [
          question(),
          page({
            content: {
              blocks: [
                {
                  id: 'choice-view',
                  type: 'choice-view',
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                  defaultViewport: {
                    mode: 'focus',
                    questionRef: {
                      scope: 'relative',
                      callPath: [],
                      questionId: 'question-1'
                    }
                  }
                }
              ]
            },
            timeline: [
              {
                type: 'countdown',
                seconds: number(10),
                choiceViewOverrides: {
                  'choice-view': { mode: 'range', startPage: 0, endPage: 0 }
                }
              }
            ]
          })
        ],
        [1]
      ),
      schemaUses: [choiceSchemaUse()]
    })

    expect(validateTemplateContent(content, validationContext()).valid).toBe(true)
  })

  it('同一单题函数可多次调用并重命名出参后由外层统一收集', () => {
    const func: FunctionDef = {
      id: FUNCTION_ID,
      name: 'Single question',
      inputs: [],
      body: root([question('inner-question', 'inner-answer')]),
      outputs: [
        {
          name: 'answer',
          type: 'choice',
          expression: { type: 'choice', source: 'choice-output', name: 'inner-answer' }
        }
      ],
      schemaUses: []
    }
    const call = (id: string, outputName: string): FunctionNode => ({
      id,
      type: 'function',
      functionRef: FUNCTION_ID,
      inputs: {},
      outputNames: { answer: outputName }
    })
    const content = templateContent({
      root: collectedRoot([call('call-1', 'answer-1'), call('call-2', 'answer-2')], [2]),
      schemaUses: [choiceSchemaUse('answer-1')]
    })

    expect(validateTemplateContent(content, validationContext({ functions: [func] })).valid).toBe(
      true
    )
  })

  it('拒绝未收集题目和分页题数不匹配', () => {
    expectCode(
      templateContent({ root: root([question()]), schemaUses: [choiceSchemaUse()] }),
      'UNCOLLECTED_CHOICE_QUESTIONS'
    )
    expectCode(
      templateContent({ root: collectedRoot([question()], [2]), schemaUses: [choiceSchemaUse()] }),
      'CHOICE_PAGE_TOTAL_MISMATCH'
    )
  })

  it('拒绝嵌套 Collector 和多个候选', () => {
    const inner = collectedRoot([question()], [1])
    inner.id = 'inner-frame'
    inner.choiceCollector = { pages: [{ questionCount: 1 }] }
    const nested = templateContent({
      root: collectedRoot([inner], [1]),
      schemaUses: [choiceSchemaUse()]
    })
    const first = collectedRoot([question('q1', 'answer-1')], [1])
    first.id = 'first-frame'
    const second = collectedRoot([question('q2', 'answer-2')], [1])
    second.id = 'second-frame'
    const multiple = templateContent({
      root: root([first, second]),
      schemaUses: [choiceSchemaUse('answer-1')]
    })

    expectCode(nested, 'NESTED_CHOICE_COLLECTOR')
    expectCode(multiple, 'MULTIPLE_CHOICE_COLLECTORS')
  })

  it('拒绝越界视图页和指向非选择题块的时间线覆盖', () => {
    const content = templateContent({
      root: collectedRoot(
        [
          question(),
          page({
            content: {
              blocks: [
                { id: 'text-1', type: 'text', x: 0, y: 0, text: text('Text') },
                {
                  id: 'choice-view',
                  type: 'choice-view',
                  x: 0,
                  y: 10,
                  width: 100,
                  height: 90,
                  defaultViewport: { mode: 'free', initialPage: 1 }
                }
              ]
            },
            timeline: [
              {
                type: 'countdown',
                seconds: number(1),
                choiceViewOverrides: {
                  'text-1': { mode: 'free' }
                }
              }
            ]
          })
        ],
        [1]
      ),
      schemaUses: [choiceSchemaUse()]
    })
    const resultCodes = codes(content)

    expect(resultCodes).toContain('INVALID_CHOICE_VIEWPORT')
    expect(resultCodes).toContain('UNKNOWN_CHOICE_VIEW_OVERRIDE')
  })

  it('选择题视图在没有唯一 ChoiceMeta 时拒绝导出', () => {
    const content = templateContent({
      root: root([
        page({
          content: {
            blocks: [
              {
                id: 'choice-view',
                type: 'choice-view',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                defaultViewport: { mode: 'free' }
              }
            ]
          }
        })
      ])
    })

    expectCode(content, 'CHOICE_VIEW_WITHOUT_META')
  })
})
