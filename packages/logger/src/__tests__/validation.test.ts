import { describe, expect, it } from 'vitest'
import {
  MAX_RENDERER_LOG_EVENT_BYTES,
  MAX_RENDERER_LOG_MESSAGE_LENGTH,
  RendererLogGate,
  validateRendererLogEvent
} from '../main'

describe('renderer log validation', () => {
  it('copies valid fields and discards renderer timestamps', () => {
    const result = validateRendererLogEvent({
      level: 'error',
      message: 'failed',
      timestamp: 'spoofed',
      context: { route: '/test', attempts: [1, 2], optional: undefined },
      error: { name: 'Error', message: 'boom', stack: 'stack' },
      extra: 'ignored'
    })

    expect(result).toEqual({
      ok: true,
      event: {
        level: 'error',
        message: 'failed',
        context: { route: '/test', attempts: [1, 2] },
        error: { name: 'Error', message: 'boom', stack: 'stack' }
      }
    })
  })

  it('rejects oversized and deeply nested events', () => {
    expect(
      validateRendererLogEvent({
        level: 'error',
        message: 'x'.repeat(MAX_RENDERER_LOG_MESSAGE_LENGTH + 1)
      })
    ).toEqual({ ok: false, reason: 'malformed' })

    expect(
      validateRendererLogEvent({
        level: 'error',
        message: 'large',
        context: {
          first: 'x'.repeat(MAX_RENDERER_LOG_EVENT_BYTES / 2),
          second: 'x'.repeat(MAX_RENDERER_LOG_EVENT_BYTES / 2),
          third: 'x'.repeat(MAX_RENDERER_LOG_EVENT_BYTES / 2)
        }
      })
    ).toEqual({ ok: false, reason: 'too-large' })

    let context: Record<string, unknown> = {}
    for (let index = 0; index < 10; index += 1) context = { nested: context }
    expect(validateRendererLogEvent({ level: 'error', message: 'deep', context })).toEqual({
      ok: false,
      reason: 'too-deep'
    })
  })
})

describe('RendererLogGate', () => {
  it('rate limits each webContents and reports a rejection reason once per window', () => {
    const gate = new RendererLogGate(2, 1_000)
    const event = { level: 'error', message: 'failed' }

    expect(gate.accept(7, event, 0).accepted).toBe(true)
    expect(gate.accept(7, event, 1).accepted).toBe(true)
    expect(gate.accept(7, event, 2)).toEqual({
      accepted: false,
      reason: 'rate-limit',
      report: true
    })
    expect(gate.accept(7, event, 3)).toEqual({
      accepted: false,
      reason: 'rate-limit',
      report: false
    })
    expect(gate.accept(7, event, 1_001).accepted).toBe(true)
    expect(gate.accept(8, event, 3).accepted).toBe(true)
  })
})
