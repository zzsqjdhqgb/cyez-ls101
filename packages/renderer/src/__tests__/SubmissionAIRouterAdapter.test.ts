import type { AIRouterClient } from '@ls101/airouter'
import { describe, expect, it, vi } from 'vitest'
import {
  createAIRouterSpeechRecognizer,
  createAIRouterTextGradingModel,
  listSubmissionAIModels
} from '../features/submissions/SubmissionAIRouterAdapter'

describe('submission AIRouter adapter', () => {
  it('lists session-selectable recognition and enabled text models', async () => {
    const client = mockClient()
    vi.mocked(client.listSpeechRecognitionModels).mockResolvedValue([
      {
        providerId: 'builtin-qwen3-asr',
        providerName: '内置语音识别',
        modelId: 'qwen3-asr-0.6b',
        modelName: 'Qwen3 ASR 0.6B'
      }
    ])
    vi.mocked(client.listProviderConfigs).mockResolvedValue([
      {
        id: 'provider',
        name: 'Provider',
        type: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        hasApiKey: true,
        models: [
          { id: 'enabled', enabled: true, metadata: { name: 'Enabled' } },
          { id: 'disabled', enabled: false }
        ]
      }
    ])

    await expect(listSubmissionAIModels(client)).resolves.toEqual({
      speechRecognition: [
        {
          providerId: 'builtin-qwen3-asr',
          providerName: '内置语音识别',
          modelId: 'qwen3-asr-0.6b',
          modelName: 'Qwen3 ASR 0.6B'
        }
      ],
      text: [
        {
          providerId: 'provider',
          providerName: 'Provider',
          modelId: 'enabled',
          modelName: 'Enabled'
        }
      ]
    })
  })

  it('adapts recognition bytes and collects only output text chunks', async () => {
    const client = mockClient()
    vi.mocked(client.recognizeSpeech).mockResolvedValue({ text: 'recognized' })
    vi.mocked(client.generateText).mockReturnValue(
      (async function* () {
        yield { type: 'reasoning' as const, delta: 'thinking' }
        yield { type: 'output' as const, delta: '{"score":' }
        yield { type: 'output' as const, delta: '4,"comment":"ok"}' }
      })()
    )
    const selection = { providerId: 'provider', modelId: 'model' }
    const audio = {
      resourceKey: 'audio',
      filename: 'answer.webm',
      mediaType: 'audio/webm',
      kind: 'recording' as const,
      data: new Uint8Array([1]),
      durationMs: 1000
    }

    await expect(
      createAIRouterSpeechRecognizer(selection, client).recognize({ audio })
    ).resolves.toBe('recognized')
    await expect(
      createAIRouterTextGradingModel(selection, client).generate('prompt')
    ).resolves.toBe('{"score":4,"comment":"ok"}')
  })
})

function mockClient(): AIRouterClient {
  return {
    listProviderConfigs: vi.fn().mockResolvedValue([]),
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
    listSpeechProviderConfigs: vi.fn(),
    saveSpeechProviderConfig: vi.fn(),
    deleteSpeechProviderConfig: vi.fn(),
    readSpeechProviderApiKey: vi.fn(),
    listSpeechModelPackages: vi.fn(),
    importSpeechModelPackage: vi.fn(),
    deleteSpeechModelPackage: vi.fn(),
    listSpeechModels: vi.fn(),
    listSpeechVoices: vi.fn(),
    testSpeechConnection: vi.fn(),
    listSpeechRecognitionModels: vi.fn().mockResolvedValue([]),
    recognizeSpeech: vi.fn(),
    synthesizeSpeech: vi.fn(),
    generateImage: vi.fn(),
    generateText: vi.fn()
  }
}
