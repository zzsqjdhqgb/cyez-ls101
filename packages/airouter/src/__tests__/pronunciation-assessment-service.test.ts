import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BUILTIN_PRONUNCIATION_MODEL_ID,
  BUILTIN_PRONUNCIATION_PROVIDER_ID
} from '../shared'
import { AIRouterPronunciationAssessmentService } from '../main/pronunciation-assessment-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('AIRouterPronunciationAssessmentService', () => {
  it('only exposes the built-in model when every asset exists', async () => {
    const assetsDir = await modelAssets()
    const service = new AIRouterPronunciationAssessmentService({ assetsDir })

    expect(service.listModels()).toEqual([
      {
        providerId: BUILTIN_PRONUNCIATION_PROVIDER_ID,
        providerName: '内置发音评测',
        modelId: BUILTIN_PRONUNCIATION_MODEL_ID,
        modelName: 'Facebook Wav2Vec2 Phoneme INT8'
      }
    ])
    await rm(
      join(
        assetsDir,
        'facebook-wav2vec2-lv-60-espeak-cv-ft-int8',
        'onnx',
        'model_quantized.onnx'
      )
    )
    expect(service.listModels()).toEqual([])
  })

  it('rejects invalid model selections, reference text, and media types before a worker starts', async () => {
    const service = new AIRouterPronunciationAssessmentService({ assetsDir: await modelAssets() })
    const valid = {
      providerConfigId: BUILTIN_PRONUNCIATION_PROVIDER_ID,
      modelId: BUILTIN_PRONUNCIATION_MODEL_ID,
      referenceText: 'Three.',
      audio: { data: new Uint8Array([1]), mediaType: 'audio/wav' }
    }
    await expect(service.assess({ ...valid, providerConfigId: 'other' })).rejects.toThrow('Provider')
    await expect(service.assess({ ...valid, referenceText: '' })).rejects.toThrow('参考文本')
    await expect(
      service.assess({ ...valid, audio: { ...valid.audio, mediaType: 'application/octet-stream' } })
    ).rejects.toThrow('音频输入无效')
  })
})

async function modelAssets(): Promise<string> {
  const assetsDir = await mkdtemp(join(tmpdir(), 'ls101-pronunciation-assets-'))
  temporaryDirectories.push(assetsDir)
  const modelDir = join(assetsDir, 'facebook-wav2vec2-lv-60-espeak-cv-ft-int8')
  await mkdir(join(modelDir, 'onnx'), { recursive: true })
  await Promise.all(
    ['config.json', 'preprocessor_config.json', 'vocab.json'].map((filename) =>
      writeFile(join(modelDir, filename), new Uint8Array([1]))
    )
  )
  await writeFile(join(modelDir, 'onnx', 'model_quantized.onnx'), new Uint8Array([1]))
  return assetsDir
}
