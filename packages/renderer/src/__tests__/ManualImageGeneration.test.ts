import { describe, expect, it, vi } from 'vitest'
import { ManualImageGenerationCoordinator } from '../features/airouter/ManualImageGeneration'

describe('ManualImageGenerationCoordinator', () => {
  it('queues requests and resolves them in order', async () => {
    const coordinator = new ManualImageGenerationCoordinator()
    const listener = vi.fn()
    coordinator.subscribe(listener)
    const first = coordinator.generate('first prompt')
    const second = coordinator.generate('second prompt')

    const firstRequest = coordinator.getSnapshot()
    expect(firstRequest?.prompt).toBe('first prompt')
    coordinator.complete(firstRequest?.id ?? '', {
      data: new Uint8Array([1]),
      mediaType: 'image/png'
    })
    await expect(first).resolves.toEqual({ data: new Uint8Array([1]), mediaType: 'image/png' })

    const secondRequest = coordinator.getSnapshot()
    expect(secondRequest?.prompt).toBe('second prompt')
    coordinator.complete(secondRequest?.id ?? '', {
      data: new Uint8Array([2]),
      mediaType: 'image/jpeg'
    })
    await expect(second).resolves.toEqual({ data: new Uint8Array([2]), mediaType: 'image/jpeg' })
    expect(listener).toHaveBeenCalled()
  })

  it('rejects the active request when its signal is aborted', async () => {
    const coordinator = new ManualImageGenerationCoordinator()
    const controller = new AbortController()
    const pending = coordinator.generate('prompt', { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(coordinator.getSnapshot()).toBeNull()
  })
})
