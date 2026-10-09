import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIRouterSpeechModelStore } from '../main/speech-model-store'

describe('IndexTTS model package import', () => {
  let directory: string
  let store: AIRouterSpeechModelStore
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'index-package-'))
    store = new AIRouterSpeechModelStore({ baseDir: directory, appVersion: '0.4.2' })
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function importFixture({
    invalidKind = false,
    invalidParameters = false,
    invalidHash = false
  } = {}): Promise<unknown> {
    const model = Buffer.from('GGUF'),
      reference = Buffer.alloc(48)
    const manifest = {
      format: 'ls101.tts-model-package',
      formatVersion: 1,
      package: { id: 'index-package', version: '1.0.0', name: 'Index' },
      runtime: { engine: 'index-tts', engineApiVersion: 1 },
      assets: [
        {
          path: 'model.gguf',
          kind: 'tts-model',
          size: model.length,
          sha256: createHash('sha256').update(model).digest('hex')
        },
        {
          path: 'voice.wav',
          kind: invalidKind ? 'speaker-embedding' : 'speaker-reference',
          size: reference.length,
          sha256: invalidHash
            ? 'a'.repeat(64)
            : createHash('sha256').update(reference).digest('hex')
        }
      ],
      models: [
        {
          id: 'index',
          name: 'Index',
          artifacts: { 'tts-model': ['model.gguf'] },
          parameters: { synthesis: { language: invalidParameters ? 'invalid' : 'auto' } }
        }
      ],
      voices: [{ id: 'voice', name: 'Voice', files: ['voice.wav'] }]
    }
    const filename = path.join(directory, 'fixture.zip')
    await writeFile(
      filename,
      zipSync({
        'manifest.json': strToU8(JSON.stringify(manifest)),
        'model.gguf': model,
        'voice.wav': reference
      })
    )
    return store.importPackage(filename)
  }

  it('imports GGUF and reference assets into extensionless blobs, filtered by engine', async () => {
    await importFixture()
    expect(await store.listPackages('index-tts')).toHaveLength(1)
    expect(await store.listPackages('qwen-tts')).toEqual([])
    const model = await store.resolveAssetFilePath('index-package', '1.0.0', 'model.gguf')
    expect(path.extname(model)).toBe('')
    await store.deletePackage('index-package', '1.0.0')
    expect(await store.listPackages()).toEqual([])
  })

  it('rejects invalid engine assets, language parameters and digests before installation', async () => {
    await expect(importFixture({ invalidKind: true })).rejects.toThrow('speaker-reference')
    await expect(importFixture({ invalidParameters: true })).rejects.toThrow('语言')
    await expect(importFixture({ invalidHash: true })).rejects.toThrow('哈希')
    expect(await store.listPackages()).toEqual([])
  })
})
