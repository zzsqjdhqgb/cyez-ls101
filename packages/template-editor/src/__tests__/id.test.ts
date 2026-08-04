import { describe, expect, it } from 'vitest'
import {
  canonicalizeTemplateContent,
  compareTemplateIdentity,
  createTemplateDraft,
  deriveTemplateId,
  isTemplateId,
  publishTemplate,
  verifyTemplateId
} from '../id'
import { root, templateContent, text } from './fixtures'

describe('Template 内容身份', () => {
  it('生成标准 SHA-256 内容 ID', async () => {
    const id = await deriveTemplateId(templateContent())
    expect(isTemplateId(id)).toBe(true)
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('相同内容产生相同 ID', async () => {
    const first = await publishTemplate(templateContent())
    const second = await publishTemplate(templateContent())
    expect(first.id).toBe(second.id)
  })

  it('固定规范内容的 UTF-8 SHA-256 摘要', async () => {
    expect(await deriveTemplateId(templateContent())).toBe(
      'sha256:aaef29e9a375d7d370f05e2d4f26313657ab5cb988eb4b507e8d3b33a51b847a'
    )
  })

  it('节点顺序是规范内容的一部分', async () => {
    const pageA = {
      id: 'page-a',
      type: 'page' as const,
      content: { blocks: [] },
      timeline: []
    }
    const pageB = { ...pageA, id: 'page-b' }

    const first = await deriveTemplateId(templateContent({ root: root([pageA, pageB]) }))
    const second = await deriveTemplateId(templateContent({ root: root([pageB, pageA]) }))
    expect(first).not.toBe(second)
  })

  it('Interface、Schema 和函数身份都参与 ID', async () => {
    const base = templateContent()
    const baseId = await deriveTemplateId(base)
    const changedInterface = templateContent({
      interfaces: [{ ...base.interfaces[0], interfaceId: `sha256:${'3'.repeat(64)}` }]
    })
    const changedSchema = templateContent({
      schemaUses: [{ ...base.schemaUses[0], schemaId: `sha256:${'4'.repeat(64)}` }]
    })
    const changedFunction = templateContent({
      root: root([
        {
          id: 'function-call',
          type: 'function',
          functionRef: `sha256:${'5'.repeat(64)}`,
          inputs: {},
          outputNames: {}
        }
      ])
    })

    expect(await deriveTemplateId(changedInterface)).not.toBe(baseId)
    expect(await deriveTemplateId(changedSchema)).not.toBe(baseId)
    expect(await deriveTemplateId(changedFunction)).not.toBe(baseId)
  })

  it('CRLF/LF 和等价 Unicode 规范化后 ID 相同', async () => {
    const first = templateContent({
      name: 'Cafe\u0301',
      description: 'line 1\r\nline 2',
      root: root([
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
    const second = templateContent({
      name: 'Caf\u00e9',
      description: 'line 1\nline 2',
      root: root([
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

    expect(await deriveTemplateId(first)).toBe(await deriveTemplateId(second))
  })

  it('发布结果可复算验证，正文篡改后验证失败', async () => {
    const published = await publishTemplate(templateContent())
    expect(await verifyTemplateId(published)).toBe(true)
    expect(await verifyTemplateId({ ...published, name: '被篡改的模板' })).toBe(false)
  })

  it('区分重复、不同 ID 和同 ID 不同内容', async () => {
    const existing = await publishTemplate(templateContent())
    const duplicate = await publishTemplate(templateContent())
    const different = await publishTemplate(templateContent({ name: '另一份模板' }))
    const collision = { ...existing, description: '冲突内容' }

    expect(compareTemplateIdentity(existing, duplicate)).toBe('same')
    expect(compareTemplateIdentity(existing, different)).toBe('different-id')
    expect(compareTemplateIdentity(existing, collision)).toBe('collision')
  })

  it('草稿身份和状态不参与发布 ID', async () => {
    const draft = createTemplateDraft(templateContent())
    const published = await publishTemplate(draft)

    expect(draft.draftId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(draft.status).toBe('draft')
    expect(published.status).toBe('published')
    expect(published).not.toHaveProperty('draftId')
    expect(await verifyTemplateId(published)).toBe(true)
  })

  it('规范化输出忽略顶层草稿、发布身份和附加元数据', () => {
    const content = templateContent()
    const decorated = {
      ...content,
      draftId: 'draft-id',
      id: 'published-id',
      status: 'draft' as const,
      updatedAt: '2026-08-04T00:00:00Z'
    }

    expect(canonicalizeTemplateContent(decorated)).toBe(canonicalizeTemplateContent(content))
  })
})
