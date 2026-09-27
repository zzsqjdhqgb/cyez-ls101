import { logger } from '@ls101/logger/renderer'

/** 用户可见文本必须包含中日韩字符；否则视为内部/英文消息，不直接展示。 */
const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

export const DEFAULT_USER_MESSAGE = '操作失败，请重试。'

/**
 * 把任意错误转换成可以展示给用户的文案。
 *
 * 中文消息原样返回；空消息或纯英文/纯符号消息返回 `fallback`，并把原始消息写进日志，
 * 避免领域包或主进程的内部英文错误直接出现在界面上。
 */
export function toUserMessage(error: unknown, fallback: string = DEFAULT_USER_MESSAGE): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const trimmed = message.trim()
  if (trimmed === '') return fallback
  if (!CJK.test(trimmed)) {
    logger.warn('Suppressed a non-Chinese user-facing error message', { message: trimmed })
    return fallback
  }
  return trimmed
}

/**
 * 按错误码判断，不依赖消息文本。
 *
 * 领域包的仓储错误都带 `code`（如 `REVISION_CONFLICT`），用它可以避免"翻译文案后判定失效"。
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
