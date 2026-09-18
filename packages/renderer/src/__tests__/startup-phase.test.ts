import { describe, expect, it, vi } from 'vitest'
import { runStartupPhase } from '../startup-phase'

describe('renderer startup phases', () => {
  it('yields before work and records the phase duration', async () => {
    const order: string[] = []
    const logger = {
      info: vi.fn((message: string) => order.push(message)),
      error: vi.fn()
    }
    const times = [10, 24.56]

    const result = await runStartupPhase(
      'builtin-schemas',
      () => {
        order.push('operation')
        return 'ready'
      },
      {
        logger,
        now: () => times.shift() ?? 0,
        yieldControl: async () => {
          order.push('yield')
        }
      }
    )

    expect(result).toBe('ready')
    expect(order).toEqual([
      'yield',
      'Renderer startup phase started',
      'operation',
      'Renderer startup phase completed'
    ])
    expect(logger.info).toHaveBeenLastCalledWith('Renderer startup phase completed', {
      phase: 'builtin-schemas',
      durationMs: 14.6
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs and rethrows initialization failures', async () => {
    const failure = new Error('invalid bundled content')
    const logger = { info: vi.fn(), error: vi.fn() }
    const times = [100, 105]

    await expect(
      runStartupPhase('builtin-interfaces', () => Promise.reject(failure), {
        logger,
        now: () => times.shift() ?? 0,
        yieldControl: async () => undefined
      })
    ).rejects.toBe(failure)
    expect(logger.error).toHaveBeenCalledWith('Renderer startup phase failed', failure, {
      phase: 'builtin-interfaces',
      durationMs: 5
    })
  })
})
