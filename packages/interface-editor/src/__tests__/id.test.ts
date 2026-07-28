import { describe, expect, it } from 'vitest'
import {
  canonicalizeInterfaceContent,
  compareInterfaceIdentity,
  createInterfaceDraft,
  deriveInterfaceId,
  isInterfaceId,
  publishInterface,
  verifyInterfaceId
} from '../id'
import type { InterfaceContent } from '../types'

function content(overrides: Partial<InterfaceContent> = {}): InterfaceContent {
  return {
    name: '上海高考口语',
    description: '口语模拟考试',
    promptTemplate: '生成一套试题',
    fields: {
      title: {
        type: 'text',
        varName: 'title',
        description: '试卷标题',
        example: '英语口语模拟卷'
      }
    },
    ...overrides
  }
}

describe('Interface 内容 ID', () => {
  it('生成标准 SHA-256 内容 ID', async () => {
    const id = await deriveInterfaceId(content())
    expect(isInterfaceId(id)).toBe(true)
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('相同内置内容在不同对象中产生相同 ID', async () => {
    const first = await publishInterface(content())
    const second = await publishInterface(content())
    expect(first.id).toBe(second.id)
  })

  it('内容变化产生不同 ID', async () => {
    const first = await deriveInterfaceId(content())
    const second = await deriveInterfaceId(content({ promptTemplate: '生成另一套试题' }))
    expect(first).not.toBe(second)
  })

  it('字段顺序变化视为内容变化', async () => {
    const a = {
      type: 'text' as const,
      varName: 'a',
      description: 'A',
      example: 'A'
    }
    const b = { ...a, varName: 'b', description: 'B', example: 'B' }
    const first = await deriveInterfaceId(content({ fields: { a, b } }))
    const second = await deriveInterfaceId(content({ fields: { b, a } }))
    expect(first).not.toBe(second)
  })

  it('CRLF/LF 和等价 Unicode 规范化后 ID 相同', async () => {
    const first = await deriveInterfaceId(content({
      name: 'Caf\u00e9',
      promptTemplate: 'line 1\r\nline 2'
    }))
    const second = await deriveInterfaceId(content({
      name: 'Cafe\u0301',
      promptTemplate: 'line 1\nline 2'
    }))
    expect(first).toBe(second)
  })

  it('发布结果可复算验证，内容篡改后验证失败', async () => {
    const published = await publishInterface(content())
    expect(await verifyInterfaceId(published)).toBe(true)
    expect(await verifyInterfaceId({ ...published, name: '被篡改的名称' })).toBe(false)
  })

  it('区分重复、不同 ID 和同 ID 不同内容', async () => {
    const existing = await publishInterface(content())
    const duplicate = await publishInterface(content())
    const different = await publishInterface(content({ name: '另一个 Interface' }))
    const collision = { ...existing, name: '冲突内容' }

    expect(compareInterfaceIdentity(existing, duplicate)).toBe('same')
    expect(compareInterfaceIdentity(existing, different)).toBe('different-id')
    expect(compareInterfaceIdentity(existing, collision)).toBe('collision')
  })

  it('草稿 ID 独立于发布内容 ID', async () => {
    const draft = createInterfaceDraft(content())
    const published = await publishInterface(draft)
    expect(draft.draftId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(published).not.toHaveProperty('draftId')
    expect(await verifyInterfaceId(published)).toBe(true)
  })

  it('规范化输出不包含传入对象上的额外 ID 字段', () => {
    const value = { id: 'ignored', ...content() }
    expect(canonicalizeInterfaceContent(value)).not.toContain('ignored')
  })
})
