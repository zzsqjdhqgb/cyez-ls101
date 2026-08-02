import { describe, expect, it, vi } from 'vitest'
import type { AIRouterClient, AIRouterProviderConfigSummary } from '@ls101/airouter'
import { createInterfaceAIRouterTextGenerator } from '../features/interfaces/InterfaceAIRouterAdapter'

describe('Interface AIRouter adapter', () => {
  it('uses the first enabled text model and forwards stream chunks', async () => {
    const configs: AIRouterProviderConfigSummary[] = [
      {
        id: 'disabled-provider',
        name: 'Disabled',
        type: 'openai-compatible',
        baseUrl: 'https://disabled.example.com/v1',
        models: [{ id: 'disabled-model', enabled: false }],
        hasApiKey: false
      },
      {
        id: 'active-provider',
        name: 'Active',
        type: 'anthropic',
        baseUrl: 'https://active.example.com/v1',
        models: [
          { id: 'active-model', enabled: true },
          { id: 'later-model', enabled: true }
        ],
        hasApiKey: true
      }
    ]
    const generateText = vi.fn((_request, _options) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'reasoning' as const, delta: 'thinking' }
        yield { type: 'output' as const, delta: '{"answer":"ok"}' }
      }
    }))
    const client = clientWith({
      listProviderConfigs: vi.fn().mockResolvedValue(configs),
      generateText
    })
    const controller = new AbortController()
    const chunks = []

    for await (const chunk of createInterfaceAIRouterTextGenerator(client).generate('prompt', {
      signal: controller.signal
    })) {
      chunks.push(chunk)
    }

    expect(generateText).toHaveBeenCalledWith(
      {
        providerConfigId: 'active-provider',
        modelId: 'active-model',
        prompt: 'prompt'
      },
      { signal: controller.signal }
    )
    expect(chunks).toEqual([
      { type: 'reasoning', delta: 'thinking' },
      { type: 'output', delta: '{"answer":"ok"}' }
    ])
  })

  it('fails clearly when no text model is enabled', async () => {
    const client = clientWith({
      listProviderConfigs: vi.fn().mockResolvedValue([])
    })
    const stream = createInterfaceAIRouterTextGenerator(client).generate('prompt', {
      signal: new AbortController().signal
    })

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow(
      '请先在 AI 引擎设置中启用至少一个文本模型'
    )
    expect(client.generateText).not.toHaveBeenCalled()
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
    generateText: vi.fn(),
    ...overrides
  }
}
