import { randomUUID } from 'node:crypto'
import { createElevenLabs } from '@ai-sdk/elevenlabs'
import { createOpenAI } from '@ai-sdk/openai'
import { generateSpeech, NoSpeechGeneratedError, type SpeechModel, type SpeechResult } from 'ai'
import { JsonConfigStorage } from '@ls101/config-store/main'
import type { JsonValue } from '@ls101/config-store/shared'
import {
  createElectronSecretStorage,
  type EncryptedSecretStorage,
  type ScopedSecretStorage
} from '@ls101/secret-store/main'
import { AIRouterSpeechModelStore } from './speech-model-store'
import { transcodeWav } from './speech-audio-transcoder'
import {
  DEFAULT_SPEECH_PROVIDER_BASE_URLS,
  isLocalSpeechProviderType,
  isOnlineSpeechProviderType
} from '../shared'
import type {
  AIRouterGeneratedAudio,
  AIRouterModelConfig,
  AIRouterOnlineSpeechProviderType,
  AIRouterSpeechConnectionTestInput,
  AIRouterSpeechModelOption,
  AIRouterSpeechModelPackageImportResult,
  AIRouterSpeechModelPackageManifest,
  AIRouterSpeechModelPackageSummary,
  AIRouterSpeechProviderConfig,
  AIRouterSpeechProviderConfigInput,
  AIRouterSpeechProviderConfigSummary,
  AIRouterSpeechProviderType,
  AIRouterSpeechRole,
  AIRouterSpeechRouting,
  AIRouterSpeechSegment,
  AIRouterSpeechSynthesisRequest,
  AIRouterSpeechTarget,
  AIRouterSpeechTestResult,
  AIRouterSpeechVoiceListInput,
  AIRouterSpeechVoiceOption,
  AIRouterSpeechAudioFormat
} from '../shared'

const CONFIG_VERSION = 1
const CONFIG_KEY = 'speech-providers'
const ELEVENLABS_OUTPUT_FORMAT = 'pcm_24000'
const ELEVENLABS_SAMPLE_RATE = 24000
const ELEVENLABS_API_PATH = '/v1'
const MINIMAX_TTS_PATH = '/v1/t2a_v2'
const MINIMAX_VOICE_PATH = '/v1/get_voice'
const MINIMAX_AUDIO_FORMAT = 'pcm'
const MINIMAX_SAMPLE_RATE = 24000
// MiniMax t2a_v2 单请求文本上限（官方规范："Must be less than 10,000 characters"）。
const MINIMAX_MAX_TEXT_LENGTH = 10_000
// MiniMax 的 RPM 限额远小于其他 Provider。限流错误（HTTP 429 或 base_resp 的
// 1002/1039）不立刻向上层传递，而是在服务内部等待后自动重试，避免上层的
// 立即重试把配额烧光。
const MINIMAX_RATE_LIMIT_HTTP_STATUS = 429
const MINIMAX_RATE_LIMIT_STATUS_CODES = [1002, 1039]
const MINIMAX_RATE_LIMIT_RETRY_DELAY_MS = 10_000
const MINIMAX_RATE_LIMIT_RETRY_WINDOW_MS = 90_000
// MiniMax 没有模型列举接口，这里固定 T2A 请求体允许的全部模型。
const MINIMAX_TEXT_TO_SPEECH_MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo'
]
const MAX_AUDIO_BYTES = 100 * 1024 * 1024
const validConfigId = /^[a-zA-Z0-9_-]+$/

interface StoredDocument {
  version: number
  providers: AIRouterSpeechProviderConfig[]
}

export interface AIRouterLocalSpeechRequest {
  provider: AIRouterSpeechProviderConfig
  manifest: AIRouterSpeechModelPackageManifest
  modelId: string
  voiceId: string
  text: string
  format: AIRouterSpeechAudioFormat
  signal?: AbortSignal
  resolveAssetPath: (assetPath: string) => Promise<string>
}

export interface AIRouterLocalSpeechSynthesizer {
  synthesize(request: AIRouterLocalSpeechRequest): Promise<AIRouterGeneratedAudio>
}

// 在线语音 Provider 的统一适配器。apiKey 由调用方（synthesizeSingle / listModels /
// listVoices）解析一次后传入，适配器实现不再各自读取 secret store，因此都是
// 不依赖 this 的纯函数。listModels / listVoices 缺省时由调用方回退
// （listVoices 无远端发现时回 config.voices 的 id 列表）。
interface OnlineSpeechProviderAdapter {
  listModels?(
    config: AIRouterSpeechProviderConfig,
    apiKey: string
  ): Promise<AIRouterSpeechModelOption[]>
  listVoices?(
    config: AIRouterSpeechProviderConfig,
    apiKey: string
  ): Promise<AIRouterSpeechVoiceOption[]>
  synthesize(
    config: AIRouterSpeechProviderConfig,
    modelId: string,
    voiceId: string,
    text: string,
    signal: AbortSignal | undefined,
    apiKey: string
  ): Promise<AIRouterGeneratedAudio>
}

export interface AIRouterSpeechServiceOptions {
  baseDir: string
  appVersion?: string
  configStorage?: JsonConfigStorage
  secretStorage?: EncryptedSecretStorage
  modelStore?: AIRouterSpeechModelStore
  localSynthesizers?: Partial<Record<AIRouterSpeechProviderType, AIRouterLocalSpeechSynthesizer>>
}

export class AIRouterSpeechService {
  private readonly configStorage: JsonConfigStorage
  private readonly secretStorage: EncryptedSecretStorage
  private readonly modelStore: AIRouterSpeechModelStore
  private readonly localSynthesizers: Partial<
    Record<AIRouterSpeechProviderType, AIRouterLocalSpeechSynthesizer>
  >

  constructor(options: AIRouterSpeechServiceOptions) {
    this.configStorage = options.configStorage ?? new JsonConfigStorage(options.baseDir)
    this.secretStorage = options.secretStorage ?? createElectronSecretStorage(options.baseDir)
    this.modelStore =
      options.modelStore ??
      new AIRouterSpeechModelStore({ baseDir: options.baseDir, appVersion: options.appVersion })
    this.localSynthesizers = options.localSynthesizers ?? {}
  }

  listModelPackages(
    providerType?: AIRouterSpeechProviderType
  ): Promise<AIRouterSpeechModelPackageSummary[]> {
    return this.modelStore.listPackages(providerType)
  }

  importModelPackage(filePath: string): Promise<AIRouterSpeechModelPackageImportResult> {
    return this.modelStore.importPackage(filePath)
  }

  deleteModelPackage(id: string, version: string): Promise<void> {
    return this.modelStore.deletePackage(id, version)
  }

  async listProviderConfigs(): Promise<AIRouterSpeechProviderConfigSummary[]> {
    const document = await this.readDocument()
    return Promise.all(document.providers.map((config) => this.summary(config)))
  }

  async saveProviderConfig(
    input: AIRouterSpeechProviderConfigInput
  ): Promise<AIRouterSpeechProviderConfigSummary> {
    assertProviderConfigInput(input)
    const document = await this.readDocument()
    const id = input.id?.trim() || randomUUID()
    validateConfigId(id)
    const config = await this.normalizeConfig({ ...input, id })
    const providers = document.providers.some((candidate) => candidate.id === id)
      ? document.providers.map((candidate) => (candidate.id === id ? config : candidate))
      : [...document.providers, config]

    await this.writeDocument({ version: CONFIG_VERSION, providers })
    if (config.kind === 'local' || input.clearApiKey) await this.secretScope().delete(id)
    else if (input.apiKey !== undefined) await this.secretScope().write(id, input.apiKey)
    return this.summary(config)
  }

  async deleteProviderConfig(id: string): Promise<void> {
    validateConfigId(id)
    const document = await this.readDocument()
    await this.writeDocument({
      version: CONFIG_VERSION,
      providers: document.providers.filter((config) => config.id !== id)
    })
    await this.secretScope().delete(id)
  }

  async readProviderApiKey(id: string): Promise<string | null> {
    validateConfigId(id)
    const config = await this.requireConfig(id)
    if (config.kind === 'local') return null
    return this.secretScope().read(id)
  }

  async listModels(input: AIRouterSpeechProviderConfigInput): Promise<AIRouterSpeechModelOption[]> {
    const config = await this.resolveTransientConfig(input)
    if (config.kind === 'local') {
      if (!config.modelPackageId || !config.modelPackageVersion) return []
      const manifest = await this.modelStore.getPackage(
        config.modelPackageId,
        config.modelPackageVersion
      )
      return manifest.models.map(({ id, name, languageCodes }) => ({ id, name, languageCodes }))
    }

    const apiKey = await this.resolveApiKey(input, config.id)
    const adapter = onlineSpeechAdapter(config)
    return adapter.listModels ? adapter.listModels(config, apiKey) : []
  }

  async listVoices(request: AIRouterSpeechVoiceListInput): Promise<AIRouterSpeechVoiceOption[]> {
    const config = await this.resolveTransientConfig(request.config)
    if (config.kind === 'local') {
      if (!config.modelPackageId || !config.modelPackageVersion) return []
      const manifest = await this.modelStore.getPackage(
        config.modelPackageId,
        config.modelPackageVersion
      )
      assertModel(manifest, request.modelId)
      return manifest.voices.map(({ id, name, languageCodes }) => ({ id, name, languageCodes }))
    }
    const adapter = onlineSpeechAdapter(config)
    if (!adapter.listVoices) return config.voices.map(({ id }) => ({ id }))
    const apiKey = await this.resolveApiKey(request.config, config.id)
    return adapter.listVoices(config, apiKey)
  }

  async testConnection(
    request: AIRouterSpeechConnectionTestInput
  ): Promise<AIRouterSpeechTestResult> {
    if (!request || typeof request.modelId !== 'string' || !request.modelId.trim()) {
      throw new Error('语音模型 ID 不能为空')
    }
    const config = await this.resolveTransientConfig(request.config)
    const voiceId = request.voiceId || config.voices.find((voice) => voice.enabled)?.id
    if (!voiceId) throw new Error('语音音色不能为空')
    const apiKey =
      config.kind === 'online' ? await this.resolveApiKey(request.config, config.id) : undefined
    const audio = await this.synthesizeSingle(
      config,
      request.modelId,
      voiceId,
      'This is a voice synthesis connection test.',
      undefined,
      apiKey
    )
    return { ok: true, audio }
  }

  async synthesizeSpeech(
    request: AIRouterSpeechSynthesisRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<AIRouterGeneratedAudio> {
    validateSynthesisRequest(request)
    const format = request.format ?? 'wav'
    const segments = mergeSegments(resolveSegments(request.text))
    const outputs: AIRouterGeneratedAudio[] = []
    for (const segment of segments) {
      if (options.signal?.aborted)
        throw new DOMException('Speech synthesis was aborted', 'AbortError')
      const target = targetForRole(segment.role, request.routing)
      const config = await this.requireConfig(target.providerConfigId)
      outputs.push(
        await this.synthesizeSingle(
          config,
          target.modelId,
          target.voiceId,
          segment.text,
          options.signal
        )
      )
    }
    const audio = concatWav(outputs)
    return format === 'wav' ? audio : transcodeWav(audio, format, options.signal)
  }

  private async synthesizeSingle(
    config: AIRouterSpeechProviderConfig,
    modelId: string,
    voiceId: string,
    text: string,
    signal?: AbortSignal,
    apiKey?: string
  ): Promise<AIRouterGeneratedAudio> {
    assertEnabledModel(config, modelId)
    assertEnabledVoice(config, voiceId)
    if (config.kind === 'online') {
      // 在线 Provider 的 apiKey 统一在此解析一次：调用方传入的 transient key 优先
      //（例如 testConnection 的未保存草稿），否则读取 secret store 里保存的 key。
      // 适配器实现只消费传入的 key，不再各自读取 secret store。
      const resolvedApiKey = apiKey ?? (await this.secretScope().read(config.id)) ?? ''
      return onlineSpeechAdapter(config).synthesize(
        config,
        modelId,
        voiceId,
        text,
        signal,
        resolvedApiKey
      )
    }
    if (!config.modelPackageId || !config.modelPackageVersion) {
      throw new Error('本地语音 Provider 尚未选择模型包')
    }
    if (isOnlineSpeechProviderType(config.type)) throw new Error('在线 Provider 配置无效')
    const synthesizer = this.localSynthesizers[config.type]
    if (!synthesizer) throw new Error(`本地 TTS 运行时尚未实现：${config.type}`)
    const manifest = await this.modelStore.getPackage(
      config.modelPackageId,
      config.modelPackageVersion
    )
    if (manifest.runtime.engine !== config.type) throw new Error('模型包与本地 Provider 类型不匹配')
    assertModel(manifest, modelId)
    assertVoice(manifest, voiceId)
    return synthesizer.synthesize({
      provider: config,
      manifest,
      modelId,
      voiceId,
      text,
      format: 'wav',
      signal,
      resolveAssetPath: (assetPath) =>
        this.modelStore.resolveAssetFilePath(
          config.modelPackageId as string,
          config.modelPackageVersion as string,
          assetPath
        )
    })
  }

  private async resolveTransientConfig(
    input: AIRouterSpeechProviderConfigInput
  ): Promise<AIRouterSpeechProviderConfig> {
    assertProviderConfigInput(input)
    const id = input.id?.trim() || 'preview'
    validateConfigId(id)
    return this.normalizeConfig({ ...input, id })
  }

  private async resolveApiKey(
    input: AIRouterSpeechProviderConfigInput,
    id: string
  ): Promise<string> {
    if (input.clearApiKey) return ''
    if (input.apiKey !== undefined) return input.apiKey
    return (await this.secretScope().read(id)) ?? ''
  }

  private async normalizeConfig(
    input: AIRouterSpeechProviderConfigInput & { id: string }
  ): Promise<AIRouterSpeechProviderConfig> {
    assertProviderConfigInput(input)
    if (typeof input.name !== 'string' || !input.name.trim())
      throw new Error('语音 Provider 名称不能为空')
    if (!Array.isArray(input.models)) throw new Error('语音模型配置必须是数组')
    if (!Array.isArray(input.voices)) throw new Error('语音音色配置必须是数组')
    const models = normalizeModels(input.models)
    const voices = normalizeVoices(input.voices)
    if (input.kind === 'online' && !isOnlineSpeechProviderType(input.type)) {
      throw new Error('在线语音 Provider 类型无效')
    }
    if (input.kind === 'local' && isOnlineSpeechProviderType(input.type)) {
      throw new Error('离线语音 Provider 类型无效')
    }
    if (
      input.type === 'qwen-tts' &&
      input.backend !== undefined &&
      input.backend !== 'cpu' &&
      input.backend !== 'cuda'
    ) {
      throw new Error('Qwen TTS 计算后端无效')
    }
    if (input.kind === 'online') {
      // 上方的 kind/type 交叉校验已保证这里必是在线类型；谓词只用来把类型收窄到
      // 默认 Base URL 表的键上，分支实际不可达。
      if (!isOnlineSpeechProviderType(input.type)) throw new Error('在线语音 Provider 类型无效')
      const baseUrl = (
        input.baseUrl?.trim() || DEFAULT_SPEECH_PROVIDER_BASE_URLS[input.type]
      ).replace(/\/$/, '')
      assertHttpUrl(baseUrl)
      return {
        id: input.id,
        name: input.name.trim(),
        kind: input.kind,
        type: input.type,
        baseUrl,
        modelPackageId: '',
        modelPackageVersion: '',
        models,
        voices
      }
    }

    const modelPackageId = input.modelPackageId?.trim() || ''
    const modelPackageVersion = input.modelPackageVersion?.trim() || ''
    if (modelPackageId || modelPackageVersion) {
      if (!modelPackageId || !modelPackageVersion) throw new Error('本地 Provider 模型包信息不完整')
      const manifest = await this.modelStore.getPackage(modelPackageId, modelPackageVersion)
      if (manifest.runtime.engine !== input.type)
        throw new Error('模型包与本地 Provider 类型不匹配')
      for (const model of models.filter((candidate) => candidate.enabled))
        assertModel(manifest, model.id)
      for (const voice of voices.filter((candidate) => candidate.enabled))
        assertVoice(manifest, voice.id)
    }
    return {
      id: input.id,
      name: input.name.trim(),
      kind: input.kind,
      type: input.type,
      baseUrl: '',
      modelPackageId,
      modelPackageVersion,
      models: modelPackageId ? models : [],
      voices: modelPackageId ? voices : [],
      ...(input.type === 'qwen-tts' ? { backend: 'cpu' as const } : {})
    }
  }

  private async summary(
    config: AIRouterSpeechProviderConfig
  ): Promise<AIRouterSpeechProviderConfigSummary> {
    return {
      ...config,
      models: config.models.map((model) => ({ ...model })),
      voices: config.voices.map((voice) => ({ ...voice })),
      hasApiKey: config.kind === 'online' && (await this.secretScope().read(config.id)) !== null
    }
  }

  private async requireConfig(id: string): Promise<AIRouterSpeechProviderConfig> {
    validateConfigId(id)
    const config = (await this.readDocument()).providers.find((candidate) => candidate.id === id)
    if (!config) throw new Error('语音 Provider 配置不存在')
    return config
  }

  private async readDocument(): Promise<StoredDocument> {
    const value = await this.configStorage.read<JsonValue>({ scope: ['airouter'], key: CONFIG_KEY })
    if (!value) return { version: CONFIG_VERSION, providers: [] }
    if (!isStoredDocument(value)) throw new Error('语音 Provider 配置数据无效')
    const document: StoredDocument = value
    return {
      ...document,
      providers: document.providers.map((config) =>
        config.type === 'qwen-tts' ? { ...config, backend: 'cpu' } : config
      )
    }
  }

  private writeDocument(document: StoredDocument): Promise<void> {
    return this.configStorage.write(
      { scope: ['airouter'], key: CONFIG_KEY },
      document as unknown as JsonValue
    )
  }

  private secretScope(): ScopedSecretStorage {
    return this.secretStorage.scope('airouter').scope('speech-providers')
  }
}

function normalizeModels(models: AIRouterModelConfig[]): AIRouterModelConfig[] {
  const normalized: AIRouterModelConfig[] = []
  for (const model of models) {
    if (!model || typeof model.id !== 'string') continue
    const id = model.id.trim()
    if (id && !normalized.some((candidate) => candidate.id === id)) {
      normalized.push({ id, enabled: Boolean(model.enabled) })
    }
  }
  return normalized
}

function assertProviderConfigInput(
  value: unknown
): asserts value is AIRouterSpeechProviderConfigInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('语音 Provider 配置无效')
  }
  const candidate = value as { kind?: unknown; type?: unknown }
  if (candidate.kind !== 'online' && candidate.kind !== 'local') {
    throw new Error('语音 Provider kind 无效')
  }
  if (!isOnlineSpeechProviderType(candidate.type) && !isLocalSpeechProviderType(candidate.type)) {
    throw new Error('语音 Provider 类型无效')
  }
}

function normalizeVoices(
  voices: AIRouterSpeechProviderConfigInput['voices']
): AIRouterSpeechProviderConfigInput['voices'] {
  const normalized: AIRouterSpeechProviderConfigInput['voices'] = []
  for (const voice of voices) {
    if (!voice || typeof voice.id !== 'string') continue
    const id = voice.id.trim()
    if (id && !normalized.some((candidate) => candidate.id === id)) {
      // 保留远端发现的音色显示名（仅非空字符串时写入；undefined 字段在 JSON
      // 序列化时自然丢弃），旧配置与手动添加的音色不受影响。
      normalized.push({
        id,
        enabled: Boolean(voice.enabled),
        ...(typeof voice.name === 'string' && voice.name ? { name: voice.name } : {})
      })
    }
  }
  return normalized
}

function isStoredDocument(value: JsonValue): value is JsonValue & StoredDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { version?: unknown; providers?: unknown }
  return (
    candidate.version === CONFIG_VERSION &&
    Array.isArray(candidate.providers) &&
    candidate.providers.every(isProviderConfig)
  )
}

function isProviderConfig(value: unknown): value is AIRouterSpeechProviderConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AIRouterSpeechProviderConfig>
  return (
    typeof candidate.id === 'string' &&
    validConfigId.test(candidate.id) &&
    typeof candidate.name === 'string' &&
    (candidate.kind === 'online' || candidate.kind === 'local') &&
    (isOnlineSpeechProviderType(candidate.type) || isLocalSpeechProviderType(candidate.type)) &&
    typeof candidate.baseUrl === 'string' &&
    typeof candidate.modelPackageId === 'string' &&
    typeof candidate.modelPackageVersion === 'string' &&
    Array.isArray(candidate.models) &&
    candidate.models.every(
      (model) =>
        Boolean(model) && typeof model.id === 'string' && typeof model.enabled === 'boolean'
    ) &&
    Array.isArray(candidate.voices) &&
    candidate.voices.every(
      (voice) =>
        Boolean(voice) && typeof voice.id === 'string' && typeof voice.enabled === 'boolean'
    ) &&
    (candidate.backend === undefined || candidate.backend === 'cpu' || candidate.backend === 'cuda')
  )
}

function validateConfigId(id: string): void {
  if (!validConfigId.test(id)) throw new Error('语音 Provider 配置 ID 无效')
}

function assertHttpUrl(value: string): void {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
  } catch {
    throw new Error('Base URL 必须是有效的 HTTP 地址')
  }
}

function assertEnabledModel(config: AIRouterSpeechProviderConfig, modelId: string): void {
  if (!config.models.some((model) => model.id === modelId && model.enabled)) {
    throw new Error('语音模型未配置或未启用')
  }
}

function assertEnabledVoice(config: AIRouterSpeechProviderConfig, voiceId: string): void {
  if (!config.voices.some((voice) => voice.id === voiceId && voice.enabled)) {
    throw new Error('语音音色未配置或未启用')
  }
}

function assertModel(manifest: AIRouterSpeechModelPackageManifest, modelId: string): void {
  if (!manifest.models.some((model) => model.id === modelId))
    throw new Error('模型包中不存在该模型')
}

function assertVoice(manifest: AIRouterSpeechModelPackageManifest, voiceId: string): void {
  if (!manifest.voices.some((voice) => voice.id === voiceId))
    throw new Error('模型包中不存在该音色')
}

function validateSynthesisRequest(request: AIRouterSpeechSynthesisRequest): void {
  if (!request || typeof request.text !== 'string' || !request.text.trim()) {
    throw new Error('语音合成文本不能为空')
  }
  if (!request.routing?.default) throw new Error('语音合成必须配置 default 目标')
  if (request.format && !['wav', 'mp3', 'opus', 'pcm-s16le'].includes(request.format)) {
    throw new Error('不支持的语音输出格式')
  }
}

function resolveSegments(text: string): AIRouterSpeechSegment[] {
  return text
    .split(/\r?\n/)
    .map((line): AIRouterSpeechSegment | null => {
      const match = /^\s*\[(Man|Woman)\]\s*:\s?(.*)$/i.exec(line)
      if (!match) return line.trim() ? { role: 'default', text: line.trim() } : null
      return { role: match[1].toLowerCase() as 'man' | 'woman', text: match[2].trim() }
    })
    .filter((segment): segment is AIRouterSpeechSegment => Boolean(segment?.text))
}

function targetForRole(
  role: AIRouterSpeechRole,
  routing: AIRouterSpeechRouting
): AIRouterSpeechTarget {
  return role === 'default' ? routing.default : routing[role] || routing.default
}

function mergeSegments(segments: AIRouterSpeechSegment[]): AIRouterSpeechSegment[] {
  const merged: AIRouterSpeechSegment[] = []
  for (const segment of segments) {
    const previous = merged.at(-1)
    if (previous?.role === segment.role) previous.text += `\n${segment.text}`
    else merged.push({ ...segment })
  }
  return merged
}

async function providerError(response: Response, fallback: string): Promise<string> {
  const message = readProviderErrorMessage(safeParseJson(await response.text().catch(() => '')))
  return message ?? `${fallback}（HTTP ${response.status}）`
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function toSpeechSynthesisError(error: unknown, signal?: AbortSignal): Error {
  const candidate = error as {
    name?: unknown
    statusCode?: unknown
    responseBody?: unknown
  }
  if (signal?.aborted || candidate?.name === 'AbortError') {
    return new DOMException('Speech synthesis was aborted', 'AbortError')
  }
  if (NoSpeechGeneratedError.isInstance(error)) return new Error('语音合成结果为空')
  const message = readProviderErrorMessage(
    typeof candidate?.responseBody === 'string' ? safeParseJson(candidate.responseBody) : undefined
  )
  if (message) return new Error(message)
  if (typeof candidate?.statusCode === 'number') {
    return new Error(`语音合成请求失败（HTTP ${candidate.statusCode}）`)
  }
  return error instanceof Error ? error : new Error('语音合成请求失败')
}

function assertAudioSize(data: Uint8Array): void {
  if (!data.byteLength || data.byteLength > MAX_AUDIO_BYTES) {
    throw new Error('语音合成结果大小无效')
  }
}

function responseMediaType(result: SpeechResult): string | undefined {
  return result.responses[0]?.headers?.['content-type']?.split(';', 1)[0]?.trim() || undefined
}

// ElevenLabs 的 PCM 响应 content-type 未必是 audio/*（甚至可能缺失），这里只拒绝
// 已知的非 PCM 容器格式，避免把代理误返回的 mp3 等静默包成损坏的 WAV。
const NON_PCM_AUDIO_MEDIA_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/webm'
])

function assertElevenLabsPcmResponse(result: SpeechResult): void {
  const mediaType = responseMediaType(result)
  if (!mediaType) return
  const normalized = mediaType.split(';', 1)[0]?.trim().toLowerCase() || ''
  if (normalized.startsWith('video/') || NON_PCM_AUDIO_MEDIA_TYPES.has(normalized)) {
    throw new Error('语音合成结果不是 PCM 音频')
  }
}

function createElevenLabsFetch(baseUrl: string): typeof fetch {
  const target = baseUrl.replace(/\/$/, '')
  return (input, init) => {
    const source = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    return fetch(`${target}${source.pathname}${source.search}`, init)
  }
}

function readProviderErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = payload as { error?: unknown; detail?: unknown; message?: unknown }
  for (const nested of [value.error, value.detail]) {
    if (typeof nested === 'string') return nested
    if (Array.isArray(nested)) {
      const first = nested[0] as { msg?: unknown; message?: unknown } | undefined
      if (typeof first?.msg === 'string') return first.msg
      if (typeof first?.message === 'string') return first.message
    }
    if (nested && typeof nested === 'object') {
      const message = (nested as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  }
  return typeof value.message === 'string' ? value.message : null
}

function elevenLabsHeaders(apiKey: string | null | undefined): Record<string, string> {
  return apiKey ? { 'xi-api-key': apiKey } : {}
}

function listMinimaxModels(): AIRouterSpeechModelOption[] {
  return MINIMAX_TEXT_TO_SPEECH_MODELS.map((id) => ({ id }))
}

async function listMinimaxVoices(
  config: AIRouterSpeechProviderConfig,
  apiKey: string
): Promise<AIRouterSpeechVoiceOption[]> {
  const response = await fetch(`${config.baseUrl}${MINIMAX_VOICE_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ voice_type: 'all' }),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(await providerError(response, '获取语音音色列表失败'))
  const payload: unknown = await response.json()
  assertMinimaxSuccess(payload, '获取语音音色列表失败')
  const voices = new Map<string, AIRouterSpeechVoiceOption>()
  for (const entry of minimaxVoiceEntries(payload)) {
    if (typeof entry.voice_id !== 'string' || !entry.voice_id || voices.has(entry.voice_id))
      continue
    const name = typeof entry.voice_name === 'string' ? entry.voice_name : undefined
    voices.set(entry.voice_id, { id: entry.voice_id, name })
  }
  return [...voices.values()].sort((left, right) =>
    (left.name ?? left.id).localeCompare(right.name ?? right.id)
  )
}

function minimaxVoiceEntries(payload: unknown): Array<{
  voice_id?: unknown
  voice_name?: unknown
}> {
  if (!payload || typeof payload !== 'object') return []
  const value = payload as Record<string, unknown>
  return ['system_voice', 'voice_cloning', 'voice_generation'].flatMap((key) =>
    Array.isArray(value[key])
      ? (value[key] as Array<{ voice_id?: unknown; voice_name?: unknown }>)
      : []
  )
}

function assertMinimaxSuccess(payload: unknown, fallback: string): void {
  if (!payload || typeof payload !== 'object') throw new Error(fallback)
  const base = (payload as { base_resp?: unknown }).base_resp
  if (base === undefined) return
  if (!base || typeof base !== 'object') throw new Error(fallback)
  const status = (base as { status_code?: unknown }).status_code
  if (status === 0 || status === undefined) return
  const message = (base as { status_msg?: unknown }).status_msg
  const detail = typeof message === 'string' && message ? message : fallback
  if (typeof status === 'number' && isMinimaxRateLimitStatus(status)) {
    throw new MinimaxRateLimitError(`${detail}（${String(status)}）`)
  }
  throw new Error(`${detail}（${String(status)}）`)
}

function readMinimaxHexAudio(payload: unknown): Uint8Array {
  const audioFormat = readMinimaxExtraInfoValue(payload, 'audio_format')
  if (audioFormat !== undefined && audioFormat !== MINIMAX_AUDIO_FORMAT) {
    throw new Error('语音合成结果不是 PCM 音频')
  }
  const data = (payload as { data?: unknown } | null)?.data
  const audio = data && typeof data === 'object' ? (data as { audio?: unknown }).audio : undefined
  if (typeof audio !== 'string' || !audio || audio.length % 2 !== 0) {
    throw new Error('语音合成结果缺少有效音频数据')
  }
  // hex 每 2 个字符解码为 1 字节：先做廉价长度预检，避免超大响应先被
  // 全串正则与完整解码之后才被拒。
  if (audio.length > MAX_AUDIO_BYTES * 2) {
    throw new Error('语音合成结果大小无效')
  }
  if (!/^[0-9a-fA-F]+$/.test(audio)) {
    throw new Error('语音合成结果缺少有效音频数据')
  }
  return new Uint8Array(Buffer.from(audio, 'hex'))
}

function readMinimaxExtraInfoValue(payload: unknown, key: string): unknown {
  const extra = (payload as { extra_info?: unknown } | null)?.extra_info
  if (!extra || typeof extra !== 'object') return undefined
  return (extra as Record<string, unknown>)[key]
}

function readMinimaxNumber(payload: unknown, key: string): number | undefined {
  const value = readMinimaxExtraInfoValue(payload, key)
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

class MinimaxRateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MinimaxRateLimitError'
  }
}

function isMinimaxRateLimitStatus(statusCode: number): boolean {
  return MINIMAX_RATE_LIMIT_STATUS_CODES.includes(statusCode)
}

interface MinimaxSpeechRequest {
  baseUrl: string
  apiKey: string
  modelId: string
  voiceId: string
  text: string
  signal?: AbortSignal
}

async function fetchMinimaxSpeechOnce(request: MinimaxSpeechRequest): Promise<unknown> {
  const response = await fetch(`${request.baseUrl}${MINIMAX_TTS_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${request.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: request.modelId,
      text: request.text,
      stream: false,
      output_format: 'hex',
      voice_setting: { voice_id: request.voiceId },
      audio_setting: {
        format: MINIMAX_AUDIO_FORMAT,
        sample_rate: MINIMAX_SAMPLE_RATE,
        channel: 1
      }
    }),
    signal: request.signal
  })
  if (!response.ok) {
    const message = await providerError(response, '语音合成请求失败')
    if (response.status === MINIMAX_RATE_LIMIT_HTTP_STATUS) throw new MinimaxRateLimitError(message)
    throw new Error(message)
  }
  const payload: unknown = await response.json()
  assertMinimaxSuccess(payload, '语音合成请求失败')
  return payload
}

// MiniMax 的 RPM 限额很小，而上层（模板生成）的重试循环是立即重试的。限流时这里
// 隐藏错误并等待 10 秒后重试；自首次限流响应起 90 秒内仍未恢复，才停止重试并把
// 最后一次限流错误传递给上层。等待期间照常响应取消信号。
async function requestMinimaxSpeechPayload(request: MinimaxSpeechRequest): Promise<unknown> {
  let retryDeadline: number | undefined
  for (;;) {
    try {
      return await fetchMinimaxSpeechOnce(request)
    } catch (error) {
      if (!(error instanceof MinimaxRateLimitError)) throw error
      const now = Date.now()
      retryDeadline ??= now + MINIMAX_RATE_LIMIT_RETRY_WINDOW_MS
      if (now + MINIMAX_RATE_LIMIT_RETRY_DELAY_MS > retryDeadline) throw error
      await sleepForDuration(MINIMAX_RATE_LIMIT_RETRY_DELAY_MS, request.signal)
    }
  }
}

function sleepForDuration(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Speech synthesis was aborted', 'AbortError'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Speech synthesis was aborted', 'AbortError'))
    }
    const timer = setTimeout((): void => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function listElevenLabsModels(
  config: AIRouterSpeechProviderConfig,
  apiKey: string
): Promise<AIRouterSpeechModelOption[]> {
  const response = await fetch(`${config.baseUrl}${ELEVENLABS_API_PATH}/models`, {
    headers: elevenLabsHeaders(apiKey),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(await providerError(response, '获取语音模型列表失败'))
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) return []
  return payload
    .map((item): AIRouterSpeechModelOption | null => {
      if (!item || typeof item !== 'object') return null
      const value = item as { model_id?: unknown; name?: unknown; can_do_text_to_speech?: unknown }
      if (value.can_do_text_to_speech === false) return null
      return typeof value.model_id === 'string'
        ? { id: value.model_id, name: typeof value.name === 'string' ? value.name : undefined }
        : null
    })
    .filter((model): model is AIRouterSpeechModelOption => model !== null)
    .sort((left, right) => left.id.localeCompare(right.id))
}

async function listElevenLabsVoices(
  config: AIRouterSpeechProviderConfig,
  apiKey: string
): Promise<AIRouterSpeechVoiceOption[]> {
  const response = await fetch(`${config.baseUrl}${ELEVENLABS_API_PATH}/voices`, {
    headers: elevenLabsHeaders(apiKey),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(await providerError(response, '获取语音音色列表失败'))
  const payload = (await response.json()) as { voices?: unknown }
  if (!Array.isArray(payload?.voices)) return []
  return payload.voices
    .map((item): AIRouterSpeechVoiceOption | null => {
      if (!item || typeof item !== 'object') return null
      const value = item as { voice_id?: unknown; name?: unknown }
      return typeof value.voice_id === 'string'
        ? { id: value.voice_id, name: typeof value.name === 'string' ? value.name : undefined }
        : null
    })
    .filter((voice): voice is AIRouterSpeechVoiceOption => voice !== null)
    .sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id))
}

// ─────────────────────────────────────────────────────────────────────────────
// 在线 Provider 适配器：apiKey 一律由调用方（synthesizeSingle / listModels /
// listVoices）解析后传入，实现不读取 secret store，因此都是纯函数。
// ─────────────────────────────────────────────────────────────────────────────

async function generateOnlineSpeech(
  model: SpeechModel,
  options: {
    text: string
    voiceId: string
    outputFormat: string
    signal?: AbortSignal
  }
): Promise<SpeechResult> {
  try {
    return await generateSpeech({
      model,
      text: options.text,
      voice: options.voiceId,
      outputFormat: options.outputFormat,
      // 语音合成的重试和续跑由上层业务流程负责，单次调用不再叠加 SDK 重试。
      maxRetries: 0,
      abortSignal: options.signal
    })
  } catch (error) {
    throw toSpeechSynthesisError(error, options.signal)
  }
}

async function synthesizeOpenAISpeech(
  config: AIRouterSpeechProviderConfig,
  modelId: string,
  voiceId: string,
  text: string,
  signal: AbortSignal | undefined,
  apiKey: string
): Promise<AIRouterGeneratedAudio> {
  const result = await generateOnlineSpeech(
    createOpenAI({ apiKey, baseURL: config.baseUrl }).speech(modelId),
    { text, voiceId, outputFormat: 'wav', signal }
  )
  const data = new Uint8Array(result.audio.uint8Array)
  assertAudioSize(data)
  const mediaType = responseMediaType(result) ?? 'audio/wav'
  if (!mediaType.startsWith('audio/')) throw new Error('语音合成结果不是音频')
  return { data, mediaType, format: 'wav' }
}

async function synthesizeElevenLabsSpeech(
  config: AIRouterSpeechProviderConfig,
  modelId: string,
  voiceId: string,
  text: string,
  signal: AbortSignal | undefined,
  apiKey: string
): Promise<AIRouterGeneratedAudio> {
  const result = await generateOnlineSpeech(
    createElevenLabs({
      apiKey,
      fetch: createElevenLabsFetch(config.baseUrl)
    }).speech(modelId),
    {
      text,
      // SDK 会把 voiceId 裸插值进 /v1/text-to-speech/<voiceId> 的 URL 路径，
      // 这里先做百分号编码，避免 '#'、'/' 等字符静默改写请求语义。
      voiceId: encodeURIComponent(voiceId),
      outputFormat: ELEVENLABS_OUTPUT_FORMAT,
      signal
    }
  )
  assertElevenLabsPcmResponse(result)
  const pcm = new Uint8Array(result.audio.uint8Array)
  assertAudioSize(pcm)
  return wrapPcm16AsWav(pcm, ELEVENLABS_SAMPLE_RATE, 1)
}

async function synthesizeMinimaxSpeech(
  config: AIRouterSpeechProviderConfig,
  modelId: string,
  voiceId: string,
  text: string,
  signal: AbortSignal | undefined,
  apiKey: string
): Promise<AIRouterGeneratedAudio> {
  // t2a_v2 的官方上限是单请求 10000 字符；上层 mergeSegments 会无限合并同角色
  // 相邻行，超限必须在发起网络请求前拦下（该错误也不属于限流，不会触发内部重试）。
  if (text.length > MINIMAX_MAX_TEXT_LENGTH) {
    throw new Error(
      `语音合成文本超过 MiniMax 单次请求的 10000 字符上限（当前 ${text.length} 字符）`
    )
  }
  const payload = await requestMinimaxSpeechPayload({
    baseUrl: config.baseUrl,
    apiKey,
    modelId,
    voiceId,
    text,
    signal
  })
  const audio = readMinimaxHexAudio(payload)
  assertAudioSize(audio)
  const sampleRate = readMinimaxNumber(payload, 'audio_sample_rate') ?? MINIMAX_SAMPLE_RATE
  const channels = readMinimaxNumber(payload, 'audio_channel') ?? 1
  return wrapPcm16AsWav(audio, sampleRate, channels)
}

// 合并 ElevenLabs 与 MiniMax 重复的 PCM→WAV 包装尾段：截齐偶数字节、写 WAV 头、
// 按采样率与声道数计算时长。
function wrapPcm16AsWav(
  pcm: Uint8Array,
  sampleRate: number,
  channels: number
): AIRouterGeneratedAudio {
  const samples = pcm.subarray(0, pcm.byteLength - (pcm.byteLength % 2))
  return {
    data: encodeWavPcm16(samples, sampleRate, channels),
    mediaType: 'audio/wav',
    format: 'wav',
    sampleRate,
    channels,
    durationMs: (samples.byteLength / (channels * 2) / sampleRate) * 1000
  }
}

async function listOpenAICompatibleModels(
  config: AIRouterSpeechProviderConfig,
  apiKey: string
): Promise<AIRouterSpeechModelOption[]> {
  const response = await fetch(`${config.baseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`获取语音模型列表失败（HTTP ${response.status}）`)
  const payload = (await response.json()) as { data?: unknown }
  if (!Array.isArray(payload.data)) return []
  return payload.data
    .map((item): AIRouterSpeechModelOption | null => {
      if (typeof item === 'string') return { id: item }
      if (!item || typeof item !== 'object') return null
      const value = item as { id?: unknown; name?: unknown }
      return typeof value.id === 'string'
        ? { id: value.id, name: typeof value.name === 'string' ? value.name : undefined }
        : null
    })
    .filter((model): model is AIRouterSpeechModelOption => model !== null)
    .sort((left, right) => left.id.localeCompare(right.id))
}

// 在线 Provider 的统一分发入口。normalizeConfig 已保证 kind === 'online' 的配置
// 必是在线类型；这里再用谓词收窄到 adapter 表的键上，手改 JSON 导致 kind/type
// 不一致的存量配置会在分发前被拒绝，而不是被静默路由到 OpenAI 兼容实现。
function onlineSpeechAdapter(config: AIRouterSpeechProviderConfig): OnlineSpeechProviderAdapter {
  if (!isOnlineSpeechProviderType(config.type)) throw new Error('在线 Provider 配置无效')
  return onlineSpeechAdapters[config.type]
}

// minimax 与 minimax-cn 只有默认 Base URL 不同（见 DEFAULT_SPEECH_PROVIDER_BASE_URLS），
// 协议实现完全一致，共用同一个 adapter。
const minimaxSpeechAdapter: OnlineSpeechProviderAdapter = {
  // MiniMax 没有模型列举接口，返回内置的 T2A 模型清单，不发起网络请求。
  listModels: async () => listMinimaxModels(),
  listVoices: listMinimaxVoices,
  synthesize: synthesizeMinimaxSpeech
}

// 在线 Provider 分发表：新增 Provider 类型只需要在 shared 常量里加类型，再在这里
// 补一个 adapter 条目（Record 的键完整性检查会强制补齐，漏配直接编译失败）。
const onlineSpeechAdapters: Record<AIRouterOnlineSpeechProviderType, OnlineSpeechProviderAdapter> =
  {
    'openai-compatible': {
      // openai-compatible 没有 Voice 枚举端点，listVoices 缺省回 config.voices 的 id。
      listModels: listOpenAICompatibleModels,
      synthesize: synthesizeOpenAISpeech
    },
    elevenlabs: {
      listModels: listElevenLabsModels,
      listVoices: listElevenLabsVoices,
      synthesize: synthesizeElevenLabsSpeech
    },
    minimax: minimaxSpeechAdapter,
    'minimax-cn': minimaxSpeechAdapter
  }

function concatWav(outputs: AIRouterGeneratedAudio[]): AIRouterGeneratedAudio {
  if (outputs.length === 1) return outputs[0]
  const decoded = outputs.map(decodeWav)
  const first = decoded[0]
  if (
    decoded.some(
      (audio) => audio.sampleRate !== first.sampleRate || audio.channels !== first.channels
    )
  ) {
    throw new Error('语音片段的采样率或声道数不一致')
  }
  const data = new Uint8Array(decoded.reduce((total, audio) => total + audio.data.byteLength, 0))
  let offset = 0
  for (const audio of decoded) {
    data.set(audio.data, offset)
    offset += audio.data.byteLength
  }
  return {
    data: encodeWavPcm16(data, first.sampleRate, first.channels),
    mediaType: 'audio/wav',
    format: 'wav',
    sampleRate: first.sampleRate,
    channels: first.channels,
    durationMs: decoded.reduce((total, audio) => total + audio.durationMs, 0)
  }
}

function decodeWav(data: AIRouterGeneratedAudio): {
  data: Uint8Array
  sampleRate: number
  channels: number
  durationMs: number
} {
  if (
    data.data.byteLength < 44 ||
    readAscii(data.data, 0, 4) !== 'RIFF' ||
    readAscii(data.data, 8, 4) !== 'WAVE'
  ) {
    throw new Error('多个语音片段拼接要求每个结果都是 PCM WAV')
  }
  const view = new DataView(data.data.buffer, data.data.byteOffset, data.data.byteLength)
  let sampleRate = 0
  let channels = 0
  let bits = 0
  let audioData: Uint8Array | null = null
  let offset = 12
  while (offset + 8 <= data.data.byteLength) {
    const chunkId = readAscii(data.data, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (chunkStart + chunkSize > data.data.byteLength) break
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error('WAV fmt 区块无效')
      if (view.getUint16(chunkStart, true) !== 1) throw new Error('只支持 PCM WAV 拼接')
      channels = view.getUint16(chunkStart + 2, true)
      sampleRate = view.getUint32(chunkStart + 4, true)
      bits = view.getUint16(chunkStart + 14, true)
    } else if (chunkId === 'data') {
      audioData = data.data.slice(chunkStart, chunkStart + chunkSize)
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  if (!audioData || !sampleRate || !channels || bits !== 16) throw new Error('WAV 音频格式不支持')
  return {
    data: audioData,
    sampleRate,
    channels,
    durationMs: (audioData.byteLength / (channels * 2) / sampleRate) * 1000
  }
}

function encodeWavPcm16(data: Uint8Array, sampleRate: number, channels: number): Uint8Array {
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
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, data.byteLength, true)
  new Uint8Array(buffer, 44).set(data)
  return new Uint8Array(buffer)
}

function readAscii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length))
}
