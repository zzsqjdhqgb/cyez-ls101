import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AIRouterSpeechRecognitionService,
  BUILTIN_ASR_MODEL_ID,
  BUILTIN_ASR_PROVIDER_ID
} from '../main/speech-recognition-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('AIRouterSpeechRecognitionService', () => {
  it('only exposes the built-in Qwen3 model when every model asset exists', async () => {
    const assetsDir = await modelAssets()
    const service = new AIRouterSpeechRecognitionService({ assetsDir })
    expect(service.listModels()).toEqual([
      {
        providerId: BUILTIN_ASR_PROVIDER_ID,
        providerName: '内置语音识别',
        modelId: BUILTIN_ASR_MODEL_ID,
        modelName: 'Qwen3 ASR 0.6B'
      }
    ])

    await rm(join(assetsDir, 'silero_vad.onnx'))
    expect(service.listModels()).toEqual([])
  })

  it('rejects invalid selections and non-audio data before creating a worker', async () => {
    const service = new AIRouterSpeechRecognitionService({ assetsDir: await modelAssets() })
    await expect(
      service.recognize({
        providerConfigId: 'other',
        modelId: BUILTIN_ASR_MODEL_ID,
        audio: { data: new Uint8Array([1]), mediaType: 'audio/wav' }
      })
    ).rejects.toThrow('Provider')
    await expect(
      service.recognize({
        providerConfigId: BUILTIN_ASR_PROVIDER_ID,
        modelId: BUILTIN_ASR_MODEL_ID,
        audio: { data: new Uint8Array([1]), mediaType: 'application/octet-stream' }
      })
    ).rejects.toThrow('音频输入无效')
  })
})

async function modelAssets(): Promise<string> {
  const assetsDir = await mkdtemp(join(tmpdir(), 'ls101-asr-assets-'))
  temporaryDirectories.push(assetsDir)
  const modelDir = join(assetsDir, 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25')
  await mkdir(join(modelDir, 'tokenizer'), { recursive: true })
  await Promise.all(
    ['conv_frontend.onnx', 'encoder.int8.onnx', 'decoder.int8.onnx'].map((filename) =>
      writeFile(join(modelDir, filename), new Uint8Array([1]))
    )
  )
  await writeFile(join(assetsDir, 'silero_vad.onnx'), new Uint8Array([1]))
  return assetsDir
}
