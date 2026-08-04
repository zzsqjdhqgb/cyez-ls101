import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncryptedSecretStorage } from '@ls101/secret-store/main'
import { AIROUTER_CHANNELS } from '../shared'

type IpcHandler = (_event: unknown, ...args: unknown[]) => unknown
type IpcListener = (...args: unknown[]) => void

const { electronMocks, generateImageMock, streamTextMock } = vi.hoisted(() => {
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
      }
    },
    generateImageMock: vi.fn(),
    streamTextMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: electronMocks,
  safeStorage: electronMocks.safeStorage
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateImage: generateImageMock, streamText: streamTextMock }
})

describe('AIRouter main integration', () => {
  let baseDir: string

  beforeEach(async () => {
    vi.resetModules()
    electronMocks.handlers.clear()
    electronMocks.listeners.clear()
    electronMocks.handle.mockClear()
    electronMocks.on.mockClear()
    generateImageMock.mockReset()
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
      expect.objectContaining({ prompt: '测试', maxOutputTokens: 8192 })
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
    const bytes = new Uint8Array([1, 2, 3])
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
})

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
