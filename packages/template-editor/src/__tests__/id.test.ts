import { describe, expect, it } from 'vitest'
import {
  canonicalizeFunctionContent,
  createFunctionDocument,
  createFunctionResource,
  createTemplateDocument,
  deriveFunctionResourceId,
  isFunctionResourceId,
  verifyFunctionResourceId
} from '../id'
import type { FunctionContent } from '../types'
import { root, templateContent, text } from './fixtures'

function functionContent(overrides: Partial<FunctionContent> = {}): FunctionContent {
  return {
    name: 'Reusable page',
    inputs: [{ name: 'prompt', type: 'string' }],
    body: root(),
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
    schemaUses: [],
    ...overrides
  }
}

describe('Template 工作文档与函数资源身份', () => {
  it('为 Template 工作文档生成稳定 UUID 并保存编辑器状态', () => {
    const content = templateContent()
    const resource = { ...functionContent(), id: `sha256:${'1'.repeat(64)}` }
    const resources = { functions: [resource] }
    const editorState = { zoom: 1.25, collapsed: ['root'] }
    const document = createTemplateDocument(content, resources, editorState)

    expect(document.templateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(document.content).toEqual(content)
    expect(document.resources).toEqual(resources)
    expect(document.editorState).toEqual(editorState)

    content.name = 'Changed outside'
    resources.functions[0].name = 'Changed resource outside'
    editorState.collapsed.push('page')
    expect(document.content.name).not.toBe(content.name)
    expect(document.resources.functions[0].name).toBe('Reusable page')
    expect(document.editorState.collapsed).toEqual(['root'])
  })

  it('为函数库源文档生成稳定 UUID，源文档不使用内容 ID', () => {
    const source = createFunctionDocument(functionContent(), { selectedNodeId: 'root' })

    expect(source.functionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(source.functionId).not.toMatch(/^sha256:/)
    expect(source.editorState).toEqual({ selectedNodeId: 'root' })
  })

  it('为嵌入 Template 的函数快照生成标准 SHA-256 内容 ID', async () => {
    const resource = await createFunctionResource(functionContent())

    expect(isFunctionResourceId(resource.id)).toBe(true)
    expect(resource.id).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(await verifyFunctionResourceId(resource)).toBe(true)
  })

  it('相同函数内容产生相同资源 ID，结构顺序参与哈希', async () => {
    const first = await createFunctionResource(functionContent())
    const duplicate = await createFunctionResource(functionContent())
    const pageA = {
      id: 'page-a',
      type: 'page' as const,
      content: { blocks: [] },
      timeline: []
    }
    const pageB = { ...pageA, id: 'page-b' }
    const ordered = await deriveFunctionResourceId(functionContent({ body: root([pageA, pageB]) }))
    const reversed = await deriveFunctionResourceId(functionContent({ body: root([pageB, pageA]) }))

    expect(first.id).toBe(duplicate.id)
    expect(ordered).not.toBe(reversed)
  })

  it('对象 key 顺序不影响函数资源 ID', async () => {
    const call = (inputs: Record<string, ReturnType<typeof text>>) =>
      functionContent({
        body: root([
          {
            id: 'call',
            type: 'function',
            functionRef: `sha256:${'9'.repeat(64)}`,
            inputs,
            outputNames: { second: 'two', first: 'one' }
          }
        ])
      })
    const first = call({ first: text('First'), second: text('Second') })
    const second = call({ second: text('Second'), first: text('First') })

    expect(await deriveFunctionResourceId(first)).toBe(await deriveFunctionResourceId(second))
  })

  it('inputs、outputs 和 Schema uses 分别参与函数资源哈希', async () => {
    const base = functionContent()
    const baseId = await deriveFunctionResourceId(base)
    const changedInput = functionContent({ inputs: [{ name: 'other', type: 'string' }] })
    const changedOutput = functionContent({
      outputs: [
        {
          name: 'result',
          type: 'string',
          expression: { type: 'string', source: 'literal', value: 'changed' }
        }
      ]
    })
    const changedSchema = functionContent({
      schemaUses: [
        {
          useId: 'use',
          schemaId: `sha256:${'2'.repeat(64)}`,
          blockId: 'text',
          bindings: { prompt: { type: 'literal', value: 'Prompt' } }
        }
      ]
    })

    expect(await deriveFunctionResourceId(changedInput)).not.toBe(baseId)
    expect(await deriveFunctionResourceId(changedOutput)).not.toBe(baseId)
    expect(await deriveFunctionResourceId(changedSchema)).not.toBe(baseId)
  })

  it('嵌套函数资源引用参与父函数内容哈希', async () => {
    const call = (functionRef: string) =>
      functionContent({
        body: root([
          {
            id: 'nested-call',
            type: 'function',
            functionRef,
            inputs: {},
            outputNames: {}
          }
        ])
      })

    expect(await deriveFunctionResourceId(call(`sha256:${'1'.repeat(64)}`))).not.toBe(
      await deriveFunctionResourceId(call(`sha256:${'2'.repeat(64)}`))
    )
  })

  it('CRLF/LF 和等价 Unicode 规范化后资源 ID 相同', async () => {
    const first = functionContent({
      name: 'Cafe\u0301\r\nFunction',
      body: root([
        {
          id: 'question',
          type: 'choice-question',
          stem: text('Cafe\u0301\rquestion'),
          options: [
            { id: 'a', content: text('A') },
            { id: 'b', content: text('B') }
          ],
          outputName: 'answer-1'
        }
      ])
    })
    const second = functionContent({
      name: 'Caf\u00e9\nFunction',
      body: root([
        {
          id: 'question',
          type: 'choice-question',
          stem: text('Caf\u00e9\nquestion'),
          options: [
            { id: 'a', content: text('A') },
            { id: 'b', content: text('B') }
          ],
          outputName: 'answer-1'
        }
      ])
    })

    expect(await deriveFunctionResourceId(first)).toBe(await deriveFunctionResourceId(second))
  })

  it('函数资源正文被篡改后验证失败', async () => {
    const resource = await createFunctionResource(functionContent())

    expect(await verifyFunctionResourceId({ ...resource, name: 'Tampered' })).toBe(false)
  })

  it('创建函数文档和资源时深拷贝嵌套正文及编辑器状态', async () => {
    const content = functionContent()
    const editorState = { selection: { nodeIds: ['root'] } }
    const source = createFunctionDocument(content, editorState)
    const resource = await createFunctionResource(content)

    content.inputs[0].name = 'changed'
    content.outputs[0].name = 'changed'
    editorState.selection.nodeIds.push('page')

    expect(source.content.inputs[0].name).toBe('prompt')
    expect(source.content.outputs[0].name).toBe('result')
    expect(source.editorState).toEqual({ selection: { nodeIds: ['root'] } })
    expect(resource.inputs[0].name).toBe('prompt')
    expect(resource.outputs[0].name).toBe('result')
    expect(await verifyFunctionResourceId(resource)).toBe(true)
  })

  it('拒绝非法 SHA-256 资源 ID 格式', async () => {
    const resource = await createFunctionResource(functionContent())

    expect(isFunctionResourceId('sha256:ABC')).toBe(false)
    expect(isFunctionResourceId(`sha256:${'g'.repeat(64)}`)).toBe(false)
    expect(isFunctionResourceId(resource.id.toUpperCase())).toBe(false)
    expect(await verifyFunctionResourceId({ ...resource, id: 'invalid' })).toBe(false)
  })

  it('规范化只包含函数正文，不包含资源或编辑身份', () => {
    const content = functionContent()
    const decorated = {
      ...content,
      id: 'resource-id',
      functionId: 'source-id',
      editorState: { selectedNodeId: 'root' }
    }

    expect(canonicalizeFunctionContent(decorated)).toBe(canonicalizeFunctionContent(content))
  })
})
