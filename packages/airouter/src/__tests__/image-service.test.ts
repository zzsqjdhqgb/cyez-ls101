import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncryptedSecretStorage } from '@ls101/secret-store/main'
import { AIRouterImageService } from '../main/image-service'

const { generateImageMock } = vi.hoisted(() => ({ generateImageMock: vi.fn() }))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateImage: generateImageMock }
})

describe('AIRouterImageService', () => {
  let baseDir: string
  let service: AIRouterImageService

  beforeEach(async () => {
    generateImageMock.mockReset()
    baseDir = await mkdtemp(path.join(tmpdir(), 'airouter-image-'))
    const secrets = new EncryptedSecretStorage(baseDir, {
      encrypt: (value) => new TextEncoder().encode(value),
      decrypt: (value) => new TextDecoder().decode(value)
    })
    service = new AIRouterImageService({ baseDir, secretStorage: secrets })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(baseDir, { recursive: true, force: true })
  })

  it('stores image providers and secrets independently from text providers', async () => {
    const saved = await service.saveProviderConfig({
      name: '图片 OpenAI',
      type: 'openai-compatible',
      baseUrl: 'https://images.example.com/v1/',
      models: [{ id: 'image-model', enabled: true }],
      apiKey: 'image-secret'
    })

    expect(saved.baseUrl).toBe('https://images.example.com/v1')
    expect(await service.readProviderApiKey(saved.id)).toBe('image-secret')
    const document = await readFile(
      path.join(baseDir, 'config', 'airouter', 'image-providers.json'),
      'utf8'
    )
    expect(document).not.toContain('image-secret')
    expect(
      await readFile(path.join(baseDir, 'config', 'airouter', 'providers.json'), 'utf8').catch(
        () => null
      )
    ).toBeNull()
  })

  it('exposes a manual Provider initially and restores one when no selectable Provider remains', async () => {
    const initial = await service.listProviderConfigs()
    expect(initial).toEqual([
      expect.objectContaining({ id: 'manual', name: '手动生成', type: 'manual', models: [] })
    ])
    const saved = await service.saveProviderConfig({
      name: '图片 OpenAI',
      type: 'openai-compatible',
      models: [{ id: 'image-model', enabled: true }]
    })
    await service.deleteProviderConfig('manual')
    expect(await service.listProviderConfigs()).toEqual([saved])
    await service.deleteProviderConfig(saved.id)
    expect(await service.listProviderConfigs()).toEqual([
      expect.objectContaining({ type: 'manual', models: [] })
    ])
  })

  it('stores manual Providers without API fields or models', async () => {
    await expect(
      service.saveProviderConfig({
        name: '外部手动生成',
        type: 'manual',
        baseUrl: 'https://ignored.example.com/v1',
        models: [{ id: 'ignored', enabled: true }],
        apiKey: 'ignored-secret'
      })
    ).resolves.toEqual(
      expect.objectContaining({
        name: '外部手动生成',
        type: 'manual',
        baseUrl: '',
        models: [],
        hasApiKey: false
      })
    )
  })

  it('generates one image with the selected provider model', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    generateImageMock.mockResolvedValue({
      image: { uint8Array: bytes, mediaType: 'image/png' }
    })
    const saved = await service.saveProviderConfig({
      name: '图片 OpenAI',
      type: 'openai-compatible',
      models: [{ id: 'image-model', enabled: true }],
      apiKey: 'secret'
    })

    await expect(
      service.generateImage({
        providerConfigId: saved.id,
        modelId: 'image-model',
        prompt: '校园操场',
        size: { width: 1024, height: 1024 }
      })
    ).resolves.toEqual({ data: bytes, mediaType: 'image/png' })
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '校园操场', size: '1024x1024' })
    )
  })

  it('retries without response_format when an OpenAI-compatible model rejects it', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    generateImageMock.mockRejectedValue(
      new Error(
        'UnsupportedParamsError: Setting `response_format` is not supported by openai, agnes-t2i-general-model'
      )
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://cdn.agnes.example/image.png' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const saved = await service.saveProviderConfig({
      name: 'Agnes AI',
      type: 'openai-compatible',
      baseUrl: 'https://api.agnes.example/v1',
      models: [{ id: 'agnes-t2i-general-model', enabled: true }],
      apiKey: 'agnes-secret'
    })

    await expect(
      service.generateImage({
        providerConfigId: saved.id,
        modelId: 'agnes-t2i-general-model',
        prompt: '一枚绿色图标',
        size: { width: 1024, height: 1024 }
      })
    ).resolves.toEqual({ data: bytes, mediaType: 'image/png' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.agnes.example/v1/images/generations')
    expect(init.headers).toEqual({
      authorization: 'Bearer agnes-secret',
      'content-type': 'application/json'
    })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'agnes-t2i-general-model',
      prompt: '一枚绿色图标',
      n: 1,
      size: '1024x1024'
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://cdn.agnes.example/image.png', {
      signal: undefined
    })
  })

  it('rejects generated bytes that are not a supported image', async () => {
    generateImageMock.mockResolvedValue({
      image: { uint8Array: new Uint8Array([110, 111, 116]), mediaType: 'image/png' }
    })
    const saved = await service.saveProviderConfig({
      name: 'Invalid image API',
      type: 'openai-compatible',
      models: [{ id: 'image-model', enabled: true }]
    })

    await expect(
      service.generateImage({
        providerConfigId: saved.id,
        modelId: 'image-model',
        prompt: 'invalid result'
      })
    ).rejects.toThrow('生成结果不是图片')
  })
})
