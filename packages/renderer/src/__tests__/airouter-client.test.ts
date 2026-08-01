import { describe, expect, it, vi } from 'vitest'
import { createAIRouterClient } from '@ls101/airouter/renderer'
import type { AIRouterBridge } from '@ls101/airouter/shared'

describe('AIRouter renderer client', () => {
  it('adapts IPC stream events into text chunks', async () => {
    let cancel = vi.fn()
    const bridge: AIRouterBridge = {
      listProviderConfigs: vi.fn(),
      saveProviderConfig: vi.fn(),
      deleteProviderConfig: vi.fn(),
      listModels: vi.fn(),
      testConnection: vi.fn(),
      startTextGeneration: vi.fn((_request, listener) => {
        queueMicrotask(() => listener({ type: 'chunk', chunk: { type: 'output', delta: 'A' } }))
        queueMicrotask(() => listener({ type: 'chunk', chunk: { type: 'reasoning', delta: 'B' } }))
        queueMicrotask(() => listener({ type: 'done' }))
        return cancel
      })
    }
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
    expect(cancel).toHaveBeenCalled()
  })

  it('ends a pending stream when the caller aborts', async () => {
    const cancel = vi.fn()
    const bridge: AIRouterBridge = {
      listProviderConfigs: vi.fn(),
      saveProviderConfig: vi.fn(),
      deleteProviderConfig: vi.fn(),
      listModels: vi.fn(),
      testConnection: vi.fn(),
      startTextGeneration: vi.fn(() => cancel)
    }
    const controller = new AbortController()
    const stream = createAIRouterClient(bridge).generateText(
      { providerConfigId: 'config', modelId: 'model', prompt: 'prompt' },
      { signal: controller.signal }
    )
    const iterator = stream[Symbol.asyncIterator]()
    const next = iterator.next()
    controller.abort()

    await expect(next).resolves.toEqual({ value: undefined, done: true })
    expect(cancel).toHaveBeenCalled()
  })
})
