import { StrictMode } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartupApplicationView } from '../StartupApplicationView'

const mocks = vi.hoisted(() => ({
  markStartupMilestone: vi.fn()
}))

vi.mock('../app/App', () => ({
  App: () => <main>Application</main>
}))

vi.mock('../startup-timing', () => ({
  markRendererStartupMilestone: mocks.markStartupMilestone
}))

describe('StartupApplicationView', () => {
  let nextFrameId: number
  let pendingFrames: Map<number, FrameRequestCallback>

  beforeEach(() => {
    nextFrameId = 1
    pendingFrames = new Map()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrameId++
      pendingFrames.set(id, callback)
      return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      pendingFrames.delete(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records the first-frame milestone only after a committed view crosses a paint', () => {
    const view = render(
      <StrictMode>
        <StartupApplicationView showReleaseNotes={false} />
      </StrictMode>
    )

    expect(mocks.markStartupMilestone).not.toHaveBeenCalled()
    flushAnimationFrame()
    expect(mocks.markStartupMilestone).not.toHaveBeenCalled()

    flushAnimationFrame()
    expect(mocks.markStartupMilestone).toHaveBeenCalledOnce()
    expect(mocks.markStartupMilestone).toHaveBeenCalledWith('main-interface-first-frame')

    view.unmount()
    expect(pendingFrames.size).toBe(0)
  })

  function flushAnimationFrame(): void {
    const callbacks = [...pendingFrames.values()]
    pendingFrames.clear()
    act(() => callbacks.forEach((callback) => callback(performance.now())))
  }
})
