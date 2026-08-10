import type { SchemaDefinition } from '@ls101/core-types'
import { describe, expect, it } from 'vitest'
import { compileTemplate, type TemplateCompileContext } from '../compiler'
import { createFunctionResource } from '../id'
import type {
  ChoiceQuestionRef,
  FunctionContent,
  FunctionNode,
  PageNode,
  SchemaUse,
  TemplateContent,
  TemplateDocument
} from '../types'
import { number, root, schemaDefinition, schemaText, text } from './fixtures'

const SCHEMA_ID = `sha256:${'2'.repeat(64)}`
const AUDIO_SCHEMA_ID = `sha256:${'3'.repeat(64)}`
const CHOICE_SCHEMA_ID = `sha256:${'4'.repeat(64)}`

const schemaDefinitions: SchemaDefinition[] = [
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
  })
]

function context(): TemplateCompileContext {
  return {
    interfaceManifests: [],
    schemaDefinitions,
    interfaceBindings: [],
    locateInterfaceInstance: () => null
  }
}

function document(
  content: TemplateContent,
  functions: TemplateDocument['resources']['functions'] = []
): TemplateDocument {
  return {
    templateId: 'template-id',
    revision: 0,
    content,
    resources: { functions },
    editorState: {}
  }
}

function content(overrides: Partial<TemplateContent> = {}): TemplateContent {
  return {
    name: 'Coverage',
    description: '',
    interfaces: [],
    root: root(),
    schemaUses: [textUse('text-use')],
    ...overrides
  }
}

function textUse(useId: string): SchemaUse {
  return {
    useId,
    schemaId: SCHEMA_ID,
    inputBindings: { prompt: schemaText('Prompt') },
    answerBindings: {},
    attachments: []
  }
}

function audioUse(useId: string, outputName: string): SchemaUse {
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

function choiceUse(useId: string, outputName: string): SchemaUse {
  return {
    useId,
    schemaId: CHOICE_SCHEMA_ID,
    inputBindings: {},
    answerBindings: { answer: { type: 'text', source: 'choice-output', name: outputName } },
    attachments: []
  }
}

function call(
  id: string,
  functionRef: string,
  outputNames: FunctionNode['outputNames'],
  inputs: FunctionNode['inputs'] = {}
): FunctionNode {
  return { id, type: 'function', functionRef, inputs, outputNames }
}

function focusFunctionContent(questionRef: ChoiceQuestionRef): FunctionContent {
  const focus = { mode: 'focus' as const, questionRef }
  return {
    name: 'Focused question',
    inputs: [{ name: 'stem', type: 'string' }],
    body: {
      ...root([
        {
          id: 'question',
          type: 'choice-question',
          stem: {
            type: 'string',
            parts: [{ type: 'variable', ref: { scope: 'local', name: 'stem' } }]
          },
          options: [
            { id: 'a', content: text('A') },
            { id: 'b', content: text('B') }
          ],
          outputName: 'answer'
        },
        {
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
                defaultViewport: focus
              }
            ]
          },
          timeline: [
            {
              type: 'countdown',
              seconds: number(1),
              choiceViewOverrides: { view: focus }
            }
          ]
        }
      ]),
      choiceCollector: { pages: [{ questionCount: 1 }] }
    },
    outputs: [
      {
        name: 'result',
        type: 'choice',
        expression: { type: 'choice', source: 'choice-output', name: 'answer' }
      }
    ],
    schemaUses: []
  }
}

function focusExam(functionRef: string, callId = 'call-1'): TemplateContent {
  return content({
    root: root([
      call(
        callId,
        functionRef,
        { result: 'answer-1' },
        { stem: { type: 'string', source: 'literal', value: 'First' } }
      )
    ]),
    schemaUses: [choiceUse('choice-1', 'answer-1')]
  })
}

describe('Template 编译组合覆盖', () => {
  it('函数中的选择题可以由外部 Collector 收集和分页', async () => {
    const resource = await createFunctionResource({
      name: 'Question source',
      inputs: [{ name: 'stem', type: 'string' }],
      body: root([
        {
          id: 'question',
          type: 'choice-question',
          stem: {
            type: 'string',
            parts: [{ type: 'variable', ref: { scope: 'local', name: 'stem' } }]
          },
          options: [
            { id: 'a', content: text('A') },
            { id: 'b', content: text('B') }
          ],
          outputName: 'answer'
        }
      ]),
      outputs: [
        {
          name: 'result',
          type: 'choice',
          expression: { type: 'choice', source: 'choice-output', name: 'answer' }
        }
      ],
      schemaUses: []
    })
    const result = await compileTemplate(
      document(
        content({
          root: {
            ...root([
              call(
                'call-1',
                resource.id,
                { result: 'answer-1' },
                { stem: { type: 'string', source: 'literal', value: 'First' } }
              ),
              call(
                'call-2',
                resource.id,
                { result: 'answer-2' },
                { stem: { type: 'string', source: 'literal', value: 'Second' } }
              )
            ]),
            choiceCollector: { pages: [{ questionCount: 1 }, { questionCount: 1 }] }
          },
          schemaUses: [choiceUse('choice-1', 'answer-1'), choiceUse('choice-2', 'answer-2')]
        }),
        [resource]
      ),
      context()
    )

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.examPackage.examData.player.choiceMeta).toMatchObject({
      pages: [{ questionIndices: [0] }, { questionIndices: [1] }],
      questions: [{ stem: 'First' }, { stem: 'Second' }]
    })
  })

  it('relative focus 在封装函数中解析到当前实例，包括时间线 override', async () => {
    const resource = await createFunctionResource(
      focusFunctionContent({ scope: 'relative', callPath: [], questionId: 'question' })
    )
    const result = await compileTemplate(document(focusExam(resource.id), [resource]), context())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.examPackage.examData.player.pages).toHaveLength(1)
    const page = result.examPackage.examData.player.pages[0]
    expect(page.content[0]).toMatchObject({
      defaultViewport: { mode: 'focus', choiceIndex: 0 }
    })
    expect(page.timeline[0]).toMatchObject({
      choiceViewOverrides: {
        'block:call-1/page/view': { mode: 'focus', choiceIndex: 0 }
      }
    })
  })

  it('absolute focus 从函数内部解析到 Template 根的指定调用实例', async () => {
    const resource = await createFunctionResource(
      focusFunctionContent({
        scope: 'absolute',
        callPath: ['call-2'],
        questionId: 'question'
      })
    )
    const result = await compileTemplate(
      document(focusExam(resource.id, 'call-2'), [resource]),
      context()
    )

    expect(result.success).toBe(true)
    if (!result.success) return
    const page = result.examPackage.examData.player.pages[0]
    expect(page.content[0]).toMatchObject({
      defaultViewport: { mode: 'focus', choiceIndex: 0 }
    })
    expect(page.timeline[0]).toMatchObject({
      choiceViewOverrides: expect.objectContaining({
        [page.content[0].id]: { mode: 'focus', choiceIndex: 0 }
      })
    })
  })

  it('编译 number/file 函数输入和静态出参，并在无选择题时省略 choiceMeta', async () => {
    const resource = await createFunctionResource({
      name: 'Static values',
      inputs: [
        { name: 'duration', type: 'number' },
        { name: 'media', type: 'file' }
      ],
      body: root(),
      outputs: [
        {
          name: 'duration-result',
          type: 'number',
          expression: {
            type: 'number',
            source: 'variable',
            ref: { scope: 'local', name: 'duration' }
          }
        },
        {
          name: 'media-result',
          type: 'file',
          expression: {
            type: 'file',
            source: 'variable',
            ref: { scope: 'local', name: 'media' }
          }
        }
      ],
      schemaUses: []
    })
    const page: PageNode = {
      id: 'page',
      type: 'page',
      content: {
        blocks: [
          {
            id: 'media',
            type: 'image',
            x: 0,
            y: 0,
            width: 100,
            height: 50,
            src: {
              type: 'file',
              source: 'variable',
              ref: { scope: 'local', name: 'compiled-file' }
            }
          }
        ]
      },
      timeline: [
        {
          type: 'play',
          text: text('Ready')
        },
        {
          type: 'countdown',
          seconds: {
            type: 'number',
            source: 'variable',
            ref: { scope: 'local', name: 'compiled-number' }
          }
        }
      ]
    }
    const exam = content({
      root: root([
        page,
        call(
          'static-call',
          resource.id,
          { 'duration-result': 'compiled-number', 'media-result': 'compiled-file' },
          {
            duration: number(7),
            media: { type: 'file', source: 'literal', value: 'audio.mp3' }
          }
        )
      ])
    })
    const result = await compileTemplate(document(exam, [resource]), context())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.examPackage.examData.player.pages[0].content[0]).toMatchObject({
      type: 'image',
      width: 100,
      height: 50,
      src: 'audio.mp3'
    })
    expect(result.examPackage.examData.player.pages[0].timeline).toEqual([
      { type: 'play', text: 'Ready' },
      { type: 'countdown', seconds: 7 }
    ])
    expect(result.examPackage.examData.player).not.toHaveProperty('choiceMeta')
  })

  it('按页面和嵌套函数展开顺序分配 recordIndex，并转发 audio 出参', async () => {
    const recorder = await createFunctionResource({
      name: 'Recorder',
      inputs: [],
      body: root([
        {
          id: 'record-page',
          type: 'page',
          content: { blocks: [] },
          timeline: [{ type: 'record', duration: number(3), outputName: 'recording' }]
        }
      ]),
      outputs: [
        {
          name: 'audio',
          type: 'audio',
          expression: { type: 'audio', source: 'record-output', name: 'recording' }
        }
      ],
      schemaUses: []
    })
    const wrapper = await createFunctionResource({
      name: 'Wrapper',
      inputs: [],
      body: root([call('nested-recorder', recorder.id, { audio: 'nested-audio' })]),
      outputs: [
        {
          name: 'audio',
          type: 'audio',
          expression: { type: 'audio', source: 'record-output', name: 'nested-audio' }
        }
      ],
      schemaUses: []
    })
    const rootPage: PageNode = {
      id: 'root-page',
      type: 'page',
      content: { blocks: [] },
      timeline: [{ type: 'record', duration: number(1), outputName: 'root-audio' }]
    }
    const exam = content({
      root: root([
        rootPage,
        call('wrapper-1', wrapper.id, { audio: 'audio-1' }),
        call('wrapper-2', wrapper.id, { audio: 'audio-2' })
      ]),
      schemaUses: [
        audioUse('root', 'root-audio'),
        audioUse('nested-1', 'audio-1'),
        audioUse('nested-2', 'audio-2')
      ]
    })
    const result = await compileTemplate(document(exam, [recorder, wrapper]), context())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.examPackage.examData.player.recordingIndices).toEqual([0, 1, 2])
    expect(
      result.examPackage.examData.player.pages.map((page) =>
        page.timeline[0].type === 'record' ? page.timeline[0].recordIndex : -1
      )
    ).toEqual([0, 1, 2])
    expect(result.examPackage.submissionTemplate.schemaUses.flatMap((use) => use.answers)).toEqual([
      { answerId: 'recording', type: 'free-speech', audioAnswerIndex: 0 },
      { answerId: 'recording', type: 'free-speech', audioAnswerIndex: 1 },
      { answerId: 'recording', type: 'free-speech', audioAnswerIndex: 2 }
    ])
  })

  it('稳定编码页面、块和 Schema use ID，并为 26 个选项生成 A-Z', async () => {
    const options = Array.from({ length: 26 }, (_, index) => ({
      id: `option-${index}`,
      content: text(`Option ${index}`)
    }))
    const exam = content({
      root: {
        id: 'root',
        type: 'frame',
        children: [
          {
            id: 'page/%',
            type: 'page',
            content: {
              blocks: [
                { id: 'block/%', type: 'text', x: 0, y: 0, text: text('Encoded') },
                {
                  id: 'view/%',
                  type: 'choice-view',
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                  defaultViewport: { mode: 'free' }
                }
              ]
            },
            timeline: []
          },
          {
            id: 'question',
            type: 'choice-question',
            stem: text('Question'),
            options,
            outputName: 'answer'
          }
        ],
        choiceCollector: { pages: [{ questionCount: 1 }] }
      },
      schemaUses: [choiceUse('use/%', 'answer')]
    })
    const result = await compileTemplate(document(exam), context())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.examPackage.examData.player.pages[0].id).toBe('page:page%2F%25')
    expect(result.examPackage.examData.player.pages[0].content.map((block) => block.id)).toEqual([
      'block:page%2F%25/block%2F%25',
      'block:page%2F%25/view%2F%25'
    ])
    expect(result.examPackage.submissionTemplate.schemaUses[0].instanceId).toBe(
      'schema-use:use%2F%25'
    )
    expect(
      result.examPackage.examData.player.choiceMeta?.questions[0].options.map(
        (option) => option.label
      )
    ).toEqual('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
  })
})
