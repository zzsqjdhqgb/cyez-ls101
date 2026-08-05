import { describe, expect, it } from 'vitest'
import { createFunctionDocument, createFunctionResource, createTemplateDocument } from '../id'
import { editFunctionDocument, editTemplateDocument } from '../mutations'
import type { FunctionDocumentOperation, TemplateDocumentOperation } from '../mutations'
import type {
  ChoiceQuestionNode,
  FunctionContent,
  FunctionNode,
  PageNode,
  TemplateContent,
  TemplateDocument,
  TemplateNode
} from '../types'
import { number, root, text } from './fixtures'

function template(children: TemplateNode[] = []): TemplateDocument {
  const content: TemplateContent = {
    name: 'Template',
    description: '',
    interfaces: [],
    root: root(children),
    schemaUses: []
  }
  return createTemplateDocument(content)
}

function question(id: string, outputName: string): ChoiceQuestionNode {
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

function page(id = 'page'): PageNode {
  return {
    id,
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
          defaultViewport: { mode: 'free' }
        }
      ]
    },
    timeline: [
      {
        type: 'countdown',
        seconds: number(1),
        choiceViewOverrides: {
          'choice-view': {
            mode: 'focus',
            questionRef: { scope: 'relative', callPath: [], questionId: 'question' }
          }
        }
      }
    ]
  }
}

function applyTemplateEdit(
  document: TemplateDocument,
  operation: TemplateDocumentOperation
): TemplateDocument {
  const result = editTemplateDocument(document, operation)
  expect(result.applied).toBe(true)
  if (!result.applied) throw new Error(`${result.error.code}: ${result.error.path}`)
  return result.document
}

function applyFunctionEdit(
  document: ReturnType<typeof createFunctionDocument>,
  operation: FunctionDocumentOperation
): ReturnType<typeof createFunctionDocument> {
  const result = editFunctionDocument(document, operation)
  expect(result.applied).toBe(true)
  if (!result.applied) throw new Error(`${result.error.code}: ${result.error.path}`)
  return result.document
}

describe('Template 文档编辑', () => {
  it('插入节点时生成不冲突的节点 ID 和局部输出名，并保持 revision', () => {
    const document = template([question('question', 'answer')])
    const result = editTemplateDocument(document, {
      type: 'insert-node',
      parentId: 'root',
      node: question('question', 'answer')
    })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.document.revision).toBe(document.revision)
    expect(result.document.content.root.children[1]).toMatchObject({
      id: 'question-1',
      outputName: 'answer-1'
    })
    expect(document.content.root.children).toHaveLength(1)
    expect(result.previousDocument).toBe(document)
  })

  it('复制子树时同步重命名内部局部引用和 focus 地址', () => {
    const source = {
      id: 'section',
      type: 'frame' as const,
      children: [
        question('question', 'answer'),
        {
          id: 'call',
          type: 'function' as const,
          functionRef: 'function',
          inputs: {
            prompt: {
              type: 'string' as const,
              source: 'variable' as const,
              ref: { scope: 'local' as const, name: 'answer' }
            }
          },
          outputNames: { result: 'result' }
        },
        {
          ...page(),
          id: 'display',
          content: {
            blocks: [
              {
                id: 'focus',
                type: 'choice-view' as const,
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                defaultViewport: {
                  mode: 'focus' as const,
                  questionRef: {
                    scope: 'relative' as const,
                    callPath: ['call'],
                    questionId: 'question'
                  }
                }
              }
            ]
          },
          timeline: []
        }
      ]
    }
    const document = template([source])
    const result = editTemplateDocument(document, {
      type: 'copy-node',
      nodeId: 'section',
      parentId: 'root'
    })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    const copy = result.document.content.root.children[1]
    expect(copy).toMatchObject({ id: 'section-1', type: 'frame' })
    if (copy.type !== 'frame') return
    const copiedQuestion = copy.children[0]
    const copiedCall = copy.children[1]
    const copiedPage = copy.children[2]
    expect(copiedQuestion).toMatchObject({ id: 'question-1', outputName: 'answer-1' })
    expect(copiedCall).toMatchObject({
      id: 'call-1',
      inputs: { prompt: { ref: { name: 'answer-1' } } },
      outputNames: { result: 'result-1' }
    })
    if (copiedPage.type !== 'page' || copiedPage.content.blocks[0].type !== 'choice-view') return
    expect(copiedPage.content.blocks[0].defaultViewport).toEqual({
      mode: 'focus',
      questionRef: {
        scope: 'relative',
        callPath: ['call-1'],
        questionId: 'question-1'
      }
    })
  })

  it('移动节点保留 ID，并拒绝把框架移动到自己的后代中', () => {
    const document = template([
      { id: 'first', type: 'frame', children: [page('nested')] },
      { id: 'second', type: 'frame', children: [] }
    ])
    const moved = editTemplateDocument(document, {
      type: 'move-node',
      nodeId: 'nested',
      parentId: 'second',
      index: 0
    })
    expect(moved.applied).toBe(true)
    if (!moved.applied) return
    expect(moved.document.content.root.children[1]).toMatchObject({
      children: [{ id: 'nested' }]
    })

    const rejected = editTemplateDocument(document, {
      type: 'move-node',
      nodeId: 'first',
      parentId: 'nested'
    })
    expect(rejected).toMatchObject({
      applied: false,
      error: { code: 'MOVE_INTO_DESCENDANT', path: 'parentId' }
    })
  })

  it('删除 ChoiceViewBlock 时清除时间线中对应的覆盖绑定', () => {
    const document = template([page()])
    const result = editTemplateDocument(document, {
      type: 'remove-content-block',
      pageId: 'page',
      blockId: 'choice-view'
    })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    const editedPage = result.document.content.root.children[0]
    expect(editedPage).toMatchObject({ content: { blocks: [] } })
    if (editedPage.type !== 'page') return
    expect(editedPage.timeline[0].choiceViewOverrides).toBeUndefined()
  })

  it('复制录音时间步骤时生成新的输出名', () => {
    const recordingPage: PageNode = {
      id: 'page',
      type: 'page',
      content: { blocks: [] },
      timeline: [{ type: 'record', duration: number(10), outputName: 'recording' }]
    }
    const result = editTemplateDocument(template([recordingPage]), {
      type: 'copy-timeline-step',
      pageId: 'page',
      index: 0
    })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.document.content.root.children[0]).toMatchObject({
      timeline: [{ outputName: 'recording' }, { outputName: 'recording-1' }]
    })
  })

  it('协调函数调用签名，移除过期绑定并补齐缺失项和不冲突的出参名', () => {
    const call: FunctionNode = {
      id: 'call',
      type: 'function',
      functionRef: 'function',
      inputs: {
        keep: { type: 'string', source: 'literal', value: 'kept' },
        typed: { type: 'string', source: 'literal', value: 'reset me' },
        stale: { type: 'number', source: 'literal', value: 1 }
      },
      outputNames: { keep: 'used', stale: 'old' }
    }
    const document = template([question('question', 'used'), call])
    const result = editTemplateDocument(document, {
      type: 'reconcile-function-call',
      nodeId: 'call',
      signature: {
        inputs: [
          { name: 'keep', type: 'string' },
          { name: 'typed', type: 'number' },
          { name: 'count', type: 'number' }
        ],
        outputs: [
          { name: 'keep', type: 'string' },
          { name: 'answer', type: 'choice' }
        ]
      }
    })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.document.content.root.children[1]).toMatchObject({
      inputs: {
        keep: { value: 'kept' },
        typed: { type: 'number', source: 'literal', value: 0 },
        count: { type: 'number', source: 'literal', value: 0 }
      },
      outputNames: {
        keep: 'keep-1',
        answer: 'answer-1'
      }
    })
  })

  it('重命名 Interface alias 时重写 Template 根和 Schema 绑定', () => {
    const document = createTemplateDocument({
      name: 'Template',
      description: '',
      interfaces: [{ alias: 'old', interfaceId: 'interface', acceptedVars: ['prompt'] }],
      root: root([
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
                text: {
                  type: 'string',
                  parts: [
                    {
                      type: 'variable',
                      ref: { scope: 'interface', alias: 'old', varName: 'prompt' }
                    }
                  ]
                }
              }
            ]
          },
          timeline: []
        }
      ]),
      schemaUses: [
        {
          useId: 'use',
          schemaId: 'schema',
          blockId: 'block',
          bindings: {
            prompt: {
              type: 'variable',
              scope: 'interface',
              alias: 'old',
              varName: 'prompt'
            }
          }
        }
      ]
    })
    const result = editTemplateDocument(document, {
      type: 'update-interface-requirement',
      alias: 'old',
      requirement: { alias: 'data', interfaceId: 'interface', acceptedVars: ['prompt'] }
    })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(JSON.stringify(result.document.content)).not.toContain('"alias":"old"')
    expect(JSON.stringify(result.document.content)).toContain('"alias":"data"')
  })

  it('删除最后一个函数调用节点时同步清理不可达函数资源闭包', async () => {
    const child = await createFunctionResource({
      name: 'Child',
      inputs: [],
      body: root(),
      outputs: [],
      schemaUses: []
    })
    const parent = await createFunctionResource({
      name: 'Parent',
      inputs: [],
      body: root([
        {
          id: 'nested',
          type: 'function',
          functionRef: child.id,
          inputs: {},
          outputNames: {}
        }
      ]),
      outputs: [],
      schemaUses: []
    })
    const document = createTemplateDocument(
      {
        name: 'Template',
        description: '',
        interfaces: [],
        root: root([
          { id: 'call', type: 'function', functionRef: parent.id, inputs: {}, outputNames: {} }
        ]),
        schemaUses: []
      },
      { functions: [child, parent] }
    )
    const result = editTemplateDocument(document, { type: 'remove-node', nodeId: 'call' })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.document.resources.functions).toEqual([])
    expect(result.changes).toContainEqual({ kind: 'cleanup', path: 'resources.functions' })
  })

  it('编辑 Collector、选择题选项、页面内容块和时间线列表', () => {
    let document = template([
      {
        id: 'section',
        type: 'frame',
        children: [question('question', 'answer'), page()]
      }
    ])
    document = applyTemplateEdit(document, {
      type: 'set-frame-choice-collector',
      frameId: 'section',
      pages: [{ questionCount: 1 }]
    })
    document = applyTemplateEdit(document, {
      type: 'insert-choice-option',
      nodeId: 'question',
      index: 1,
      option: { id: 'a', content: text('Copied A') }
    })
    document = applyTemplateEdit(document, {
      type: 'move-choice-option',
      nodeId: 'question',
      optionId: 'b',
      index: 0
    })
    document = applyTemplateEdit(document, {
      type: 'insert-content-block',
      pageId: 'page',
      block: {
        id: 'choice-view',
        type: 'text',
        x: 10,
        y: 20,
        text: text('Prompt')
      }
    })
    document = applyTemplateEdit(document, {
      type: 'insert-timeline-step',
      pageId: 'page',
      index: 0,
      step: { type: 'record', duration: number(3), outputName: 'answer' }
    })
    document = applyTemplateEdit(document, {
      type: 'move-timeline-step',
      pageId: 'page',
      index: 0,
      targetIndex: 1
    })

    const section = document.content.root.children[0]
    expect(section).toMatchObject({ choiceCollector: { pages: [{ questionCount: 1 }] } })
    if (section.type !== 'frame') return
    const editedQuestion = section.children[0]
    const editedPage = section.children[1]
    expect(editedQuestion).toMatchObject({
      options: [{ id: 'b' }, { id: 'a' }, { id: 'a-1' }]
    })
    expect(editedPage).toMatchObject({
      content: { blocks: [{ id: 'choice-view' }, { id: 'choice-view-1' }] },
      timeline: [{ type: 'countdown' }, { type: 'record', outputName: 'answer-1' }]
    })
  })

  it('编辑 Interface requirement、Schema use 和编辑器私有状态', () => {
    let document = template()
    document = applyTemplateEdit(document, {
      type: 'insert-interface-requirement',
      requirement: { alias: 'data', interfaceId: 'interface', acceptedVars: ['prompt'] }
    })
    document = applyTemplateEdit(document, {
      type: 'insert-schema-use',
      use: {
        useId: 'use',
        schemaId: 'schema',
        blockId: 'block',
        bindings: {}
      }
    })
    document = applyTemplateEdit(document, {
      type: 'set-schema-binding',
      useId: 'use',
      fieldName: 'prompt',
      expression: { type: 'literal', value: 'Hello' }
    })
    document = applyTemplateEdit(document, {
      type: 'set-editor-state',
      key: 'selection',
      value: { nodeId: 'root' }
    })

    expect(document.content.interfaces).toEqual([
      { alias: 'data', interfaceId: 'interface', acceptedVars: ['prompt'] }
    ])
    expect(document.content.schemaUses[0].bindings).toEqual({
      prompt: { type: 'literal', value: 'Hello' }
    })
    expect(document.editorState).toEqual({ selection: { nodeId: 'root' } })

    document = applyTemplateEdit(document, {
      type: 'remove-schema-use',
      useId: 'use'
    })
    document = applyTemplateEdit(document, {
      type: 'remove-interface-requirement',
      alias: 'data'
    })
    document = applyTemplateEdit(document, {
      type: 'set-editor-state',
      key: 'selection',
      value: undefined
    })
    expect(document.content.interfaces).toEqual([])
    expect(document.content.schemaUses).toEqual([])
    expect(document.editorState).toEqual({})
  })
})

describe('Function 文档编辑', () => {
  it('重命名函数输入时重写正文、函数出参和 Schema 内的局部引用', () => {
    const content: FunctionContent = {
      name: 'Function',
      inputs: [{ name: 'prompt', type: 'string' }],
      body: root([
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
      outputs: [
        {
          name: 'result',
          type: 'string',
          expression: {
            type: 'string',
            source: 'variable',
            ref: { scope: 'local', name: 'prompt' }
          }
        }
      ],
      schemaUses: [
        {
          useId: 'use',
          schemaId: 'schema',
          blockId: 'block',
          bindings: { prompt: { type: 'variable', scope: 'local', name: 'prompt' } }
        }
      ]
    }
    const document = createFunctionDocument(content)
    const result = editFunctionDocument(document, {
      type: 'update-function-input',
      name: 'prompt',
      input: { name: 'sentence', type: 'string' }
    })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.document.revision).toBe(0)
    expect(JSON.stringify(result.document.content)).not.toContain('"name":"prompt"')
    expect(JSON.stringify(result.document.content)).toContain('"name":"sentence"')
  })

  it('对列表冲突和不存在的目标返回可定位错误且保留原文档', () => {
    const document = createFunctionDocument({
      name: 'Function',
      inputs: [{ name: 'first', type: 'string' }],
      body: root(),
      outputs: [],
      schemaUses: []
    })
    const conflict = editFunctionDocument(document, {
      type: 'insert-function-input',
      input: { name: 'first', type: 'number' }
    })
    const missing = editFunctionDocument(document, {
      type: 'remove-node',
      nodeId: 'missing'
    })

    expect(conflict).toMatchObject({
      applied: false,
      document,
      error: { code: 'FUNCTION_INPUT_NAME_CONFLICT', path: 'content.inputs' }
    })
    expect(missing).toMatchObject({
      applied: false,
      document,
      error: { code: 'NODE_NOT_FOUND', path: 'nodeId' }
    })
  })

  it('编辑函数输入、手动出参和嵌套调用绑定', () => {
    let document = createFunctionDocument({
      name: 'Function',
      inputs: [],
      body: root([
        {
          id: 'call',
          type: 'function',
          functionRef: 'nested',
          inputs: {},
          outputNames: {}
        }
      ]),
      outputs: [],
      schemaUses: []
    })
    document = applyFunctionEdit(document, {
      type: 'insert-function-input',
      input: { name: 'prompt', type: 'string' }
    })
    document = applyFunctionEdit(document, {
      type: 'set-function-call-input',
      nodeId: 'call',
      inputName: 'value',
      expression: {
        type: 'string',
        source: 'variable',
        ref: { scope: 'local', name: 'prompt' }
      }
    })
    document = applyFunctionEdit(document, {
      type: 'set-function-call-output-name',
      nodeId: 'call',
      outputName: 'value',
      value: 'nested-value'
    })
    document = applyFunctionEdit(document, {
      type: 'insert-function-output',
      output: {
        name: 'result',
        type: 'string',
        expression: {
          type: 'string',
          source: 'variable',
          ref: { scope: 'local', name: 'nested-value' }
        }
      }
    })
    document = applyFunctionEdit(document, {
      type: 'update-function-output',
      name: 'result',
      output: {
        name: 'summary',
        type: 'string',
        expression: { type: 'string', parts: [{ type: 'literal', value: 'Done' }] }
      }
    })

    expect(document.content.inputs).toEqual([{ name: 'prompt', type: 'string' }])
    expect(document.content.body.children[0]).toMatchObject({
      inputs: { value: { ref: { name: 'prompt' } } },
      outputNames: { value: 'nested-value' }
    })
    expect(document.content.outputs).toEqual([
      {
        name: 'summary',
        type: 'string',
        expression: { type: 'string', parts: [{ type: 'literal', value: 'Done' }] }
      }
    ])

    document = applyFunctionEdit(document, {
      type: 'remove-function-output',
      name: 'summary'
    })
    document = applyFunctionEdit(document, {
      type: 'remove-function-input',
      name: 'prompt'
    })
    expect(document.content.inputs).toEqual([])
    expect(document.content.outputs).toEqual([])
  })
})
