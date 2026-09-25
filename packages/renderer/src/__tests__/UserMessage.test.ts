import { describe, expect, it, vi } from 'vitest'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@ls101/logger/renderer', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }
}))

const { DEFAULT_USER_MESSAGE, toUserMessage } = await import('../components/ui/userMessage')

describe('toUserMessage', () => {
  it('keeps a Chinese message as-is', () => {
    expect(toUserMessage(new Error('试卷包不存在或已经被删除。'))).toBe(
      '试卷包不存在或已经被删除。'
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('replaces an English message with the fallback and logs the original', () => {
    expect(toUserMessage(new Error('Invalid Interface ZIP manifest'))).toBe(DEFAULT_USER_MESSAGE)
    expect(warn).toHaveBeenCalledWith('Suppressed a non-Chinese user-facing error message', {
      message: 'Invalid Interface ZIP manifest'
    })
  })

  it.each([
    ['an empty message', new Error('')],
    ['a whitespace message', new Error('   ')],
    ['a non-error value', 42],
    ['null', null]
  ])('falls back for %s', (_reason, value) => {
    expect(toUserMessage(value)).toBe(DEFAULT_USER_MESSAGE)
  })

  it('accepts a Chinese string error and a custom fallback', () => {
    expect(toUserMessage('数据目录不可写')).toBe('数据目录不可写')
    expect(toUserMessage(new Error('boom'), '导入失败，请重试。')).toBe('导入失败，请重试。')
  })

  it('leaves messages that merely start with ASCII untouched when they contain Chinese', () => {
    expect(toUserMessage(new Error('LS101 数据目录无效'))).toBe('LS101 数据目录无效')
  })
})
