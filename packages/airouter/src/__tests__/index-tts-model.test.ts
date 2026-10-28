import { describe, expect, it } from 'vitest'
import {
  INDEX_TTS_LANGUAGES,
  assertIndexTtsManifest,
  indexTtsParameters
} from '../main/index-tts-model'
import type { AIRouterSpeechModelPackageManifest } from '../shared'

describe('indexTtsParameters', () => {
  it('applies the documented defaults for an empty manifest', () => {
    expect(indexTtsParameters(undefined)).toEqual({
      load: { threads: 4, device: 0, lowMemory: true },
      synthesis: { language: 'auto', maxTokens: 1500 }
    })
  })

  it('keeps every accepted value inside the documented ranges', () => {
    expect(
      indexTtsParameters({
        load: { threads: 256, device: 31, lowMemory: false },
        synthesis: { language: 'ar', maxTokens: 8192, seed: 4294967295 }
      })
    ).toEqual({
      load: { threads: 256, device: 31, lowMemory: false },
      synthesis: { language: 'ar', maxTokens: 8192, seed: 4294967295 }
    })
  })

  it('normalizes out-of-range and malformed values back to defaults', () => {
    expect(
      indexTtsParameters({
        load: { threads: 0, device: 99, lowMemory: 'no' },
        synthesis: { language: 'fr', maxTokens: 0, seed: -1 }
      })
    ).toEqual({
      load: { threads: 4, device: 0, lowMemory: true },
      synthesis: { language: 'auto', maxTokens: 1500 }
    })
  })

  it('drops a non-integer or overflowing seed', () => {
    expect(indexTtsParameters({ synthesis: { seed: 1.5 } }).synthesis.seed).toBeUndefined()
    expect(indexTtsParameters({ synthesis: { seed: 4294967296 } }).synthesis.seed).toBeUndefined()
    expect(indexTtsParameters({ synthesis: { seed: 7 } }).synthesis.seed).toBe(7)
  })

  it('enumerates exactly the five supported languages plus auto', () => {
    expect([...INDEX_TTS_LANGUAGES]).toEqual(['auto', 'zh', 'en', 'ja', 'es', 'ar'])
  })
})

describe('assertIndexTtsManifest', () => {
  it('accepts a well-formed IndexTTS manifest', () => {
    expect(() => assertIndexTtsManifest(createManifest())).not.toThrow()
  })

  it('ignores manifests for other engines', () => {
    const manifest = createManifest()
    manifest.runtime.engine = 'qwen-tts'
    manifest.models[0].artifacts = { 'tts-model': ['models/a.gguf'], 'b': ['models/b.gguf'] }
    expect(() => assertIndexTtsManifest(manifest)).not.toThrow()
  })

  it('rejects a missing or mistyped tts-model artifact', () => {
    const missing = createManifest()
    missing.models[0].artifacts['tts-model'] = []
    expect(() => assertIndexTtsManifest(missing)).toThrow('tts-model')

    const mistyped = createManifest()
    mistyped.assets[0].kind = 'weights'
    expect(() => assertIndexTtsManifest(mistyped)).toThrow('tts-model')
  })

  it('rejects a voice without exactly one speaker-reference asset', () => {
    const noFile = createManifest()
    noFile.voices[0].files = []
    expect(() => assertIndexTtsManifest(noFile)).toThrow('american-woman')

    const wrongKind = createManifest()
    wrongKind.assets[1].kind = 'speaker-embedding'
    expect(() => assertIndexTtsManifest(wrongKind)).toThrow('参考音频')

    const tooSmall = createManifest()
    tooSmall.assets[1].size = 12
    expect(() => assertIndexTtsManifest(tooSmall)).toThrow('44 字节')

    const tooLarge = createManifest()
    tooLarge.assets[1].size = 33 * 1024 * 1024
    expect(() => assertIndexTtsManifest(tooLarge)).toThrow('32 MiB')
  })
})

function createManifest(): AIRouterSpeechModelPackageManifest {
  return {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: { id: 'index-tts-2.5-q8_0', version: '0.1.0', name: 'IndexTTS 2.5 Q8_0' },
    runtime: { engine: 'index-tts', engineApiVersion: 1, minimumAppVersion: '0.4.2' },
    assets: [
      {
        path: 'models/index-tts2_5-q8_0.gguf',
        kind: 'tts-model',
        size: 3502955328,
        sha256: 'a'.repeat(64)
      },
      {
        path: 'voices/american-woman.wav',
        kind: 'speaker-reference',
        size: 522284,
        sha256: 'b'.repeat(64)
      }
    ],
    models: [
      {
        id: 'index-tts-2.5-q8_0',
        name: 'IndexTTS 2.5 Q8_0',
        languageCodes: ['en'],
        artifacts: { 'tts-model': ['models/index-tts2_5-q8_0.gguf'] },
        parameters: { load: { threads: 4 }, synthesis: { language: 'en', maxTokens: 1500 } }
      }
    ],
    voices: [{ id: 'american-woman', name: 'American English Woman', files: ['voices/american-woman.wav'] }]
  }
}
