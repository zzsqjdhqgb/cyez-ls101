import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MINIMUM_STARTUP_PLACEHOLDER_DURATION_MS,
  waitForMinimumStartupPlaceholderDuration
} from '../startup-placeholder'

afterEach(() => {
  vi.useRealTimers()
})

describe('startup placeholder', () => {
  it('stays active for at least the temporary minimum duration', async () => {
    vi.useFakeTimers()
    const completed = vi.fn()

    void waitForMinimumStartupPlaceholderDuration().then(completed)
    await vi.advanceTimersByTimeAsync(MINIMUM_STARTUP_PLACEHOLDER_DURATION_MS - 1)
    expect(completed).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(completed).toHaveBeenCalledOnce()
  })
})
