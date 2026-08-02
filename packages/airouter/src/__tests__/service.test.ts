import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncryptedSecretStorage } from '@ls101/secret-store/main'
import { AIRouterService } from '../main/service'

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextMock }
})

describe('AIRouterService', () => {
  let baseDir: string
  let service: AIRouterService

  beforeEach(async () => {
    generateTextMock.mockReset()
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
    const draft = {
      name: '测试服务',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [],
      apiKey: 'secret-key'
    } as const
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
    const draft = {
      name: '测试服务',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [{ id: 'draft-model', enabled: true }],
      apiKey: 'draft-secret'
    } as const

    await expect(
      service.testConnection({ config: draft, modelId: 'draft-model' })
    ).resolves.toEqual({ ok: true, text: 'OK' })
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '请只回复 OK，不要添加其他内容。' })
    )
    expect(await service.listProviderConfigs()).toEqual([])
  })
})
