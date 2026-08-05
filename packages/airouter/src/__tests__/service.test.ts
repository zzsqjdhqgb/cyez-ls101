import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncryptedSecretStorage } from '@ls101/secret-store/main'
import type { AIRouterProviderConfigInput } from '../shared'
import { AIRouterService } from '../main/service'

const { generateTextMock, streamTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  streamTextMock: vi.fn()
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextMock, streamText: streamTextMock }
})

describe('AIRouterService', () => {
  let baseDir: string
  let service: AIRouterService

  beforeEach(async () => {
    generateTextMock.mockReset()
    streamTextMock.mockReset()
    baseDir = await mkdtemp(path.join(tmpdir(), 'airouter-'))
    const secrets = new EncryptedSecretStorage(baseDir, {
      encrypt: (value) => new TextEncoder().encode(value),
      decrypt: (value) => new TextDecoder().decode(value)
    })
    service = new AIRouterService({ baseDir, secretStorage: secrets })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(baseDir, { recursive: true, force: true })
  })

  it('persists provider metadata separately from its API key', async () => {
    const saved = await service.saveProviderConfig({
      name: '测试 OpenAI',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1/',
      models: [{ id: 'example-model', enabled: true }],
      apiKey: 'secret-key'
    })

    expect(saved.id).toBeTruthy()
    expect(saved.baseUrl).toBe('https://api.example.com/v1')
    expect(saved.hasApiKey).toBe(true)
    const configDocument = await readFile(
      path.join(baseDir, 'config', 'airouter', 'providers.json'),
      'utf8'
    )
    expect(configDocument).not.toContain('secret-key')
    expect(await service.listProviderConfigs()).toEqual([saved])
    expect(await service.readProviderApiKey(saved.id)).toBe('secret-key')

    const cleared = await service.saveProviderConfig({
      ...saved,
      clearApiKey: true
    })
    expect(cleared.hasApiKey).toBe(false)
    expect(await service.readProviderApiKey(saved.id)).toBeNull()
  })

  it('discovers and sorts model ids from an unsaved provider draft', async () => {
    const draft: AIRouterProviderConfigInput = {
      name: '测试服务',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [],
      apiKey: 'secret-key'
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'zeta' }, { id: 'alpha' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(service.listModels(draft)).resolves.toEqual([{ id: 'alpha' }, { id: 'zeta' }])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({ headers: { authorization: 'Bearer secret-key' } })
    )
    expect(await service.listProviderConfigs()).toEqual([])
  })

  it('tests a model from an unsaved provider draft without persisting it', async () => {
    generateTextMock.mockResolvedValue({ text: 'OK' })
    const draft: AIRouterProviderConfigInput = {
      name: '测试服务',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [{ id: 'draft-model', enabled: true }],
      apiKey: 'draft-secret'
    }

    await expect(
      service.testConnection({ config: draft, modelId: 'draft-model' })
    ).resolves.toEqual({ ok: true, text: 'OK' })
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '请只回复 OK，不要添加其他内容。' })
    )
    expect(await service.listProviderConfigs()).toEqual([])
  })

  it('maps AI SDK 7 text and reasoning deltas', async () => {
    const saved = await service.saveProviderConfig({
      name: '测试 OpenAI',
      type: 'openai-compatible',
      models: [{ id: 'test-model', enabled: true }]
    })
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'reasoning-delta', id: 'reasoning-1', text: '思考' }
        yield { type: 'text-delta', id: 'text-1', text: '回答' }
        yield { type: 'finish', finishReason: 'stop' }
      })()
    })

    const chunks = []
    for await (const chunk of service.generateText({
      providerConfigId: saved.id,
      modelId: 'test-model',
      prompt: '测试'
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'reasoning', delta: '思考' },
      { type: 'output', delta: '回答' }
    ])
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 8192 }))
  })

  it('reports a truncated text stream before JSON validation', async () => {
    const saved = await service.saveProviderConfig({
      name: '测试 OpenAI',
      type: 'openai-compatible',
      models: [{ id: 'test-model', enabled: true }]
    })
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', id: 'text-1', text: '{"title":"未完成' }
        yield { type: 'finish', finishReason: 'length' }
      })()
    })

    await expect(
      (async () => {
        for await (const _chunk of service.generateText({
          providerConfigId: saved.id,
          modelId: 'test-model',
          prompt: '测试'
        })) {
          // Consume the stream until the finish reason is reported.
        }
      })()
    ).rejects.toThrow('AI 输出达到长度上限')
  })
})
