import { describe, expect, it, vi } from 'vitest'
import type { AIRouterClient } from '@ls101/airouter'
import { createConfiguredImageGenerator } from '../features/airouter/ConfiguredImageGenerator'
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

  it('routes a manual Provider through the global manual coordinator', async () => {
    const coordinator = new ManualImageGenerationCoordinator()
    const client = clientWith({
      listImageProviderConfigs: vi.fn().mockResolvedValue([
        {
          id: 'manual',
          name: '手动生成',
          type: 'manual',
          baseUrl: '',
          models: [],
          hasApiKey: false
        }
      ])
    })
    const generator = createConfiguredImageGenerator(client, coordinator)
    await expect(generator.listProviders?.()).resolves.toEqual([
      { providerId: 'manual', providerName: '手动生成' }
    ])
    const pending = generator.generate('prompt', {
      signal: new AbortController().signal,
      provider: { providerId: 'manual' }
    })

    await vi.waitFor(() => expect(coordinator.getSnapshot()?.prompt).toBe('prompt'))
    coordinator.complete(coordinator.getSnapshot()?.id ?? '', {
      data: new Uint8Array([1]),
      mediaType: 'image/png'
    })

    await expect(pending).resolves.toEqual({ data: new Uint8Array([1]), mediaType: 'image/png' })
    expect(client.generateImage).not.toHaveBeenCalled()
  })

  it('routes an API Provider through AIRouter image generation', async () => {
    const image = { data: new Uint8Array([2]), mediaType: 'image/png' }
    const client = clientWith({
      listImageProviderConfigs: vi.fn().mockResolvedValue([
        {
          id: 'api-provider',
          name: 'Image API',
          type: 'openai-compatible',
          baseUrl: 'https://images.example.com/v1',
          models: [{ id: 'image-model', enabled: true }],
          hasApiKey: true
        }
      ]),
      generateImage: vi.fn().mockResolvedValue(image)
    })

    const signal = new AbortController().signal
    await expect(
      createConfiguredImageGenerator(client).generate('prompt', {
        signal,
        provider: { providerId: 'api-provider', modelId: 'image-model' }
      })
    ).resolves.toEqual(image)
    expect(client.generateImage).toHaveBeenCalledWith(
      {
        providerConfigId: 'api-provider',
        modelId: 'image-model',
        prompt: 'prompt'
      },
      { signal }
    )
  })
})

function clientWith(overrides: Partial<AIRouterClient>): AIRouterClient {
  return {
    listProviderConfigs: vi.fn().mockResolvedValue([]),
    saveProviderConfig: vi.fn(),
    deleteProviderConfig: vi.fn(),
    readProviderApiKey: vi.fn(),
    listModels: vi.fn(),
    testConnection: vi.fn(),
    listImageProviderConfigs: vi.fn().mockResolvedValue([]),
    saveImageProviderConfig: vi.fn(),
    deleteImageProviderConfig: vi.fn(),
    readImageProviderApiKey: vi.fn(),
    listImageModels: vi.fn(),
    testImageConnection: vi.fn(),
    generateImage: vi.fn(),
    generateText: vi.fn(),
    ...overrides
  }
}
