import type { AIRouterSpeechModelPackageManifest } from '../shared'

export const INDEX_TTS_LANGUAGES = ['auto', 'zh', 'en', 'ja', 'es', 'ar'] as const

export type IndexTtsLanguage = (typeof INDEX_TTS_LANGUAGES)[number]

export interface IndexTtsParameters {
  load: {
    threads: number
    device: number
    lowMemory: boolean
  }
  synthesis: {
    language: IndexTtsLanguage
    maxTokens: number
    seed?: number
  }
}

const MIN_REFERENCE_BYTES = 44
const MAX_REFERENCE_BYTES = 32 * 1024 * 1024

export function indexTtsParameters(parameters: unknown): IndexTtsParameters {
  const load = recordValue(
    parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>).load
      : undefined
  )
  const synthesis = recordValue(
    parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>).synthesis
      : undefined
  )
  const language = INDEX_TTS_LANGUAGES.find((candidate) => candidate === synthesis.language)
  const seed = integerValue(synthesis.seed, 0, 4294967295)
  return {
    load: {
      threads: integerValue(load.threads, 1, 256) ?? 4,
      device: integerValue(load.device, 0, 31) ?? 0,
      lowMemory: typeof load.lowMemory === 'boolean' ? load.lowMemory : true
    },
    synthesis: {
      language: language ?? 'auto',
      maxTokens: integerValue(synthesis.maxTokens, 1, 8192) ?? 1500,
      ...(seed === undefined ? {} : { seed })
    }
  }
}

export function assertIndexTtsManifest(manifest: AIRouterSpeechModelPackageManifest): void {
  if (manifest.runtime.engine !== 'index-tts') return
  for (const model of manifest.models) {
    const artifacts = model.artifacts['tts-model'] ?? []
    if (artifacts.length !== 1) {
      throw new Error(`IndexTTS 模型 ${model.id} 必须恰好包含一个 tts-model 资产`)
    }
    const asset = manifest.assets.find((candidate) => candidate.path === artifacts[0])
    if (!asset || asset.kind !== 'tts-model') {
      throw new Error(`IndexTTS 模型 ${model.id} 的 tts-model 资产缺失或类型不正确`)
    }
    indexTtsParameters(model.parameters)
  }
  for (const voice of manifest.voices) {
    if (voice.files.length !== 1) {
      throw new Error(`IndexTTS 音色 ${voice.id} 必须恰好包含一个参考音频`)
    }
    const asset = manifest.assets.find((candidate) => candidate.path === voice.files[0])
    if (!asset || asset.kind !== 'speaker-reference') {
      throw new Error(`IndexTTS 音色 ${voice.id} 的参考音频缺失或类型不正确`)
    }
    if (asset.size < MIN_REFERENCE_BYTES || asset.size > MAX_REFERENCE_BYTES) {
      throw new Error(`IndexTTS 音色 ${voice.id} 的参考音频大小超出 44 字节到 32 MiB 范围`)
    }
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function integerValue(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : undefined
}
