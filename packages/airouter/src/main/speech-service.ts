import { randomUUID } from 'node:crypto'
import { JsonConfigStorage } from '@ls101/config-store/main'
import type { JsonValue } from '@ls101/config-store/shared'
import {
  createElectronSecretStorage,
  type EncryptedSecretStorage,
  type ScopedSecretStorage
} from '@ls101/secret-store/main'
import { AIRouterSpeechModelStore } from './speech-model-store'
import { transcodeWav } from './speech-audio-transcoder'
import type {
  AIRouterGeneratedAudio,
  AIRouterModelConfig,
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
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
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

  importModelPackage(data: Uint8Array): Promise<AIRouterSpeechModelPackageImportResult> {
    return this.modelStore.importPackage(data)
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
    return config.voices.map(({ id }) => ({ id }))
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
      'wav',
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
          'wav',
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
    format: AIRouterSpeechAudioFormat,
    signal?: AbortSignal,
    apiKey?: string
  ): Promise<AIRouterGeneratedAudio> {
    assertEnabledModel(config, modelId)
    assertEnabledVoice(config, voiceId)
    if (config.kind === 'online') {
      return this.synthesizeOpenAI(config, modelId, voiceId, text, format, signal, apiKey)
    }
    if (!config.modelPackageId || !config.modelPackageVersion) {
      throw new Error('本地语音 Provider 尚未选择模型包')
    }
    if (config.type === 'openai-compatible') throw new Error('在线 Provider 配置无效')
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
      format,
      signal,
      resolveAssetPath: (assetPath) =>
        this.modelStore.resolveAssetFilePath(
          config.modelPackageId as string,
          config.modelPackageVersion as string,
          assetPath
        )
    })
  }

  private async synthesizeOpenAI(
    config: AIRouterSpeechProviderConfig,
    modelId: string,
    voiceId: string,
    text: string,
    format: AIRouterSpeechAudioFormat,
    signal?: AbortSignal,
    apiKey?: string
  ): Promise<AIRouterGeneratedAudio> {
    const resolvedApiKey = apiKey ?? (await this.secretScope().read(config.id))
    const responseFormat = format === 'pcm-s16le' ? 'pcm' : format
    const response = await fetch(`${config.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${resolvedApiKey ?? ''}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        input: text,
        voice: voiceId,
        response_format: responseFormat
      }),
      signal
    })
    if (!response.ok) throw new Error(await providerError(response, '语音合成请求失败'))
    const data = new Uint8Array(await response.arrayBuffer())
    if (!data.byteLength || data.byteLength > MAX_AUDIO_BYTES) {
      throw new Error('语音合成结果大小无效')
    }
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0] || mediaTypeFor(format)
    if (!mediaType.startsWith('audio/')) throw new Error('语音合成结果不是音频')
    return { data, mediaType, format }
  }

  private async resolveTransientConfig(
    input: AIRouterSpeechProviderConfigInput
  ): Promise<AIRouterSpeechProviderConfig> {
    assertProviderConfigInput(input)
    const id = input.id?.trim() || 'preview'
    validateConfigId(id)
    const config = await this.normalizeConfig({ ...input, id })
    if (config.kind === 'online' && input.id && input.apiKey === undefined && !input.clearApiKey) {
      if ((await this.secretScope().read(id)) !== null) return config
    }
    return config
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
    if (input.kind === 'online' && input.type !== 'openai-compatible') {
      throw new Error('在线语音 Provider 类型无效')
    }
    if (input.kind === 'local' && input.type === 'openai-compatible') {
      throw new Error('离线语音 Provider 类型无效')
    }
    if (input.kind === 'online') {
      const baseUrl = (input.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '')
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
      voices: modelPackageId ? voices : []
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
    return value
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
  if (
    candidate.type !== 'openai-compatible' &&
    candidate.type !== 'pocket-tts' &&
    candidate.type !== 'qwen-tts'
  ) {
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
      normalized.push({ id, enabled: Boolean(voice.enabled) })
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
    (candidate.type === 'openai-compatible' ||
      candidate.type === 'pocket-tts' ||
      candidate.type === 'qwen-tts') &&
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
    )
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

function mediaTypeFor(format: AIRouterSpeechAudioFormat): string {
  if (format === 'wav') return 'audio/wav'
  if (format === 'mp3') return 'audio/mpeg'
  if (format === 'opus') return 'audio/opus'
  return 'audio/pcm'
}

async function providerError(response: Response, fallback: string): Promise<string> {
  const body = await response.text().catch(() => '')
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown } }
      if (typeof parsed.error?.message === 'string') return parsed.error.message
    } catch {
      return `${fallback}（HTTP ${response.status}）`
    }
  }
  return `${fallback}（HTTP ${response.status}）`
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
