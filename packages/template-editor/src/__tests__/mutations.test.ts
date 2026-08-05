import { describe, expect, it } from 'vitest'
import { parseFunctionDocument, parseTemplateDocument } from '../document-parser'
import { createFunctionDocument, createFunctionResource, createTemplateDocument } from '../id'
import { editFunctionDocument, editTemplateDocument } from '../mutations'
import type { FunctionDocumentOperation, TemplateDocumentOperation } from '../mutations'
import { FileTemplateRepository, type TemplateStore } from '../repository'
import { validateTemplateDocument } from '../validation'
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
  expect(parseTemplateDocument(result.document)).toBe(result.document)
  return result.document
}

function applyFunctionEdit(
  document: ReturnType<typeof createFunctionDocument>,
  operation: FunctionDocumentOperation
): ReturnType<typeof createFunctionDocument> {
  const result = editFunctionDocument(document, operation)
  expect(result.applied).toBe(true)
  if (!result.applied) throw new Error(`${result.error.code}: ${result.error.path}`)
  expect(parseFunctionDocument(result.document)).toBe(result.document)
  return result.document
}

function expectTemplateEditError(
  document: TemplateDocument,
  operation: TemplateDocumentOperation,
  code: Parameters<typeof expectEditError>[2],
  path: string,
  params: Readonly<Record<string, string | number>>
): void {
  expectEditError(
    editTemplateDocument(document, operation),
    operation,
    code,
    path,
    params,
    document
  )
}

function expectFunctionEditError(
  document: ReturnType<typeof createFunctionDocument>,
  operation: FunctionDocumentOperation,
  code: Parameters<typeof expectEditError>[2],
  path: string,
  params: Readonly<Record<string, string | number>>
): void {
  expectEditError(
    editFunctionDocument(document, operation),
    operation,
    code,
    path,
    params,
    document
  )
}

function expectEditError(
  result: ReturnType<typeof editTemplateDocument> | ReturnType<typeof editFunctionDocument>,
  operation: TemplateDocumentOperation | FunctionDocumentOperation,
  code: import('../mutations').DocumentEditErrorCode,
  path: string,
  params: Readonly<Record<string, string | number>>,
  document: TemplateDocument | ReturnType<typeof createFunctionDocument>
): void {
  expect(result).toEqual({
    applied: false,
    document,
    operation,
    error: { code, path, params }
  })
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
              },
              {
                id: 'absolute-focus',
                type: 'choice-view' as const,
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                defaultViewport: {
                  mode: 'focus' as const,
                  questionRef: {
                    scope: 'absolute' as const,
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
    const absoluteFocus = copiedPage.content.blocks[1]
    expect(absoluteFocus).toMatchObject({
      defaultViewport: {
        mode: 'focus',
        questionRef: {
          scope: 'absolute',
          callPath: ['call'],
          questionId: 'question'
        }
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
    expect(Object.hasOwn(editedPage.timeline[0], 'choiceViewOverrides')).toBe(false)
  })

  it('清除可选配置后仍能通过 parser 和仓储往返', async () => {
    let collectorDocument = template([
      {
        id: 'section',
        type: 'frame',
        children: [],
        choiceCollector: { pages: [{ questionCount: 1 }] }
      }
    ])
    collectorDocument = applyTemplateEdit(collectorDocument, {
      type: 'set-frame-choice-collector',
      frameId: 'section',
      pages: null
    })
    const section = collectorDocument.content.root.children[0]
    expect(Object.hasOwn(section, 'choiceCollector')).toBe(false)

    let overrideDocument = template([page()])
    overrideDocument = applyTemplateEdit(overrideDocument, {
      type: 'remove-content-block',
      pageId: 'page',
      blockId: 'choice-view'
    })

    for (const document of [collectorDocument, overrideDocument]) {
      const repository = new FileTemplateRepository(new MemoryStore())
      const saved = await repository.saveTemplate(document)
      expect(await repository.getTemplate(document.templateId)).toEqual(saved)
    }
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

  it('Interface alias 重命名不改写内容寻址函数资源，函数直接引用会被明确拒绝', async () => {
    const interfaceId = `sha256:${'1'.repeat(64)}`
    const schemaId = `sha256:${'2'.repeat(64)}`
    const resource = await createFunctionResource({
      name: 'Invalid direct Interface use',
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
      outputs: [],
      schemaUses: []
    })
    const document = createTemplateDocument(
      {
        name: 'Template',
        description: '',
        interfaces: [{ alias: 'old', interfaceId, acceptedVars: ['prompt'] }],
        root: root([
          {
            id: 'call',
            type: 'function',
            functionRef: resource.id,
            inputs: {},
            outputNames: {}
          }
        ]),
        schemaUses: [
          {
            useId: 'text',
            schemaId,
            blockId: 'text',
            bindings: { prompt: { type: 'literal', value: 'Prompt' } }
          }
        ]
      },
      { functions: [resource] }
    )
    const result = editTemplateDocument(document, {
      type: 'update-interface-requirement',
      alias: 'old',
      requirement: { alias: 'data', interfaceId, acceptedVars: ['prompt'] }
    })

    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.document.resources).toBe(document.resources)
    expect(
      await validateTemplateDocument(result.document, {
        interfaceManifests: [
          {
            interfaceId,
            interfaceName: 'Data',
            vars: [
              {
                varName: 'prompt',
                type: 'text',
                description: 'Prompt',
                example: 'Hello',
                path: 'prompt'
              }
            ]
          }
        ],
        schemaManifests: [
          {
            schemaId,
            schemaName: 'Schema',
            blocks: [
              {
                blockId: 'text',
                blockName: 'Text',
                fields: [{ varName: 'prompt', type: 'text' }]
              }
            ]
          }
        ]
      })
    ).toMatchObject({
      valid: false,
      errors: [
        {
          code: 'INTERFACE_VARIABLE_IN_FUNCTION',
          params: { alias: 'old', varName: 'prompt' }
        }
      ]
    })
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

  it('覆盖剩余公开成功操作并保证每一步都可解析', () => {
    let document = createTemplateDocument({
      name: 'Template',
      description: '',
      interfaces: [{ alias: 'data', interfaceId: 'interface', acceptedVars: ['prompt'] }],
      root: root([
        page(),
        question('question', 'answer'),
        {
          id: 'call',
          type: 'function',
          functionRef: 'function',
          inputs: { stale: { type: 'string', source: 'literal', value: 'remove' } },
          outputNames: { stale: 'stale-output' }
        }
      ]),
      schemaUses: [
        {
          useId: 'use',
          schemaId: 'schema',
          blockId: 'block',
          bindings: { prompt: { type: 'literal', value: 'Before' } }
        }
      ]
    })
    document = applyTemplateEdit(document, { type: 'set-template-name', value: 'Renamed' })
    document = applyTemplateEdit(document, {
      type: 'set-template-description',
      value: 'Description'
    })
    document = applyTemplateEdit(document, {
      type: 'update-interface-requirement',
      alias: 'data',
      requirement: { alias: 'data', interfaceId: 'interface', acceptedVars: ['prompt', 'image'] }
    })
    document = applyTemplateEdit(document, {
      type: 'insert-function-call',
      parentId: 'root',
      functionRef: 'new-function',
      signature: {
        inputs: [{ name: 'count', type: 'number' }],
        outputs: [{ name: 'result', type: 'string' }]
      }
    })
    document = applyTemplateEdit(document, {
      type: 'update-content-block',
      pageId: 'page',
      blockId: 'choice-view',
      block: {
        id: 'renamed-view',
        type: 'choice-view',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        defaultViewport: { mode: 'free' }
      }
    })
    document = applyTemplateEdit(document, {
      type: 'copy-content-block',
      pageId: 'page',
      blockId: 'renamed-view'
    })
    const pageAfterCopy = document.content.root.children[0]
    if (pageAfterCopy.type !== 'page') throw new Error('Expected page')
    expect(pageAfterCopy.timeline[0].choiceViewOverrides).toEqual({
      'renamed-view': {
        mode: 'focus',
        questionRef: { scope: 'relative', callPath: [], questionId: 'question' }
      }
    })
    document = applyTemplateEdit(document, {
      type: 'move-content-block',
      pageId: 'page',
      blockId: 'renamed-view-1',
      index: 0
    })
    document = applyTemplateEdit(document, {
      type: 'update-content-block',
      pageId: 'page',
      blockId: 'renamed-view-1',
      block: { id: 'copied-text', type: 'text', x: 5, y: 5, text: text('Copy') }
    })
    document = applyTemplateEdit(document, {
      type: 'update-timeline-step',
      pageId: 'page',
      index: 0,
      step: { type: 'countdown', seconds: number(2) }
    })
    document = applyTemplateEdit(document, {
      type: 'copy-timeline-step',
      pageId: 'page',
      index: 0
    })
    document = applyTemplateEdit(document, {
      type: 'remove-timeline-step',
      pageId: 'page',
      index: 1
    })
    document = applyTemplateEdit(document, {
      type: 'set-choice-question',
      nodeId: 'question',
      stem: text('Updated question'),
      outputName: 'updated-answer'
    })
    document = applyTemplateEdit(document, {
      type: 'update-choice-option',
      nodeId: 'question',
      optionId: 'a',
      option: { id: 'first', content: text('First') }
    })
    document = applyTemplateEdit(document, {
      type: 'copy-choice-option',
      nodeId: 'question',
      optionId: 'first'
    })
    document = applyTemplateEdit(document, {
      type: 'remove-choice-option',
      nodeId: 'question',
      optionId: 'first-1'
    })
    document = applyTemplateEdit(document, {
      type: 'set-function-call-input',
      nodeId: 'call',
      inputName: 'stale',
      expression: null
    })
    document = applyTemplateEdit(document, {
      type: 'set-function-call-output-name',
      nodeId: 'call',
      outputName: 'stale',
      value: null
    })
    document = applyTemplateEdit(document, {
      type: 'update-schema-use',
      useId: 'use',
      use: {
        useId: 'renamed-use',
        schemaId: 'schema',
        blockId: 'block',
        bindings: { prompt: { type: 'literal', value: 'After' } }
      }
    })
    document = applyTemplateEdit(document, {
      type: 'set-schema-binding',
      useId: 'renamed-use',
      fieldName: 'prompt',
      expression: null
    })

    const editedPage = document.content.root.children[0]
    expect(document.content).toMatchObject({ name: 'Renamed', description: 'Description' })
    expect(editedPage).toMatchObject({
      content: {
        blocks: [{ id: 'copied-text' }, { id: 'renamed-view' }]
      },
      timeline: [{ type: 'countdown', seconds: { value: 2 } }]
    })
    if (editedPage.type !== 'page') return
    expect(editedPage.timeline[0].choiceViewOverrides).toBeUndefined()
    expect(document.content.root.children[2]).toMatchObject({ inputs: {}, outputNames: {} })
    expect(document.content.root.children[3]).toMatchObject({
      id: 'function-call',
      inputs: { count: { type: 'number', value: 0 } },
      outputNames: { result: 'result-1' }
    })
    expect(document.content.schemaUses[0]).toMatchObject({
      useId: 'renamed-use',
      bindings: {}
    })
  })

  it('为每个 Template 编辑错误码返回完整且稳定的错误契约', () => {
    const basic = template([
      page(),
      question('question', 'answer'),
      {
        id: 'section',
        type: 'frame',
        children: [{ id: 'nested', type: 'frame', children: [] }]
      }
    ])
    expectTemplateEditError(
      basic,
      { type: 'remove-node', nodeId: 'missing' },
      'NODE_NOT_FOUND',
      'nodeId',
      { nodeId: 'missing' }
    )
    expectTemplateEditError(
      basic,
      { type: 'insert-node', parentId: 'missing', node: question('new', 'new-answer') },
      'PARENT_NOT_FOUND',
      'parentId',
      { parentId: 'missing' }
    )
    expectTemplateEditError(
      basic,
      { type: 'insert-node', parentId: 'page', node: question('new', 'new-answer') },
      'PARENT_NOT_FRAME',
      'root.children[0]',
      { parentId: 'page' }
    )
    expectTemplateEditError(
      basic,
      { type: 'remove-node', nodeId: 'root' },
      'ROOT_NODE_IMMUTABLE',
      'root',
      { nodeId: 'root' }
    )
    expectTemplateEditError(
      basic,
      { type: 'move-node', nodeId: 'section', parentId: 'nested' },
      'MOVE_INTO_DESCENDANT',
      'parentId',
      { nodeId: 'section', parentId: 'nested' }
    )
    expectTemplateEditError(
      basic,
      {
        type: 'insert-node',
        parentId: 'root',
        index: 99,
        node: question('new', 'new-answer')
      },
      'INVALID_INDEX',
      'root.children',
      { index: 99 }
    )
    expectTemplateEditError(
      basic,
      { type: 'set-frame-choice-collector', frameId: 'page', pages: [] },
      'WRONG_NODE_TYPE',
      'root.children[0]',
      { expected: 'frame', actual: 'page' }
    )
    expectTemplateEditError(
      basic,
      { type: 'remove-content-block', pageId: 'page', blockId: 'missing' },
      'CONTENT_BLOCK_NOT_FOUND',
      'root.children[0].content.blocks',
      { blockId: 'missing' }
    )
    const blockConflict = template([
      {
        ...page(),
        content: {
          blocks: [
            { id: 'first', type: 'text', x: 0, y: 0, text: text('First') },
            { id: 'second', type: 'text', x: 0, y: 0, text: text('Second') }
          ]
        }
      }
    ])
    expectTemplateEditError(
      blockConflict,
      {
        type: 'update-content-block',
        pageId: 'page',
        blockId: 'first',
        block: { id: 'second', type: 'text', x: 0, y: 0, text: text('Conflict') }
      },
      'CONTENT_BLOCK_ID_CONFLICT',
      'root.children[0].content.blocks',
      { blockId: 'second' }
    )
    expectTemplateEditError(
      basic,
      { type: 'remove-timeline-step', pageId: 'page', index: 99 },
      'TIMELINE_STEP_NOT_FOUND',
      'root.children[0].timeline',
      { index: 99 }
    )
    expectTemplateEditError(
      basic,
      { type: 'remove-choice-option', nodeId: 'question', optionId: 'missing' },
      'CHOICE_OPTION_NOT_FOUND',
      'root.children[1].options',
      { optionId: 'missing' }
    )
    expectTemplateEditError(
      basic,
      {
        type: 'update-choice-option',
        nodeId: 'question',
        optionId: 'a',
        option: { id: 'b', content: text('Conflict') }
      },
      'CHOICE_OPTION_ID_CONFLICT',
      'root.children[1].options',
      { optionId: 'b' }
    )
    expectTemplateEditError(
      basic,
      { type: 'remove-schema-use', useId: 'missing' },
      'SCHEMA_USE_NOT_FOUND',
      'schemaUses',
      { useId: 'missing' }
    )
    const schemaConflict = createTemplateDocument({
      ...basic.content,
      schemaUses: [{ useId: 'use', schemaId: 'schema', blockId: 'block', bindings: {} }]
    })
    expectTemplateEditError(
      schemaConflict,
      {
        type: 'insert-schema-use',
        use: { useId: 'use', schemaId: 'other', blockId: 'other', bindings: {} }
      },
      'SCHEMA_USE_ID_CONFLICT',
      'schemaUses',
      { useId: 'use' }
    )
    expectTemplateEditError(
      basic,
      { type: 'remove-interface-requirement', alias: 'missing' },
      'INTERFACE_REQUIREMENT_NOT_FOUND',
      'content.interfaces',
      { alias: 'missing' }
    )
    const interfaceConflict = createTemplateDocument({
      ...basic.content,
      interfaces: [{ alias: 'data', interfaceId: 'interface', acceptedVars: ['prompt'] }]
    })
    expectTemplateEditError(
      interfaceConflict,
      {
        type: 'insert-interface-requirement',
        requirement: { alias: 'data', interfaceId: 'other', acceptedVars: ['value'] }
      },
      'INTERFACE_ALIAS_CONFLICT',
      'content.interfaces',
      { alias: 'data' }
    )
  })
})

class MemoryStore implements TemplateStore {
  constructor(
    private readonly state = new Map<string, unknown>(),
    private readonly path: string[] = []
  ) {}

  scope(name: string): TemplateStore {
    return new MemoryStore(this.state, [...this.path, name])
  }

  async readText<T>(filename: string): Promise<T | null> {
    return (this.state.get(this.key(filename)) as T | undefined) ?? null
  }

  async writeText<T>(filename: string, data: T): Promise<void> {
    this.state.set(this.key(filename), structuredClone(data))
  }

  async compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean> {
    const key = this.key(filename)
    const current = this.state.has(key) ? this.state.get(key) : null
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false
    this.state.set(key, structuredClone(data))
    return true
  }

  async listScopes(): Promise<string[]> {
    return []
  }

  async clear(): Promise<void> {
    const prefix = `${this.path.join('/')}/`
    for (const key of this.state.keys()) {
      if (key.startsWith(prefix)) this.state.delete(key)
    }
  }

  private key(filename: string): string {
    return [...this.path, filename].join('/')
  }
}

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

  it('覆盖函数名称及输入输出更新操作并保证每一步可解析', () => {
    let document = createFunctionDocument({
      name: 'Function',
      inputs: [{ name: 'prompt', type: 'string' }],
      body: root(),
      outputs: [
        {
          name: 'result',
          type: 'string',
          expression: { type: 'string', parts: [{ type: 'literal', value: 'Before' }] }
        }
      ],
      schemaUses: []
    })
    document = applyFunctionEdit(document, { type: 'set-function-name', value: 'Renamed' })
    document = applyFunctionEdit(document, {
      type: 'update-function-input',
      name: 'prompt',
      input: { name: 'count', type: 'number' }
    })
    document = applyFunctionEdit(document, {
      type: 'update-function-output',
      name: 'result',
      output: {
        name: 'result',
        type: 'number',
        expression: {
          type: 'number',
          source: 'variable',
          ref: { scope: 'local', name: 'count' }
        }
      }
    })

    expect(document.content).toMatchObject({
      name: 'Renamed',
      inputs: [{ name: 'count', type: 'number' }],
      outputs: [{ name: 'result', type: 'number', expression: { ref: { name: 'count' } } }]
    })
  })

  it('为 Function 专属编辑错误码返回完整且稳定的错误契约', () => {
    const document = createFunctionDocument({
      name: 'Function',
      inputs: [{ name: 'first', type: 'string' }],
      body: root(),
      outputs: [
        {
          name: 'result',
          type: 'string',
          expression: { type: 'string', parts: [{ type: 'literal', value: 'Result' }] }
        }
      ],
      schemaUses: []
    })
    expectFunctionEditError(
      document,
      { type: 'remove-function-input', name: 'missing' },
      'FUNCTION_INPUT_NOT_FOUND',
      'content.inputs',
      { name: 'missing' }
    )
    expectFunctionEditError(
      document,
      { type: 'insert-function-input', input: { name: 'first', type: 'number' } },
      'FUNCTION_INPUT_NAME_CONFLICT',
      'content.inputs',
      { name: 'first' }
    )
    expectFunctionEditError(
      document,
      { type: 'remove-function-output', name: 'missing' },
      'FUNCTION_OUTPUT_NOT_FOUND',
      'content.outputs',
      { name: 'missing' }
    )
    expectFunctionEditError(
      document,
      {
        type: 'insert-function-output',
        output: {
          name: 'result',
          type: 'string',
          expression: { type: 'string', parts: [] }
        }
      },
      'FUNCTION_OUTPUT_NAME_CONFLICT',
      'content.outputs',
      { name: 'result' }
    )
  })
})
