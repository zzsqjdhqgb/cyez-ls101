import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_PRONUNCIATION_MODEL_ID, BUILTIN_PRONUNCIATION_PROVIDER_ID } from '../shared'
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
    const baseDir = await modelAssets()
    let installed = true
    const service = new AIRouterPronunciationAssessmentService({
      baseDir,
      extensionStore: {
        isInstalled: () => installed
      } as never
    })

    expect(service.listModels()).toEqual([
      {
        providerId: BUILTIN_PRONUNCIATION_PROVIDER_ID,
        providerName: '内置发音评测',
        modelId: BUILTIN_PRONUNCIATION_MODEL_ID,
        modelName: 'Facebook Wav2Vec2 Phoneme INT8'
      }
    ])
    await rm(
      join(baseDir, 'extensions', 'facebook-wav2vec2-pronunciation', '1.0.0', 'manifest.json')
    )
    installed = false
    expect(service.listModels()).toEqual([])
  })

  it('rejects invalid model selections, reference text, and media types before a worker starts', async () => {
    const service = new AIRouterPronunciationAssessmentService({
      baseDir: await modelAssets(),
      extensionStore: { isInstalled: () => true } as never
    })
    const valid = {
      providerConfigId: BUILTIN_PRONUNCIATION_PROVIDER_ID,
      modelId: BUILTIN_PRONUNCIATION_MODEL_ID,
      referenceText: 'Three.',
      audio: { data: new Uint8Array([1]), mediaType: 'audio/wav' }
    }
    await expect(service.assess({ ...valid, providerConfigId: 'other' })).rejects.toThrow(
      'Provider'
    )
    await expect(service.assess({ ...valid, referenceText: '' })).rejects.toThrow('参考文本')
    await expect(
      service.assess({ ...valid, audio: { ...valid.audio, mediaType: 'application/octet-stream' } })
    ).rejects.toThrow('音频输入无效')
  })

  it('deletes the required extension and stops exposing its model', async () => {
    let installed = true
    const deletePackage = vi.fn(async () => {
      installed = false
    })
    const service = new AIRouterPronunciationAssessmentService({
      baseDir: await modelAssets(),
      extensionStore: {
        isInstalled: () => installed,
        deletePackage
      } as never
    })

    expect(service.listModels()).toHaveLength(1)
    await service.deleteExtension()

    expect(deletePackage).toHaveBeenCalledWith('facebook-wav2vec2-pronunciation', '1.0.0')
    expect(service.listModels()).toEqual([])
  })
})

async function modelAssets(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), 'ls101-pronunciation-assets-'))
  temporaryDirectories.push(baseDir)
  const packageDir = join(baseDir, 'extensions', 'facebook-wav2vec2-pronunciation', '1.0.0')
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'manifest.json'),
    JSON.stringify({
      format: 'ls101.extension-package',
      formatVersion: 1,
      extension: { id: 'facebook-wav2vec2-pronunciation', version: '1.0.0', name: 'AI 语音评测' },
      assets: [{ path: 'model/config.json', kind: 'model-config', size: 1, sha256: '0'.repeat(64) }]
    })
  )
  return baseDir
}
