import type { SchemaBlockManifest } from '@ls101/core-types'
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
import { number, root, text } from './fixtures'

const SCHEMA_ID = `sha256:${'2'.repeat(64)}`

const schemaManifest: SchemaBlockManifest = {
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

function context(): TemplateCompileContext {
  return {
    interfaceManifests: [],
    schemaManifests: [schemaManifest],
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
    blockId: 'text',
    bindings: { prompt: { type: 'literal', value: 'Prompt' } }
  }
}

function audioUse(useId: string, outputName: string): SchemaUse {
  return {
    useId,
    schemaId: SCHEMA_ID,
    blockId: 'audio',
    bindings: { recording: { type: 'record-output', name: outputName } }
  }
}

function choiceUse(useId: string, outputName: string): SchemaUse {
  return {
    useId,
    schemaId: SCHEMA_ID,
    blockId: 'choice',
    bindings: { answer: { type: 'choice-output', name: outputName } }
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

function focusExam(functionRef: string): TemplateContent {
  const functionCall = (id: string, stem: string, outputName: string) =>
    call(
      id,
      functionRef,
      { result: outputName },
      {
        stem: { type: 'string', source: 'literal', value: stem }
      }
    )
  return content({
    root: {
      id: 'root',
      type: 'frame',
      children: [
        functionCall('call-1', 'First', 'answer-1'),
        functionCall('call-2', 'Second', 'answer-2')
      ],
      choiceCollector: { pages: [{ questionCount: 1 }, { questionCount: 1 }] }
    },
    schemaUses: [choiceUse('choice-1', 'answer-1'), choiceUse('choice-2', 'answer-2')]
  })
}

describe('Template 编译组合覆盖', () => {
  it('relative focus 在每次函数调用中解析到当前实例，包括时间线 override', async () => {
    const resource = await createFunctionResource(
      focusFunctionContent({ scope: 'relative', callPath: [], questionId: 'question' })
    )
    const result = await compileTemplate(document(focusExam(resource.id), [resource]), context())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.examPackage.player.pages).toHaveLength(2)
    result.examPackage.player.pages.forEach((page, choiceIndex) => {
      expect(page.content[0]).toMatchObject({
        defaultViewport: { mode: 'focus', choiceIndex }
      })
      expect(page.timeline[0]).toMatchObject({
        choiceViewOverrides: {
          [`block:call-${choiceIndex + 1}/page/view`]: { mode: 'focus', choiceIndex }
        }
      })
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
    const result = await compileTemplate(document(focusExam(resource.id), [resource]), context())

    expect(result.success).toBe(true)
    if (!result.success) return
    result.examPackage.player.pages.forEach((page) => {
      expect(page.content[0]).toMatchObject({
        defaultViewport: { mode: 'focus', choiceIndex: 1 }
      })
      expect(page.timeline[0]).toMatchObject({
        choiceViewOverrides: expect.objectContaining({
          [page.content[0].id]: { mode: 'focus', choiceIndex: 1 }
        })
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
    expect(result.examPackage.player.pages[0].content[0]).toMatchObject({
      type: 'image',
      src: 'audio.mp3'
    })
    expect(result.examPackage.player.pages[0].timeline).toEqual([
      { type: 'play', text: 'Ready' },
      { type: 'countdown', seconds: 7 }
    ])
    expect(result.examPackage.player).not.toHaveProperty('choiceMeta')
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
    expect(result.examPackage.player.recordingIndices).toEqual([0, 1, 2])
    expect(
      result.examPackage.player.pages.map((page) =>
        page.timeline[0].type === 'record' ? page.timeline[0].recordIndex : -1
      )
    ).toEqual([0, 1, 2])
    expect(result.examPackage.schema.usages.flatMap((usage) => usage.fields)).toEqual([
      { varName: 'recording', type: 'audio', recordIndex: 0 },
      { varName: 'recording', type: 'audio', recordIndex: 1 },
      { varName: 'recording', type: 'audio', recordIndex: 2 }
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
    expect(result.examPackage.player.pages[0].id).toBe('page:page%2F%25')
    expect(result.examPackage.player.pages[0].content.map((block) => block.id)).toEqual([
      'block:page%2F%25/block%2F%25',
      'block:page%2F%25/view%2F%25'
    ])
    expect(result.examPackage.schema.usages[0].useId).toBe('schema-use:use%2F%25')
    expect(
      result.examPackage.player.choiceMeta?.questions[0].options.map((option) => option.label)
    ).toEqual('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
  })
})
