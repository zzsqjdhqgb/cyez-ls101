import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncryptedSecretStorage } from '@ls101/secret-store/main'
import { AIRouterSpeechRecognitionService } from '../main/speech-recognition-service'

describe('AIRouterSpeechRecognitionService', () => {
  let baseDir: string
  let service: AIRouterSpeechRecognitionService

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'airouter-asr-'))
    const secrets = new EncryptedSecretStorage(baseDir, {
      encrypt: (value) => new TextEncoder().encode(value),
      decrypt: (value) => new TextDecoder().decode(value)
    })
    service = new AIRouterSpeechRecognitionService({ baseDir, secretStorage: secrets })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    service.dispose()
    await rm(baseDir, { recursive: true, force: true })
  })

  it('imports Qwen3 ASR packages and only exposes enabled configured models', async () => {
    const packagePath = path.join(baseDir, 'qwen3-asr.zip')
    await writeFile(packagePath, createAsrPackage())
    const imported = await service.importModelPackage(packagePath)

    expect(imported.package).toEqual(
      expect.objectContaining({
        package: expect.objectContaining({ id: 'qwen3-asr-test' }),
        runtime: { engine: 'qwen3-asr', engineApiVersion: 1 },
        assetCount: 7
      })
    )
    await service.saveProviderConfig({
      id: 'local-qwen',
      name: 'Local Qwen',
      kind: 'local',
      type: 'qwen3-asr',
      modelPackageId: 'qwen3-asr-test',
      modelPackageVersion: '1.0.0',
      models: [{ id: 'qwen3-asr-test', enabled: true }]
    })

    await expect(service.listModels()).resolves.toEqual([
      {
        providerId: 'local-qwen',
        providerName: 'Local Qwen',
        modelId: 'qwen3-asr-test',
        modelName: 'Qwen3 ASR Test'
      }
    ])
    await expect(service.deleteModelPackage('qwen3-asr-test', '1.0.0')).rejects.toThrow(
      '仍被 1 个语音识别 Provider 使用'
    )
  })

  it('sends online recognition as an OpenAI-compatible multipart request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: 'recognized text' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await service.saveProviderConfig({
      id: 'online-asr',
      name: 'Online ASR',
      kind: 'online',
      type: 'openai-compatible',
      baseUrl: 'https://asr.example.com/v1/',
      apiKey: 'asr-secret',
      models: [{ id: 'whisper-1', enabled: true }]
    })

    await expect(
      service.recognize({
        providerConfigId: 'online-asr',
        modelId: 'whisper-1',
        audio: { data: new Uint8Array([1, 2]), mediaType: 'audio/webm', filename: 'answer.webm' }
      })
    ).resolves.toEqual({ text: 'recognized text' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://asr.example.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer asr-secret' },
        body: expect.any(FormData)
      })
    )
    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get('model')).toBe('whisper-1')
    expect((body.get('file') as File).name).toBe('answer.webm')
  })

  it('rejects non-audio input before resolving a Provider', async () => {
    await expect(
      service.recognize({
        providerConfigId: 'missing',
        modelId: 'missing',
        audio: { data: new Uint8Array([1]), mediaType: 'application/octet-stream' }
      })
    ).rejects.toThrow('音频输入无效')
  })
})

function createAsrPackage(): Uint8Array {
  const files = Object.fromEntries(
    [
      'model/conv_frontend.onnx',
      'model/encoder.int8.onnx',
      'model/decoder.int8.onnx',
      'model/tokenizer/merges.txt',
      'model/tokenizer/tokenizer_config.json',
      'model/tokenizer/vocab.json',
      'model/silero_vad.onnx'
    ].map((name, index) => [name, new Uint8Array([index + 1])])
  )
  const assets = Object.entries(files).map(([assetPath, bytes]) => ({
    path: assetPath,
    kind: 'model-asset',
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }))
  const manifest = {
    format: 'ls101.asr-model-package',
    formatVersion: 1,
    package: { id: 'qwen3-asr-test', version: '1.0.0', name: 'Qwen3 ASR Test' },
    runtime: { engine: 'qwen3-asr', engineApiVersion: 1 },
    assets,
    models: [
      {
        id: 'qwen3-asr-test',
        name: 'Qwen3 ASR Test',
        artifacts: {
          convFrontend: ['model/conv_frontend.onnx'],
          encoder: ['model/encoder.int8.onnx'],
          decoder: ['model/decoder.int8.onnx'],
          tokenizer: [
            'model/tokenizer/merges.txt',
            'model/tokenizer/tokenizer_config.json',
            'model/tokenizer/vocab.json'
          ],
          vad: ['model/silero_vad.onnx']
        },
        parameters: {}
      }
    ]
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    ...files
  })
}
