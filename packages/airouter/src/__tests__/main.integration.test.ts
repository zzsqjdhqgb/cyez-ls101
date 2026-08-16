import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncryptedSecretStorage } from '@ls101/secret-store/main'
import { strToU8, zipSync } from 'fflate'
import { AIROUTER_CHANNELS } from '../shared'

type IpcHandler = (_event: unknown, ...args: unknown[]) => unknown
type IpcListener = (...args: unknown[]) => void

const {
  electronMocks,
  generateImageMock,
  assessPronunciationMock,
  recognizeSpeechMock,
  speechSynthesizeMock,
  streamTextMock
} = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  const listeners = new Map<string, IpcListener>()
  return {
    electronMocks: {
      handlers,
      listeners,
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler)
      }),
      on: vi.fn((channel: string, listener: IpcListener) => {
        listeners.set(channel, listener)
      }),
      safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((value: string) => new TextEncoder().encode(value)),
        decryptString: vi.fn((value: Uint8Array) => new TextDecoder().decode(value))
      },
      app: { getVersion: vi.fn(() => '0.3.1') }
    },
    generateImageMock: vi.fn(),
    assessPronunciationMock: vi.fn(),
    recognizeSpeechMock: vi.fn(),
    speechSynthesizeMock: vi.fn(),
    streamTextMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: electronMocks.app,
  ipcMain: electronMocks,
  safeStorage: electronMocks.safeStorage
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateImage: generateImageMock, streamText: streamTextMock }
})

vi.mock('../main/pocket-tts', () => ({
  PocketTtsSynthesizer: class {
    synthesize = speechSynthesizeMock
  }
}))

vi.mock('../main/speech-recognition-service', () => ({
  AIRouterSpeechRecognitionService: class {
    listModels() {
      return [
        {
          providerId: 'builtin-qwen3-asr',
          providerName: '内置语音识别',
          modelId: 'qwen3-asr-0.6b',
          modelName: 'Qwen3 ASR 0.6B'
        }
      ]
    }

    recognize = recognizeSpeechMock
  }
}))

vi.mock('../main/pronunciation-assessment-service', () => ({
  AIRouterPronunciationAssessmentService: class {
    listModels() {
      return [
        {
          providerId: 'builtin-facebook-phoneme',
          providerName: '内置发音评测',
          modelId: 'wav2vec2-lv-60-espeak-cv-ft-int8-c69750f',
          modelName: 'Facebook Wav2Vec2 Phoneme INT8'
        }
      ]
    }

    assess = assessPronunciationMock
  }
}))

describe('AIRouter main integration', () => {
  let baseDir: string

  beforeEach(async () => {
    vi.resetModules()
    electronMocks.handlers.clear()
    electronMocks.listeners.clear()
    electronMocks.handle.mockClear()
    electronMocks.on.mockClear()
    generateImageMock.mockReset()
    recognizeSpeechMock.mockReset()
    assessPronunciationMock.mockReset()
    speechSynthesizeMock.mockReset()
    streamTextMock.mockReset()
    baseDir = await mkdtemp(path.join(tmpdir(), 'airouter-main-'))
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('wires provider handlers to the real config and secret stores', async () => {
    const { registerAIRouter } = await import('../main')
    const secrets = new EncryptedSecretStorage(baseDir, {
      encrypt: (value) => new TextEncoder().encode(value),
      decrypt: (value) => new TextDecoder().decode(value)
    })

    registerAIRouter({ baseDir, secretStorage: secrets })

    const save = handler(AIROUTER_CHANNELS.saveConfig)
    const saved = await save(undefined, {
      id: 'provider-a',
      name: '集成测试 Provider',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1/',
      models: [{ id: 'model-a', enabled: true }],
      apiKey: 'integration-secret'
    })

    expect(saved).toEqual(
      expect.objectContaining({
        id: 'provider-a',
        baseUrl: 'https://api.example.com/v1',
        hasApiKey: true
      })
    )
    await expect(handler(AIROUTER_CHANNELS.listConfigs)(undefined)).resolves.toEqual([saved])
    await expect(handler(AIROUTER_CHANNELS.readApiKey)(undefined, 'provider-a')).resolves.toBe(
      'integration-secret'
    )
  })

  it('wires speech provider handlers to config and secret stores', async () => {
    const { registerAIRouter } = await import('../main')
    registerAIRouter({ baseDir, secretStorage: createSecrets(baseDir) })

    const saved = await handler(AIROUTER_CHANNELS.saveSpeechConfig)(undefined, {
      id: 'speech-provider',
      name: '集成测试语音 Provider',
      kind: 'online',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1/',
      models: [{ id: 'tts-model', enabled: true }],
      voices: [{ id: 'voice-a', enabled: true }],
      apiKey: 'speech-secret'
    })

    expect(saved).toEqual(
      expect.objectContaining({
        id: 'speech-provider',
        baseUrl: 'https://api.example.com/v1',
        hasApiKey: true
      })
    )
    await expect(handler(AIROUTER_CHANNELS.listSpeechConfigs)(undefined)).resolves.toEqual([saved])
    await expect(
      handler(AIROUTER_CHANNELS.readSpeechApiKey)(undefined, 'speech-provider')
    ).resolves.toBe('speech-secret')
  })

  it('imports, lists, filters, and deletes speech model packages through IPC', async () => {
    const { registerAIRouter } = await import('../main')
    registerAIRouter({ baseDir, secretStorage: createSecrets(baseDir) })

    const imported = await handler(AIROUTER_CHANNELS.importSpeechPackage)(
      undefined,
      createSpeechPackage()
    )
    expect(imported).toEqual(
      expect.objectContaining({
        package: expect.objectContaining({
          package: expect.objectContaining({ id: 'integration-pocket', version: '1.0.0' }),
          runtime: expect.objectContaining({ engine: 'pocket-tts' })
        }),
        storedAssetCount: 1
      })
    )
    await expect(
      handler(AIROUTER_CHANNELS.listSpeechPackages)(undefined, 'pocket-tts')
    ).resolves.toHaveLength(1)
    await expect(
      handler(AIROUTER_CHANNELS.listSpeechPackages)(undefined, 'qwen-tts')
    ).resolves.toEqual([])

    await handler(AIROUTER_CHANNELS.deleteSpeechPackage)(undefined, 'integration-pocket', '1.0.0')
    await expect(handler(AIROUTER_CHANNELS.listSpeechPackages)(undefined)).resolves.toEqual([])
  })

  it('forwards text stream chunks and completion through the IPC event channel', async () => {
    const { registerAIRouter } = await import('../main')
    const secrets = createSecrets(baseDir)
    registerAIRouter({ baseDir, secretStorage: secrets })
    await handler(AIROUTER_CHANNELS.saveConfig)(undefined, {
      id: 'provider-a',
      name: '集成测试 Provider',
      type: 'openai-compatible',
      models: [{ id: 'model-a', enabled: true }]
    })
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'reasoning-delta', text: '思考' }
        yield { type: 'text-delta', text: '回答' }
        yield { type: 'finish', finishReason: 'stop' }
      })()
    })

    const sender = createSender()
    const requestId = 'text-request'
    listener(AIROUTER_CHANNELS.generateStart)({ sender }, requestId, {
      providerConfigId: 'provider-a',
      modelId: 'model-a',
      prompt: '测试'
    })
    await waitForSentEvents(sender, 3)

    expect(sender.send.mock.calls.map(([, id, event]) => [id, event])).toEqual([
      [requestId, { type: 'chunk', chunk: { type: 'reasoning', delta: '思考' } }],
      [requestId, { type: 'chunk', chunk: { type: 'output', delta: '回答' } }],
      [requestId, { type: 'done' }]
    ])
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '测试', maxOutputTokens: 128 * 1024 })
    )
  })

  it('forwards generated image data through the IPC event channel', async () => {
    const { registerAIRouter } = await import('../main')
    const secrets = createSecrets(baseDir)
    registerAIRouter({ baseDir, secretStorage: secrets })
    await handler(AIROUTER_CHANNELS.saveImageConfig)(undefined, {
      id: 'image-provider',
      name: '集成测试图片 Provider',
      type: 'openai-compatible',
      models: [{ id: 'image-model', enabled: true }],
      apiKey: 'image-secret'
    })
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    generateImageMock.mockResolvedValue({ image: { uint8Array: bytes, mediaType: 'image/png' } })

    const sender = createSender()
    const requestId = 'image-request'
    listener(AIROUTER_CHANNELS.imageGenerateStart)({ sender }, requestId, {
      providerConfigId: 'image-provider',
      modelId: 'image-model',
      prompt: '一张图片',
      size: { width: 512, height: 512 }
    })
    await waitForSentEvents(sender, 1)

    expect(sender.send).toHaveBeenCalledWith(AIROUTER_CHANNELS.imageGenerateEvent, requestId, {
      type: 'result',
      image: { data: bytes, mediaType: 'image/png' }
    })
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '一张图片', size: '512x512' })
    )
  })
  it('forwards synthesized speech data through the IPC event channel', async () => {
    const { registerAIRouter } = await import('../main')
    registerAIRouter({ baseDir, secretStorage: createSecrets(baseDir) })
    await handler(AIROUTER_CHANNELS.importSpeechPackage)(undefined, createSpeechPackage())
    await handler(AIROUTER_CHANNELS.saveSpeechConfig)(undefined, {
      id: 'local-speech-provider',
      name: '本地语音 Provider',
      kind: 'local',
      type: 'pocket-tts',
      modelPackageId: 'integration-pocket',
      modelPackageVersion: '1.0.0',
      models: [{ id: 'local-model', enabled: true }],
      voices: [{ id: 'local-voice', enabled: true }]
    })
    const audio = {
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/wav',
      format: 'wav' as const
    }
    speechSynthesizeMock.mockResolvedValue(audio)

    const sender = createSender()
    const requestId = 'speech-request'
    listener(AIROUTER_CHANNELS.speechSynthesisStart)({ sender }, requestId, {
      text: 'Hello',
      routing: {
        default: {
          providerConfigId: 'local-speech-provider',
          modelId: 'local-model',
          voiceId: 'local-voice'
        }
      }
    })
    await waitForSentEvents(sender, 1)

    expect(sender.send).toHaveBeenCalledWith(AIROUTER_CHANNELS.speechSynthesisEvent, requestId, {
      type: 'result',
      audio
    })
    expect(speechSynthesizeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hello',
        modelId: 'local-model',
        voiceId: 'local-voice',
        format: 'wav'
      })
    )
  })

  it('lists Qwen3 ASR and forwards recognition through the IPC event channel', async () => {
    const { registerAIRouter } = await import('../main')
    registerAIRouter({ baseDir, secretStorage: createSecrets(baseDir) })
    recognizeSpeechMock.mockResolvedValue({ text: 'recognized answer' })

    expect(handler(AIROUTER_CHANNELS.listRecognitionModels)(undefined)).toEqual([
      expect.objectContaining({
        providerId: 'builtin-qwen3-asr',
        modelId: 'qwen3-asr-0.6b'
      })
    ])

    const sender = createSender()
    const requestId = 'recognition-request'
    const request = {
      providerConfigId: 'builtin-qwen3-asr',
      modelId: 'qwen3-asr-0.6b',
      audio: { data: new Uint8Array([1, 2, 3]), mediaType: 'audio/wav' }
    }
    listener(AIROUTER_CHANNELS.speechRecognitionStart)({ sender }, requestId, request)
    await waitForSentEvents(sender, 1)

    expect(sender.send).toHaveBeenCalledWith(AIROUTER_CHANNELS.speechRecognitionEvent, requestId, {
      type: 'result',
      result: { text: 'recognized answer' }
    })
    expect(recognizeSpeechMock).toHaveBeenCalledWith(request, {
      signal: expect.any(AbortSignal)
    })
  })

  it('lists the phoneme model and forwards pronunciation assessment through IPC', async () => {
    const { registerAIRouter } = await import('../main')
    registerAIRouter({ baseDir, secretStorage: createSecrets(baseDir) })
    const result = {
      referenceText: 'three',
      recognizedPhones: ['s'],
      overallScore: 20,
      words: [],
      pauses: [],
      feedbackMarkdown: 'feedback'
    }
    assessPronunciationMock.mockResolvedValue(result)
    expect(handler(AIROUTER_CHANNELS.listPronunciationModels)(undefined)).toEqual([
      expect.objectContaining({ modelId: 'wav2vec2-lv-60-espeak-cv-ft-int8-c69750f' })
    ])
    const sender = createSender()
    const requestId = 'pronunciation-request'
    const request = {
      providerConfigId: 'builtin-facebook-phoneme',
      modelId: 'wav2vec2-lv-60-espeak-cv-ft-int8-c69750f',
      referenceText: 'three',
      audio: { data: new Uint8Array([1, 2, 3]), mediaType: 'audio/wav' }
    }
    listener(AIROUTER_CHANNELS.pronunciationAssessmentStart)({ sender }, requestId, request)
    await waitForSentEvents(sender, 1)
    expect(sender.send).toHaveBeenCalledWith(
      AIROUTER_CHANNELS.pronunciationAssessmentEvent,
      requestId,
      { type: 'result', result }
    )
    expect(assessPronunciationMock).toHaveBeenCalledWith(request, {
      signal: expect.any(AbortSignal)
    })
  })
})

function createSpeechPackage(): Uint8Array {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const manifest = {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: { id: 'integration-pocket', version: '1.0.0', name: 'Integration Pocket' },
    runtime: { engine: 'pocket-tts', engineApiVersion: 1 },
    assets: [
      {
        path: 'model/shared.bin',
        kind: 'model-asset',
        size: bytes.byteLength,
        sha256
      }
    ],
    models: [
      {
        id: 'local-model',
        name: 'Local Model',
        artifacts: {
          weights: ['model/shared.bin'],
          tokenizer: ['model/shared.bin']
        },
        parameters: {}
      }
    ],
    voices: [{ id: 'local-voice', name: 'Local Voice', files: ['model/shared.bin'] }]
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'model/shared.bin': bytes
  })
}

function createSecrets(baseDir: string): EncryptedSecretStorage {
  return new EncryptedSecretStorage(baseDir, {
    encrypt: (value) => new TextEncoder().encode(value),
    decrypt: (value) => new TextDecoder().decode(value)
  })
}

function handler(channel: string): IpcHandler {
  const registered = electronMocks.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered
}

function listener(channel: string): IpcListener {
  const registered = electronMocks.listeners.get(channel)
  if (!registered) throw new Error(`No listener registered for ${channel}`)
  return registered
}

function createSender() {
  return { id: 1, isDestroyed: () => false, send: vi.fn() }
}

async function waitForSentEvents(sender: ReturnType<typeof createSender>, count: number) {
  const deadline = Date.now() + 1000
  while (sender.send.mock.calls.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(sender.send.mock.calls.length).toBeGreaterThanOrEqual(count)
}
