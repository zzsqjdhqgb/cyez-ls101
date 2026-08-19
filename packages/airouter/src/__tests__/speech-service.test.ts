import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncryptedSecretStorage } from '@ls101/secret-store/main'
import { AIRouterSpeechModelStore } from '../main/speech-model-store'
import { AIRouterSpeechService } from '../main/speech-service'

describe('AIRouterSpeechService', () => {
  let baseDir: string
  let service: AIRouterSpeechService

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'airouter-speech-'))
    const secrets = new EncryptedSecretStorage(baseDir, {
      encrypt: (value) => new TextEncoder().encode(value),
      decrypt: (value) => new TextDecoder().decode(value)
    })
    service = new AIRouterSpeechService({ baseDir, secretStorage: secrets })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(baseDir, { recursive: true, force: true })
  })

  it('stores online speech providers separately and maps OpenAI speech requests', async () => {
    const audio = createWav([0, 0, 0, 0])
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(audio, { status: 200, headers: { 'content-type': 'audio/wav' } })
      )
    vi.stubGlobal('fetch', fetchMock)

    const saved = await service.saveProviderConfig({
      id: 'openai-speech',
      name: 'OpenAI Speech',
      kind: 'online',
      type: 'openai-compatible',
      baseUrl: 'https://speech.example.com/v1/',
      models: [{ id: 'tts-1', enabled: true }],
      voices: [{ id: 'alloy', enabled: true }],
      apiKey: 'speech-secret'
    })

    expect(saved).toEqual(
      expect.objectContaining({
        baseUrl: 'https://speech.example.com/v1',
        modelPackageId: '',
        hasApiKey: true
      })
    )
    await expect(
      service.synthesizeSpeech({
        text: 'Hello',
        routing: {
          default: {
            providerConfigId: 'openai-speech',
            modelId: 'tts-1',
            voiceId: 'alloy'
          }
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({ data: audio, mediaType: 'audio/wav', format: 'wav' })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://speech.example.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer speech-secret' }),
        body: JSON.stringify({
          model: 'tts-1',
          input: 'Hello',
          voice: 'alloy',
          response_format: 'wav'
        })
      })
    )
  })

  it('routes marked lines and concatenates WAV segments in order', async () => {
    const outputs = [createWav([100, 200]), createWav([300, 400])]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(outputs[0], { headers: { 'content-type': 'audio/wav' } }))
      .mockResolvedValueOnce(new Response(outputs[1], { headers: { 'content-type': 'audio/wav' } }))
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'provider',
      name: 'Provider',
      kind: 'online',
      type: 'openai-compatible',
      models: [{ id: 'model', enabled: true }],
      voices: [
        { id: 'default', enabled: true },
        { id: 'man', enabled: true }
      ],
      apiKey: 'secret'
    })

    const result = await service.synthesizeSpeech({
      text: '[Man]: first\n[Man]: second\nDefault line',
      routing: {
        default: { providerConfigId: 'provider', modelId: 'model', voiceId: 'default' },
        man: { providerConfigId: 'provider', modelId: 'model', voiceId: 'man' }
      }
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual(
      expect.objectContaining({ input: 'first\nsecond', voice: 'man' })
    )
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual(
      expect.objectContaining({ input: 'Default line', voice: 'default' })
    )
    expect(result.mediaType).toBe('audio/wav')
    expect(result.data.byteLength).toBeGreaterThan(outputs[0].byteLength)
  })

  it.each([
    ['mp3', 'audio/mpeg'],
    ['opus', 'audio/opus'],
    ['pcm-s16le', 'audio/pcm']
  ] as const)('transcodes multi-segment WAV output to %s', async (format, mediaType) => {
    const wav = createWav(new Array(2400).fill(0))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(wav, { headers: { 'content-type': 'audio/wav' } }))
      .mockResolvedValueOnce(new Response(wav, { headers: { 'content-type': 'audio/wav' } }))
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: `provider-${format}`,
      name: `Provider ${format}`,
      kind: 'online',
      type: 'openai-compatible',
      models: [{ id: 'model', enabled: true }],
      voices: [
        { id: 'default', enabled: true },
        { id: 'man', enabled: true }
      ],
      apiKey: 'secret'
    })

    const result = await service.synthesizeSpeech({
      text: '[Man]: first\nDefault line',
      format,
      routing: {
        default: {
          providerConfigId: `provider-${format}`,
          modelId: 'model',
          voiceId: 'default'
        },
        man: {
          providerConfigId: `provider-${format}`,
          modelId: 'model',
          voiceId: 'man'
        }
      }
    })

    expect(result).toEqual(expect.objectContaining({ format, mediaType }))
    expect(result.data.byteLength).toBeGreaterThan(0)
    expect(
      fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).response_format)
    ).toEqual(['wav', 'wav'])
  })

  it('rejects an invalid provider kind without corrupting stored configuration', async () => {
    await expect(
      service.saveProviderConfig({
        id: 'invalid-provider',
        name: 'Invalid Provider',
        kind: 'invalid' as never,
        type: 'pocket-tts',
        models: [],
        voices: []
      })
    ).rejects.toThrow('kind 无效')

    await expect(service.listProviderConfigs()).resolves.toEqual([])
  })

  it('uses an installed local model package and local synthesizer', async () => {
    const modelBytes = new Uint8Array([1, 2, 3])
    const modelStore = new AIRouterSpeechModelStore({ baseDir })
    const packagePath = path.join(baseDir, 'local-package.zip')
    await writeFile(packagePath, createLocalPackage(modelBytes))
    await modelStore.importPackage(packagePath)
    const synthesize = vi.fn().mockResolvedValue({
      data: createWav([1, 2]),
      mediaType: 'audio/wav',
      format: 'wav',
      sampleRate: 24000,
      channels: 1
    })
    service = new AIRouterSpeechService({
      baseDir,
      secretStorage: new EncryptedSecretStorage(baseDir, {
        encrypt: (value) => new TextEncoder().encode(value),
        decrypt: (value) => new TextDecoder().decode(value)
      }),
      modelStore,
      localSynthesizers: { 'pocket-tts': { synthesize } }
    })
    await service.saveProviderConfig({
      id: 'local',
      name: 'Pocket TTS',
      kind: 'local',
      type: 'pocket-tts',
      modelPackageId: 'local-package',
      modelPackageVersion: '1.0.0',
      models: [{ id: 'local-model', enabled: true }],
      voices: [{ id: 'voice', enabled: true }]
    })

    await expect(
      service.listModels({
        id: 'local',
        name: 'Pocket TTS',
        kind: 'local',
        type: 'pocket-tts',
        modelPackageId: 'local-package',
        modelPackageVersion: '1.0.0',
        models: [],
        voices: []
      })
    ).resolves.toEqual([expect.objectContaining({ id: 'local-model' })])
    await service.synthesizeSpeech({
      text: 'Hello',
      routing: {
        default: { providerConfigId: 'local', modelId: 'local-model', voiceId: 'voice' }
      }
    })
    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'local-model', voiceId: 'voice', text: 'Hello' })
    )
  })
})

function createLocalPackage(bytes: Uint8Array): Uint8Array {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const manifest = {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: { id: 'local-package', version: '1.0.0', name: 'Local Package' },
    runtime: { engine: 'pocket-tts', engineApiVersion: 1 },
    assets: [
      { path: 'model.bin', kind: 'model-weights', size: bytes.byteLength, sha256: hash },
      { path: 'voice.bin', kind: 'voice', size: bytes.byteLength, sha256: hash }
    ],
    models: [
      {
        id: 'local-model',
        name: 'Local Model',
        artifacts: { weights: ['model.bin'] },
        parameters: {}
      }
    ],
    voices: [{ id: 'voice', name: 'Voice', files: ['voice.bin'] }]
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'model.bin': bytes,
    'voice.bin': bytes
  })
}

function createWav(samples: number[]): Uint8Array {
  const data = new Uint8Array(samples.length * 2)
  const dataView = new DataView(data.buffer)
  samples.forEach((sample, index) => dataView.setInt16(index * 2, sample, true))
  const buffer = new ArrayBuffer(44 + data.byteLength)
  const view = new DataView(buffer)
  const write = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + data.byteLength, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 24000, true)
  view.setUint32(28, 48000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, data.byteLength, true)
  new Uint8Array(buffer, 44).set(data)
  return new Uint8Array(buffer)
}
