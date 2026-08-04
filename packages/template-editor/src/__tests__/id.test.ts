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
    const document = createTemplateDocument(content, { functions: [] }, { zoom: 1.25 })

    expect(document.templateId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(document.content).toEqual(content)
    expect(document.resources).toEqual({ functions: [] })
    expect(document.editorState).toEqual({ zoom: 1.25 })

    content.name = 'Changed outside'
    expect(document.content.name).not.toBe(content.name)
  })

  it('为函数库源文档生成稳定 UUID，源文档不使用内容 ID', () => {
    const source = createFunctionDocument(functionContent(), { selectedNodeId: 'root' })

    expect(source.functionId).toMatch(/^[0-9a-f-]{36}$/i)
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
