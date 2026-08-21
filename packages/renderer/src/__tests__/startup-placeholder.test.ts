import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyStartupPlaceholderIcon,
  MINIMUM_STARTUP_PLACEHOLDER_DURATION_MS,
  waitForMinimumStartupPlaceholderDuration
} from '../startup-placeholder'

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('startup placeholder', () => {
  it('replaces the source HTML path with the Vite-resolved icon URL', () => {
    const root = document.createElement('div')
    root.innerHTML = '<img src="../../resources/icon.png" data-startup-icon>'

    applyStartupPlaceholderIcon(root, '/assets/icon-resolved.png')

    expect(root.querySelector('img')).toHaveAttribute('src', '/assets/icon-resolved.png')
  })

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
