import type { InterfaceVarManifest, SchemaDefinition } from '@ls101/core-types'
import { describe, expect, it } from 'vitest'
import { compileTemplate, type TemplateCompileContext } from '../compiler'
import { createFunctionResource } from '../id'
import type {
  FrameNode,
  FunctionContent,
  FunctionDef,
  FunctionNode,
  PageNode,
  SchemaTextExpression,
  SchemaUse,
  TemplateContent,
  TemplateDocument
} from '../types'
import { number, root, schemaDefinition, schemaText, text } from './fixtures'

const INTERFACE_ID = `sha256:${'1'.repeat(64)}`
const OTHER_INTERFACE_ID = `sha256:${'9'.repeat(64)}`
const SCHEMA_ID = `sha256:${'2'.repeat(64)}`
const AUDIO_SCHEMA_ID = `sha256:${'3'.repeat(64)}`
const CHOICE_SCHEMA_ID = `sha256:${'4'.repeat(64)}`
const FIXED_SCHEMA_ID = `sha256:${'5'.repeat(64)}`
const OTHER_SCHEMA_ID = `sha256:${'8'.repeat(64)}`

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

function schemaDefinitions(): SchemaDefinition[] {
  return [
    schemaDefinition(SCHEMA_ID, {
      questionType: 'freetalk',
      answerFormat: [],
      templateInputs: [{ inputId: 'prompt', type: 'text', required: true }]
    }),
    schemaDefinition(AUDIO_SCHEMA_ID, {
      questionType: 'freetalk',
      answerFormat: [{ answerId: 'recording', type: 'free-speech' }],
      templateInputs: []
    }),
    schemaDefinition(CHOICE_SCHEMA_ID, {
      questionType: 'objective',
      answerFormat: [{ answerId: 'answer', type: 'text' }],
      templateInputs: []
    }),
    schemaDefinition(FIXED_SCHEMA_ID, {
      questionType: 'fixed-reading',
      answerFormat: [{ answerId: 'reading', type: 'fixed-speech' }],
      templateInputs: [{ inputId: 'prompt', type: 'text', required: true }]
    })
  ]
}

function compileContext(overrides: Partial<TemplateCompileContext> = {}): TemplateCompileContext {
  return {
    interfaceManifests: [interfaceManifest()],
    schemaDefinitions: schemaDefinitions(),
    interfaceBindings: [
      {
        alias: 'exam',
        interfaceId: INTERFACE_ID,
        instanceId: 'instance-1'
      }
    ],
    locateInterfaceInstance: (instanceId) =>
      instanceId === 'instance-1'
        ? {
            interfaceId: INTERFACE_ID,
            instance: {
              instanceId: 'instance-1',
              name: 'Instance',
              generatedAt: '2026-08-04T00:00:00.000Z',
              values: { sentence: 'Hello', picture: 'picture.png' }
            },
            assetUrls: { 'picture.png': 'asset://instance-1/picture.png' }
          }
        : null,
    synthesizeSpeech: async () => ({ data: new Uint8Array([1, 2, 3]), mediaType: 'audio/wav' }),
    ...overrides
  }
}

function document(content: TemplateContent, functions: FunctionDef[] = []): TemplateDocument {
  return {
    templateId: 'template-1',
    revision: 0,
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
    schemaUses: [textSchemaUse('root-text', schemaText('Prompt'))],
    ...overrides
  }
}

function textSchemaUse(useId: string, prompt: SchemaTextExpression): SchemaUse {
  return {
    useId,
    schemaId: SCHEMA_ID,
    inputBindings: { prompt },
    answerBindings: {},
    attachments: []
  }
}

function audioSchemaUse(useId: string, outputName: string): SchemaUse {
  return {
    useId,
    schemaId: AUDIO_SCHEMA_ID,
    inputBindings: {},
    answerBindings: {
      recording: {
        type: 'free-speech',
        audio: { type: 'audio', source: 'record-output', name: outputName }
      }
    },
    attachments: []
  }
}

function choiceSchemaUse(useId: string, outputName: string): SchemaUse {
  return {
    useId,
    schemaId: CHOICE_SCHEMA_ID,
    inputBindings: {},
    answerBindings: { answer: { type: 'text', source: 'choice-output', name: outputName } },
    attachments: []
  }
}

function textFunctionContent(): FunctionContent {
  return {
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

function choiceFunctionContent(withSchemaUse = true): FunctionContent {
  return {
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
          height: 35,
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
        text: {
          type: 'string',
          parts: [
            { type: 'literal', value: 'Listen: ' },
            {
              type: 'variable',
              ref: { scope: 'interface', alias: 'exam', varName: 'sentence' }
            }
          ]
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

function speechOnlyContent(): TemplateContent {
  return content({
    root: root([
      {
        id: 'speech-page',
        type: 'page',
        content: { blocks: [] },
        timeline: [{ type: 'play', text: text('Hello') }]
      }
    ])
  })
}

describe('compileTemplate', () => {
  it('有播放动作但未提供语音合成器时返回稳定错误', async () => {
    const result = await compileTemplate(
      document(speechOnlyContent()),
      compileContext({ synthesizeSpeech: undefined })
    )

    expect(result).toMatchObject({
      success: false,
      errors: [
        {
          stage: 'compile',
          path: 'root.children[0].timeline[0].text',
          code: 'SPEECH_SYNTHESIZER_MISSING'
        }
      ]
    })
  })

  it('语音合成失败时保留来源路径和错误消息', async () => {
    const result = await compileTemplate(
      document(speechOnlyContent()),
      compileContext({
        synthesizeSpeech: async () => {
          throw new Error('provider unavailable')
        }
      })
    )

    expect(result).toMatchObject({
      success: false,
      errors: [
        {
          stage: 'compile',
          path: 'root.children[0].timeline[0].text',
          code: 'SPEECH_SYNTHESIS_FAILED',
          params: { message: 'provider unavailable' }
        }
      ]
    })
  })

  it.each([
    { name: '空音频', audio: { data: new Uint8Array(), mediaType: 'audio/wav' } },
    {
      name: '非音频媒体类型',
      audio: { data: new Uint8Array([1]), mediaType: 'application/octet-stream' }
    },
    {
      name: '非结构化返回值',
      audio: null as never
    }
  ])('拒绝语音合成器返回的无效数据：$name', async ({ audio }) => {
    const result = await compileTemplate(
      document(speechOnlyContent()),
      compileContext({ synthesizeSpeech: async () => audio })
    )

    expect(result).toMatchObject({
      success: false,
      errors: [
        {
          stage: 'compile',
          path: 'root.children[0].timeline[0].text',
          code: 'INVALID_SYNTHESIZED_AUDIO'
        }
      ]
    })
  })

  it('编译 fixed-speech 双槽位和 SchemaUse 局部附件资源', async () => {
    const exam = content({
      root: root([
        {
          id: 'recording-page',
          type: 'page',
          content: { blocks: [] },
          timeline: [{ type: 'record', duration: number(5), outputName: 'reading-audio' }]
        }
      ]),
      schemaUses: [
        {
          useId: 'reading',
          schemaId: FIXED_SCHEMA_ID,
          inputBindings: {
            prompt: {
              type: 'string',
              parts: [
                { type: 'literal', value: '![题图](' },
                { type: 'variable', ref: { scope: 'schema-use', varName: 'picture' } },
                { type: 'literal', value: ')' }
              ]
            }
          },
          answerBindings: {
            reading: {
              type: 'fixed-speech',
              text: {
                type: 'string',
                parts: [
                  {
                    type: 'variable',
                    ref: { scope: 'interface', alias: 'exam', varName: 'sentence' }
                  }
                ]
              },
              audio: { type: 'audio', source: 'record-output', name: 'reading-audio' }
            }
          },
          attachments: [
            {
              varName: 'picture',
              description: 'Question image',
              file: {
                type: 'file',
                source: 'variable',
                ref: { scope: 'interface', alias: 'exam', varName: 'picture' }
              }
            }
          ]
        }
      ]
    })

    const result = await compileTemplate(document(exam), compileContext())
    expect(result.success).toBe(true)
    if (!result.success) return

    const assetKey = 'schema-schema-use%3Areading-picture'
    expect(result.examPackage.submissionTemplate.schemaUses).toEqual([
      {
        instanceId: 'schema-use:reading',
        schema: schemaDefinitions()[3],
        inputs: [{ inputId: 'prompt', type: 'text', value: `![题图](resource:${assetKey})` }],
        answers: [
          {
            answerId: 'reading',
            type: 'fixed-speech',
            text: 'Hello',
            audioAnswerIndex: 0
          }
        ]
      }
    ])
    expect(result.examPackage.examData.resources).toEqual({
      [assetKey]: {
        filename: 'picture.png',
        packagePath: `resources/${assetKey}/picture.png`,
        mediaType: 'image/png'
      }
    })
    expect(result.examPackage.submissionTemplate.resources).toEqual(
      result.examPackage.examData.resources
    )
    expect(result.resourceSources).toEqual([
      { assetKey, sourceUrl: 'asset://instance-1/picture.png' }
    ])
  })

  it('展开完整 Template 为 Player 数据和 Schema 映射', async () => {
    const textResource = await createFunctionResource(textFunctionContent())
    const choiceResource = await createFunctionResource(choiceFunctionContent())
    const textCall = functionCall(
      'text-call',
      textResource.id,
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
      choiceResource.id,
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
          type: 'string',
          parts: [
            { type: 'literal', value: 'Resolved: ' },
            { type: 'variable', ref: { scope: 'local', name: 'outer-text' } }
          ]
        }),
        audioSchemaUse('root-audio', 'root-recording'),
        audioSchemaUse('root-audio-copy', 'root-recording'),
        choiceSchemaUse('root-choice', 'outer-answer')
      ]
    })

    const result = await compileTemplate(
      document(exam, [textResource, choiceResource]),
      compileContext()
    )
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.examPackage.examData.title).toBe('Compiled exam')
    expect(result.examPackage.examData.player.recordingIndices).toEqual([0])
    expect(result.examPackage.examData.player.choiceMeta).toEqual({
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

    const compiledPage = result.examPackage.examData.player.pages[0]
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
      width: 80,
      height: 35,
      src: 'resource:player-block%3Amain-page%2Fpicture'
    })
    expect(compiledPage.content[2]).toMatchObject({
      id: 'block:main-page/choices',
      defaultViewport: { mode: 'focus', choiceIndex: 0 }
    })
    expect(compiledPage.timeline).toEqual([
      { type: 'play', src: 'resource:player-tts-page%3Amain-page-0' },
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

    expect(result.examPackage.submissionTemplate.schemaUses).toEqual([
      {
        instanceId: 'schema-use:choice-call/inner-choice',
        schema: schemaDefinitions()[2],
        inputs: [],
        answers: [{ answerId: 'answer', type: 'text', stringAnswerIndex: 0 }]
      },
      {
        instanceId: 'schema-use:root-text',
        schema: schemaDefinitions()[0],
        inputs: [{ inputId: 'prompt', type: 'text', value: 'Resolved: Hello!' }],
        answers: []
      },
      {
        instanceId: 'schema-use:root-audio',
        schema: schemaDefinitions()[1],
        inputs: [],
        answers: [
          {
            answerId: 'recording',
            type: 'free-speech',
            audioAnswerIndex: 0
          }
        ]
      },
      {
        instanceId: 'schema-use:root-audio-copy',
        schema: schemaDefinitions()[1],
        inputs: [],
        answers: [
          {
            answerId: 'recording',
            type: 'free-speech',
            audioAnswerIndex: 0
          }
        ]
      },
      {
        instanceId: 'schema-use:root-choice',
        schema: schemaDefinitions()[2],
        inputs: [],
        answers: [{ answerId: 'answer', type: 'text', stringAnswerIndex: 0 }]
      }
    ])
    expect(result.examPackage.answerCapturePlan).toEqual({
      strings: [{ stringAnswerIndex: 0, choiceIndex: 0 }],
      audios: [{ audioAnswerIndex: 0, recordIndex: 0 }]
    })
    expect(result.examPackage.submissionTemplate.meta).toEqual({
      examPackageId: result.examPackage.packageId,
      examTitle: 'Compiled exam'
    })
    expect(result.examPackage.examData.resources).toHaveProperty(
      'player-block%3Amain-page%2Fpicture'
    )
    expect(result.examPackage.submissionTemplate.resources).toEqual({})
  })

  it('为重复函数调用生成独立题目、出参和 Schema useId', async () => {
    const choiceResource = await createFunctionResource(choiceFunctionContent())
    const call = (id: string, prompt: string, outputName: string): FunctionNode =>
      functionCall(
        id,
        choiceResource.id,
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
      timeline: [{ type: 'countdown', seconds: number(1) }]
    }
    const exam = content({
      root: collector(
        [focusPage, call('call-1', 'First', 'answer-1'), call('call-2', 'Second', 'answer-2')],
        [1, 1]
      ),
      schemaUses: []
    })

    const result = await compileTemplate(document(exam, [choiceResource]), compileContext())
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.examPackage.examData.player.choiceMeta?.pages).toEqual([
      { questionIndices: [0] },
      { questionIndices: [1] }
    ])
    expect(
      result.examPackage.examData.player.choiceMeta?.questions.map((question) => question.stem)
    ).toEqual(['First', 'Second'])
    expect(result.examPackage.examData.player.pages[0].content[0]).toMatchObject({
      defaultViewport: { mode: 'focus', choiceIndex: 1 }
    })
    expect(result.examPackage.submissionTemplate.schemaUses.map((use) => use.instanceId)).toEqual([
      'schema-use:call-1/inner-choice',
      'schema-use:call-2/inner-choice'
    ])
  })

  it('检测跨函数调用的静态值循环', async () => {
    const echo = await createFunctionResource({
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
    })
    const call = (id: string, inputName: string, outputName: string): FunctionNode =>
      functionCall(
        id,
        echo.id,
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
          type: 'string',
          parts: [{ type: 'variable', ref: { scope: 'local', name: 'value-a' } }]
        })
      ]
    })

    const result = await compileTemplate(
      document(exam, [echo]),
      compileContext({ interfaceBindings: [] })
    )
    expect(result).toMatchObject({
      success: false,
      errors: [{ stage: 'compile', code: 'STATIC_VALUE_CYCLE' }]
    })
  })

  it('返回 Interface 绑定缺失、归属不符和变量缺失错误', async () => {
    const missing = await compileTemplate(
      document(content()),
      compileContext({ interfaceBindings: [] })
    )
    expect(missing).toMatchObject({
      success: false,
      errors: [{ stage: 'compile', code: 'MISSING_INTERFACE_BINDING' }]
    })

    const mismatch = await compileTemplate(
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

    const missingValue = await compileTemplate(
      document(content()),
      compileContext({
        interfaceBindings: [
          {
            ...compileContext().interfaceBindings[0],
            instanceId: 'missing-picture'
          }
        ],
        locateInterfaceInstance: () => ({
          interfaceId: INTERFACE_ID,
          instance: {
            instanceId: 'missing-picture',
            name: 'Missing picture',
            generatedAt: '2026-08-04T00:00:00.000Z',
            values: { sentence: 'Hello' }
          },
          assetUrls: {}
        })
      })
    )
    expect(missingValue).toMatchObject({
      success: false,
      errors: [{ stage: 'compile', code: 'MISSING_INTERFACE_VALUE' }]
    })
  })

  it('拒绝重复和未知的 Interface 绑定', async () => {
    const base = compileContext().interfaceBindings[0]
    const result = await compileTemplate(
      document(content()),
      compileContext({
        interfaceBindings: [
          base,
          { ...base, instanceId: 'instance-2' },
          { alias: 'unknown', interfaceId: INTERFACE_ID, instanceId: 'instance-3' }
        ]
      })
    )

    expect(result).toEqual({
      success: false,
      errors: [
        {
          stage: 'compile',
          path: 'interfaceBindings[1].alias',
          code: 'DUPLICATE_INTERFACE_BINDING',
          params: { alias: 'exam' }
        },
        {
          stage: 'compile',
          path: 'interfaceBindings[2].alias',
          code: 'UNKNOWN_INTERFACE_BINDING',
          params: { alias: 'unknown' }
        }
      ]
    })
  })

  it('通过仓储定位结果校验实例真实归属和存在性', async () => {
    const ownershipMismatch = await compileTemplate(
      document(content()),
      compileContext({
        locateInterfaceInstance: () => ({
          interfaceId: OTHER_INTERFACE_ID,
          instance: {
            instanceId: 'instance-1',
            name: 'Wrong owner',
            generatedAt: '2026-08-04T00:00:00.000Z',
            values: { sentence: 'Hello', picture: 'picture.png' }
          },
          assetUrls: { 'picture.png': 'asset://wrong/picture.png' }
        })
      })
    )
    expect(ownershipMismatch).toEqual({
      success: false,
      errors: [
        {
          stage: 'compile',
          path: 'interfaceBindings[0].instanceId',
          code: 'INTERFACE_BINDING_ID_MISMATCH',
          params: {
            alias: 'exam',
            instanceId: 'instance-1',
            expected: INTERFACE_ID,
            actual: OTHER_INTERFACE_ID
          }
        }
      ]
    })

    const notFound = await compileTemplate(
      document(content()),
      compileContext({ locateInterfaceInstance: () => null })
    )
    expect(notFound).toEqual({
      success: false,
      errors: [
        {
          stage: 'compile',
          path: 'interfaceBindings[0].instanceId',
          code: 'INTERFACE_INSTANCE_NOT_FOUND',
          params: { alias: 'exam', instanceId: 'instance-1' }
        }
      ]
    })
  })

  it('隔离多个 Interface 的值并允许空字符串和多余实例值', async () => {
    const otherManifest: InterfaceVarManifest = {
      interfaceId: OTHER_INTERFACE_ID,
      interfaceName: 'Other data',
      vars: [
        {
          varName: 'sentence',
          type: 'text',
          description: 'Other sentence',
          example: 'Other',
          path: 'sentence'
        }
      ]
    }
    const otherSchema = schemaDefinition(
      OTHER_SCHEMA_ID,
      {
        questionType: 'freetalk',
        answerFormat: [],
        templateInputs: [{ inputId: 'prompt', type: 'text', required: true }]
      },
      'Other schema'
    )
    const exam = content({
      interfaces: [
        { alias: 'exam', interfaceId: INTERFACE_ID, acceptedVars: ['sentence'] },
        { alias: 'other', interfaceId: OTHER_INTERFACE_ID, acceptedVars: ['sentence'] }
      ],
      schemaUses: [
        textSchemaUse('exam-text', {
          type: 'string',
          parts: [
            {
              type: 'variable',
              ref: { scope: 'interface', alias: 'exam', varName: 'sentence' }
            }
          ]
        }),
        {
          useId: 'other-text',
          schemaId: OTHER_SCHEMA_ID,
          inputBindings: {
            prompt: {
              type: 'string',
              parts: [
                {
                  type: 'variable',
                  ref: { scope: 'interface', alias: 'other', varName: 'sentence' }
                }
              ]
            }
          },
          answerBindings: {},
          attachments: []
        }
      ]
    })
    const instances = {
      'instance-1': {
        interfaceId: INTERFACE_ID,
        instance: {
          instanceId: 'instance-1',
          name: 'Empty value',
          generatedAt: '2026-08-04T00:00:00.000Z',
          values: { sentence: '', extra: 'allowed' }
        },
        assetUrls: {}
      },
      'instance-2': {
        interfaceId: OTHER_INTERFACE_ID,
        instance: {
          instanceId: 'instance-2',
          name: 'Other value',
          generatedAt: '2026-08-04T00:00:00.000Z',
          values: { sentence: 'Other' }
        },
        assetUrls: {}
      }
    }
    const result = await compileTemplate(
      document(exam),
      compileContext({
        interfaceManifests: [interfaceManifest(), otherManifest],
        schemaDefinitions: [...schemaDefinitions(), otherSchema],
        interfaceBindings: [
          { alias: 'exam', interfaceId: INTERFACE_ID, instanceId: 'instance-1' },
          { alias: 'other', interfaceId: OTHER_INTERFACE_ID, instanceId: 'instance-2' }
        ],
        locateInterfaceInstance: (instanceId) =>
          instances[instanceId as keyof typeof instances] ?? null
      })
    )

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.examPackage.submissionTemplate.schemaUses).toEqual([
      {
        instanceId: 'schema-use:exam-text',
        schema: schemaDefinitions()[0],
        inputs: [{ inputId: 'prompt', type: 'text', value: '' }],
        answers: []
      },
      {
        instanceId: 'schema-use:other-text',
        schema: otherSchema,
        inputs: [{ inputId: 'prompt', type: 'text', value: 'Other' }],
        answers: []
      }
    ])
  })

  it('返回严格校验错误而不进入编译', async () => {
    const result = await compileTemplate(
      document(content({ name: '', schemaUses: [] })),
      compileContext()
    )

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors.every((error) => error.stage === 'validation')).toBe(true)
  })

  it('focus 地址不存在时返回编译错误', async () => {
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
      timeline: [{ type: 'countdown', seconds: number(1) }]
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

    const result = await compileTemplate(document(exam), compileContext({ interfaceBindings: [] }))
    expect(result).toMatchObject({
      success: false,
      errors: [{ stage: 'compile', code: 'UNKNOWN_FOCUS_QUESTION' }]
    })
  })
})
