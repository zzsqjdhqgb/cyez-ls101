import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../renderer'

describe('renderer logger', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('forwards serialized errors through the preload bridge', () => {
    const write = vi.fn()
    vi.stubGlobal('window', { logger: { write } })

    logger.error('renderer failed', new TypeError('broken'), { feature: 'test' })

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: 'renderer failed',
        context: { feature: 'test' },
        error: expect.objectContaining({ name: 'TypeError', message: 'broken' })
      })
    )
  })
})
