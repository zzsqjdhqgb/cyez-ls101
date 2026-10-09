import type { AIRouterSpeechModelPackageManifest } from '../shared'

export const INDEX_TTS_LANGUAGES = ['auto', 'zh', 'en', 'ja', 'es', 'ar'] as const

export interface IndexTtsParameters {
  threads: number
  device: number
  lowMemory: boolean
  language: string
  maxTokens: number
  seed?: number
}

export function indexTtsParameters(parameters: Record<string, unknown>): IndexTtsParameters {
  const load = object(parameters.load)
  const synthesis = object(parameters.synthesis)
  const language = synthesis.language ?? 'auto'
  if (!INDEX_TTS_LANGUAGES.includes(language as (typeof INDEX_TTS_LANGUAGES)[number])) {
    throw new Error('IndexTTS 语言必须为 auto、zh、en、ja、es 或 ar')
  }
  if (load.lowMemory !== undefined && typeof load.lowMemory !== 'boolean') {
    throw new Error('IndexTTS lowMemory 必须是布尔值')
  }
  return {
    threads: integer(load.threads, 4, 1, 256, 'threads'),
    device: integer(load.device, 0, 0, 31, 'device'),
    lowMemory: load.lowMemory ?? true,
    language: language as string,
    maxTokens: integer(synthesis.maxTokens, 1500, 1, 8192, 'maxTokens'),
    ...(synthesis.seed === undefined
      ? {}
      : { seed: integer(synthesis.seed, 0, 0, 0xffffffff, 'seed') })
  }
}

export function assertIndexTtsManifest(manifest: AIRouterSpeechModelPackageManifest): void {
  if (manifest.runtime.engine !== 'index-tts') return
  const assets = new Map(manifest.assets.map((asset) => [asset.path, asset]))
  for (const model of manifest.models) {
    const files = model.artifacts['tts-model']
    if (files?.length !== 1 || assets.get(files[0])?.kind !== 'tts-model') {
      throw new Error('IndexTTS 模型必须引用一份 tts-model GGUF 资产')
    }
    indexTtsParameters(model.parameters)
  }
  for (const voice of manifest.voices) {
    if (voice.files.length !== 1 || assets.get(voice.files[0])?.kind !== 'speaker-reference') {
      throw new Error('IndexTTS 音色必须引用一份 speaker-reference WAV 资产')
    }
    const size = assets.get(voice.files[0])!.size
    if (size < 44 || size > 32 * 1024 * 1024) {
      throw new Error('IndexTTS 参考音频大小超过限制')
    }
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('IndexTTS 参数必须是对象')
  }
  return value as Record<string, unknown>
}

function integer(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`IndexTTS ${name} 必须是 ${min} 到 ${max} 的整数`)
  }
  return value
}
