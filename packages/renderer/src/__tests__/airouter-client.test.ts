import { describe, expect, it, vi } from 'vitest'
import { createAIRouterClient } from '@ls101/airouter/renderer'
import type { AIRouterBridge } from '@ls101/airouter/shared'

describe('AIRouter renderer client', () => {
  it('adapts IPC stream events into text chunks', async () => {
    let cancel = vi.fn()
    const bridge = bridgeWith({
      listProviderConfigs: vi.fn(),
      saveProviderConfig: vi.fn(),
      deleteProviderConfig: vi.fn(),
      readProviderApiKey: vi.fn(),
      listModels: vi.fn(),
      testConnection: vi.fn(),
      startTextGeneration: vi.fn((_request, listener) => {
        queueMicrotask(() => listener({ type: 'chunk', chunk: { type: 'output', delta: 'A' } }))
        queueMicrotask(() => listener({ type: 'chunk', chunk: { type: 'reasoning', delta: 'B' } }))
        queueMicrotask(() => listener({ type: 'done' }))
        return cancel
      })
    })
    const chunks = []
    for await (const chunk of createAIRouterClient(bridge).generateText({
      providerConfigId: 'config',
      modelId: 'model',
      prompt: 'prompt'
    })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual([
      { type: 'output', delta: 'A' },
      { type: 'reasoning', delta: 'B' }
    ])
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('ends a pending stream when the caller aborts', async () => {
    const cancel = vi.fn()
    const bridge = bridgeWith({
      listProviderConfigs: vi.fn(),
      saveProviderConfig: vi.fn(),
      deleteProviderConfig: vi.fn(),
      readProviderApiKey: vi.fn(),
      listModels: vi.fn(),
      testConnection: vi.fn(),
      startTextGeneration: vi.fn(() => cancel)
    })
    const controller = new AbortController()
    const stream = createAIRouterClient(bridge).generateText(
      { providerConfigId: 'config', modelId: 'model', prompt: 'prompt' },
      { signal: controller.signal }
    )
    const iterator = stream[Symbol.asyncIterator]()
    const next = iterator.next()
    controller.abort()

    await expect(next).resolves.toEqual({ value: undefined, done: true })
    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('returns image bytes from a one-shot IPC generation', async () => {
    const cancel = vi.fn()
    const bridge = bridgeWith({
      startImageGeneration: vi.fn((_request, listener) => {
        queueMicrotask(() =>
          listener({
            type: 'result',
            image: { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }
          })
        )
        return cancel
      })
    })

    await expect(
      createAIRouterClient(bridge).generateImage({
        providerConfigId: 'images',
        modelId: 'image-model',
        prompt: 'prompt'
      })
    ).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects a pending image generation with AbortError', async () => {
    const cancel = vi.fn()
    const bridge = bridgeWith({ startImageGeneration: vi.fn(() => cancel) })
    const controller = new AbortController()
    const pending = createAIRouterClient(bridge).generateImage(
      { providerConfigId: 'images', modelId: 'image-model', prompt: 'prompt' },
      { signal: controller.signal }
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('returns speech audio from a one-shot IPC generation', async () => {
    const cancel = vi.fn()
    const bridge = bridgeWith({
      startSpeechSynthesis: vi.fn((_request, listener) => {
        queueMicrotask(() =>
          listener({
            type: 'result',
            audio: {
              data: new Uint8Array([4, 5, 6]),
              mediaType: 'audio/wav',
              format: 'wav',
              sampleRate: 24_000,
              channels: 1,
              durationMs: 12.5
            }
          })
        )
        return cancel
      })
    })

    await expect(
      createAIRouterClient(bridge).synthesizeSpeech({
        text: 'hello',
        routing: {
          default: { providerConfigId: 'speech', modelId: 'model', voiceId: 'voice' }
        }
      })
    ).resolves.toEqual({
      data: new Uint8Array([4, 5, 6]),
      mediaType: 'audio/wav',
      format: 'wav',
      sampleRate: 24_000,
      channels: 1,
      durationMs: 12.5
    })
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects speech IPC errors and stops the listener', async () => {
    const cancel = vi.fn()
    const bridge = bridgeWith({
      startSpeechSynthesis: vi.fn((_request, listener) => {
        queueMicrotask(() => listener({ type: 'error', message: 'speech failed' }))
        return cancel
      })
    })

    await expect(
      createAIRouterClient(bridge).synthesizeSpeech({
        text: 'hello',
        routing: {
          default: { providerConfigId: 'speech', modelId: 'model', voiceId: 'voice' }
        }
      })
    ).rejects.toThrow('speech failed')
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects speech synthesis with AbortError when the caller aborts', async () => {
    const cancel = vi.fn()
    const bridge = bridgeWith({ startSpeechSynthesis: vi.fn(() => cancel) })
    const controller = new AbortController()
    const pending = createAIRouterClient(bridge).synthesizeSpeech(
      {
        text: 'hello',
        routing: {
          default: { providerConfigId: 'speech', modelId: 'model', voiceId: 'voice' }
        }
      },
      { signal: controller.signal }
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalled()
  })
})

function bridgeWith(overrides: Partial<AIRouterBridge>): AIRouterBridge {
  return {
    listProviderConfigs: vi.fn(),
    saveProviderConfig: vi.fn(),
    deleteProviderConfig: vi.fn(),
    readProviderApiKey: vi.fn(),
    listModels: vi.fn(),
    testConnection: vi.fn(),
    listImageProviderConfigs: vi.fn(),
    saveImageProviderConfig: vi.fn(),
    deleteImageProviderConfig: vi.fn(),
    readImageProviderApiKey: vi.fn(),
    listImageModels: vi.fn(),
    testImageConnection: vi.fn(),
    startTextGeneration: vi.fn(),
    startImageGeneration: vi.fn(),
    ...overrides
  }
}
