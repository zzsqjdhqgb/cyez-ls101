import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { Worker } from 'node:worker_threads'
import { JsonConfigStorage } from '@ls101/config-store/main'
import type { JsonValue } from '@ls101/config-store/shared'
import {
  createElectronSecretStorage,
  type EncryptedSecretStorage,
  type ScopedSecretStorage
} from '@ls101/secret-store/main'
import type {
  AIRouterModelConfig,
  AIRouterSpeechRecognitionModelOption,
  AIRouterSpeechRecognitionModelPackageImportResult,
  AIRouterSpeechRecognitionModelPackageSummary,
  AIRouterSpeechRecognitionProviderConfig,
  AIRouterSpeechRecognitionProviderConfigInput,
  AIRouterSpeechRecognitionProviderConfigSummary,
  AIRouterSpeechRecognitionProviderType,
  AIRouterSpeechRecognitionRequest,
  AIRouterSpeechRecognitionResult
} from '../shared'
import { AIRouterSpeechRecognitionModelStore } from './speech-model-store'

const CONFIG_VERSION = 1
const CONFIG_KEY = 'speech-recognition-providers'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MAX_AUDIO_BYTES = 100 * 1024 * 1024
const validConfigId = /^[a-zA-Z0-9_-]+$/
const require = createRequire(import.meta.url)

interface StoredDocument {
  version: number
  providers: AIRouterSpeechRecognitionProviderConfig[]
}

interface PendingRequest {
  resolve(result: AIRouterSpeechRecognitionResult): void
  reject(reason: unknown): void
  signal?: AbortSignal
  abort(): void
}

interface WorkerState {
  key: string
  worker: Worker
  pending: Map<string, PendingRequest>
  ready: Promise<void>
}

interface Qwen3AsrAssets {
  convFrontend: string
  encoder: string
  decoder: string
  tokenizer: Array<{ name: string; path: string }>
  vad: string
}

export interface AIRouterSpeechRecognitionServiceOptions {
  baseDir: string
  appVersion?: string
  configStorage?: JsonConfigStorage
  secretStorage?: EncryptedSecretStorage
  modelStore?: AIRouterSpeechRecognitionModelStore
  workerUrl?: URL
  ffmpegPath?: string
}

export class AIRouterSpeechRecognitionService {
  private readonly configStorage: JsonConfigStorage
  private readonly secretStorage: EncryptedSecretStorage
  private readonly modelStore: AIRouterSpeechRecognitionModelStore
  private statePromise: Promise<WorkerState> | null = null
  private activeState: WorkerState | null = null

  constructor(private readonly options: AIRouterSpeechRecognitionServiceOptions) {
    this.configStorage = options.configStorage ?? new JsonConfigStorage(options.baseDir)
    this.secretStorage = options.secretStorage ?? createElectronSecretStorage(options.baseDir)
    this.modelStore =
      options.modelStore ??
      new AIRouterSpeechRecognitionModelStore({
        baseDir: options.baseDir,
        appVersion: options.appVersion
      })
  }

  async listProviderConfigs(): Promise<AIRouterSpeechRecognitionProviderConfigSummary[]> {
    return Promise.all((await this.readDocument()).providers.map((config) => this.summary(config)))
  }

  async saveProviderConfig(
    input: AIRouterSpeechRecognitionProviderConfigInput
  ): Promise<AIRouterSpeechRecognitionProviderConfigSummary> {
    assertProviderInput(input)
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
    const config = await this.requireConfig(id)
    return config.kind === 'online' ? this.secretScope().read(id) : null
  }

  listModelPackages(
    providerType?: AIRouterSpeechRecognitionProviderType
  ): Promise<AIRouterSpeechRecognitionModelPackageSummary[]> {
    return this.modelStore.listPackages(providerType)
  }

  importModelPackage(filePath: string): Promise<AIRouterSpeechRecognitionModelPackageImportResult> {
    return this.modelStore.importPackage(filePath)
  }

  async deleteModelPackage(id: string, version: string): Promise<void> {
    const referenced = (await this.readDocument()).providers.filter(
      (config) => config.modelPackageId === id && config.modelPackageVersion === version
    )
    if (referenced.length) {
      throw new Error(`模型包仍被 ${referenced.length} 个语音识别 Provider 使用`)
    }
    await this.modelStore.deletePackage(id, version)
  }

  async listProviderModels(
    input: AIRouterSpeechRecognitionProviderConfigInput
  ): Promise<AIRouterSpeechRecognitionModelOption[]> {
    const config = await this.resolveTransientConfig(input)
    if (config.kind === 'local') {
      if (!config.modelPackageId || !config.modelPackageVersion) return []
      const manifest = await this.modelStore.getPackage(
        config.modelPackageId,
        config.modelPackageVersion
      )
      return manifest.models.map(({ id, name }) => ({
        providerId: config.id,
        providerName: config.name,
        modelId: id,
        modelName: name
      }))
    }
    const apiKey = await this.resolveApiKey(input, config.id)
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`获取语音识别模型列表失败（HTTP ${response.status}）`)
    const payload = (await response.json()) as { data?: unknown }
    if (!Array.isArray(payload.data)) return []
    return payload.data
      .map((item): AIRouterSpeechRecognitionModelOption | null => {
        const id = typeof item === 'string' ? item : recordString(item, 'id')
        if (!id) return null
        return {
          providerId: config.id,
          providerName: config.name,
          modelId: id,
          modelName: recordString(item, 'name') ?? id
        }
      })
      .filter((model): model is AIRouterSpeechRecognitionModelOption => model !== null)
  }

  async listModels(): Promise<AIRouterSpeechRecognitionModelOption[]> {
    const options: AIRouterSpeechRecognitionModelOption[] = []
    for (const provider of (await this.readDocument()).providers) {
      const packageModels =
        provider.kind === 'local' && provider.modelPackageId && provider.modelPackageVersion
          ? (
              await this.modelStore.getPackage(
                provider.modelPackageId,
                provider.modelPackageVersion
              )
            ).models
          : []
      for (const model of provider.models.filter((candidate) => candidate.enabled)) {
        options.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName:
            packageModels.find((candidate) => candidate.id === model.id)?.name ??
            model.metadata?.name ??
            model.id
        })
      }
    }
    return options
  }

  async recognize(
    request: AIRouterSpeechRecognitionRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<AIRouterSpeechRecognitionResult> {
    validateRequest(request)
    if (options.signal?.aborted) throw abortError()
    const config = await this.requireConfig(request.providerConfigId)
    if (!config.models.some((model) => model.id === request.modelId && model.enabled)) {
      throw new Error('语音识别模型未配置或未启用')
    }
    if (config.kind === 'online') return this.recognizeOnline(config, request, options.signal)
    if (!config.modelPackageId || !config.modelPackageVersion) {
      throw new Error('本地语音识别 Provider 尚未选择模型包')
    }
    const manifest = await this.modelStore.getPackage(
      config.modelPackageId,
      config.modelPackageVersion
    )
    if (manifest.runtime.engine !== config.type) throw new Error('模型包与本地 Provider 类型不匹配')
    const model = manifest.models.find((candidate) => candidate.id === request.modelId)
    if (!model) throw new Error('语音识别模型包不包含所选模型')
    if (config.type !== 'qwen3-asr') throw new Error(`本地 ASR 运行时尚未实现：${config.type}`)
    const assets = await this.resolveQwenAssets(
      config.modelPackageId,
      config.modelPackageVersion,
      model.artifacts
    )
    return this.recognizeQwen(assets, request, options.signal)
  }

  dispose(): void {
    void this.statePromise
      ?.then((state) => this.resetWorker(state, abortError()))
      .catch(() => undefined)
  }

  private async recognizeOnline(
    config: AIRouterSpeechRecognitionProviderConfig,
    request: AIRouterSpeechRecognitionRequest,
    signal?: AbortSignal
  ): Promise<AIRouterSpeechRecognitionResult> {
    const body = new FormData()
    body.set('model', request.modelId)
    body.set(
      'file',
      new Blob([request.audio.data], { type: request.audio.mediaType }),
      request.audio.filename || 'audio.webm'
    )
    const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${(await this.secretScope().read(config.id)) ?? ''}` },
      body,
      signal
    })
    if (!response.ok) throw new Error(`在线语音识别失败（HTTP ${response.status}）`)
    const payload = (await response.json()) as { text?: unknown }
    if (typeof payload.text !== 'string') throw new Error('在线语音识别返回格式无效')
    return { text: payload.text }
  }

  private async resolveQwenAssets(
    packageId: string,
    packageVersion: string,
    artifacts: Record<string, string[]>
  ): Promise<Qwen3AsrAssets> {
    const resolveOne = async (key: string): Promise<string> => {
      const asset = artifacts[key]
      if (!asset || asset.length !== 1) throw new Error(`Qwen3 ASR 模型包缺少 ${key} 资产`)
      return this.modelStore.resolveAssetFilePath(packageId, packageVersion, asset[0])
    }
    if (!artifacts.tokenizer?.length) throw new Error('Qwen3 ASR 模型包缺少 tokenizer 资产')
    return {
      convFrontend: await resolveOne('convFrontend'),
      encoder: await resolveOne('encoder'),
      decoder: await resolveOne('decoder'),
      tokenizer: await Promise.all(
        (artifacts.tokenizer ?? []).map(async (assetPath) => ({
          name: basename(assetPath),
          path: await this.modelStore.resolveAssetFilePath(packageId, packageVersion, assetPath)
        }))
      ),
      vad: await resolveOne('vad')
    }
  }

  private async recognizeQwen(
    assets: Qwen3AsrAssets,
    request: AIRouterSpeechRecognitionRequest,
    signal?: AbortSignal
  ): Promise<AIRouterSpeechRecognitionResult> {
    const state = await this.workerState(assets)
    if (signal?.aborted) throw abortError()
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        if (!state.pending.has(requestId)) return
        state.pending.delete(requestId)
        this.resetWorker(state, abortError())
        reject(abortError())
      }
      state.pending.set(requestId, { resolve, reject, signal, abort })
      signal?.addEventListener('abort', abort, { once: true })
      state.worker.postMessage({ type: 'recognize', requestId, audio: request.audio })
    })
  }

  private workerState(assets: Qwen3AsrAssets): Promise<WorkerState> {
    const key = JSON.stringify(assets)
    if (this.statePromise) {
      return this.statePromise.then((state) => {
        if (state.key === key) return state
        this.resetWorker(state, new Error('语音识别模型已切换'))
        return this.workerState(assets)
      })
    }
    this.statePromise = this.createWorker(key, assets)
    return this.statePromise
  }

  private async createWorker(key: string, assets: Qwen3AsrAssets): Promise<WorkerState> {
    const worker = new Worker(
      this.options.workerUrl ?? new URL('./qwen3-asr-worker.js', import.meta.url),
      {
        workerData: {
          assets,
          ffmpegPath: this.options.ffmpegPath ?? resolveFfmpegPath()
        }
      }
    )
    const state: WorkerState = { key, worker, pending: new Map(), ready: Promise.resolve() }
    this.activeState = state
    state.ready = new Promise<void>((resolve, reject) => {
      worker.on('message', (message: unknown) => {
        if (!isRecord(message)) return
        if (message.type === 'ready') return resolve()
        if (message.type === 'init-error') {
          reject(new Error(stringValue(message.message, 'Qwen3 ASR 初始化失败')))
          return
        }
        if (typeof message.requestId !== 'string') return
        const pending = state.pending.get(message.requestId)
        if (!pending) return
        state.pending.delete(message.requestId)
        pending.signal?.removeEventListener('abort', pending.abort)
        if (message.type === 'result' && typeof message.text === 'string') {
          pending.resolve({ text: message.text })
        } else pending.reject(new Error(stringValue(message.message, '语音识别失败')))
      })
      worker.once('error', (error) => {
        reject(error)
        this.resetWorker(state, error)
      })
      worker.once('exit', (code) => {
        if (this.activeState === state)
          this.resetWorker(state, new Error(`Qwen3 ASR Worker 退出（${code}）`))
      })
    })
    try {
      await state.ready
      return state
    } catch (error) {
      this.resetWorker(state, error)
      await worker.terminate()
      throw error
    }
  }

  private resetWorker(state: WorkerState, reason: unknown): void {
    for (const pending of state.pending.values()) {
      pending.signal?.removeEventListener('abort', pending.abort)
      pending.reject(reason)
    }
    state.pending.clear()
    if (this.activeState === state) {
      this.activeState = null
      this.statePromise = null
    }
    void state.worker.terminate()
  }

  private async normalizeConfig(
    input: AIRouterSpeechRecognitionProviderConfigInput & { id: string }
  ): Promise<AIRouterSpeechRecognitionProviderConfig> {
    const kind = input.kind
    const type = input.type
    if (kind === 'local' && type !== 'qwen3-asr') throw new Error('本地语音识别 Provider 类型无效')
    if (kind === 'online' && type !== 'openai-compatible')
      throw new Error('在线语音识别 Provider 类型无效')
    const modelPackageId = kind === 'local' ? input.modelPackageId?.trim() || '' : ''
    const modelPackageVersion = kind === 'local' ? input.modelPackageVersion?.trim() || '' : ''
    const models = normalizeModels(input.models)
    if (kind === 'local') {
      if (!modelPackageId || !modelPackageVersion) throw new Error('本地 Provider 必须选择模型包')
      const manifest = await this.modelStore.getPackage(modelPackageId, modelPackageVersion)
      if (manifest.runtime.engine !== type) throw new Error('模型包与 Provider 类型不匹配')
      if (models.some((model) => !manifest.models.some((candidate) => candidate.id === model.id))) {
        throw new Error('Provider 包含模型包未声明的模型')
      }
    }
    return {
      id: input.id,
      name: input.name.trim(),
      kind,
      type,
      baseUrl: kind === 'online' ? normalizeBaseUrl(input.baseUrl) : '',
      modelPackageId,
      modelPackageVersion,
      models
    }
  }

  private async resolveTransientConfig(
    input: AIRouterSpeechRecognitionProviderConfigInput
  ): Promise<AIRouterSpeechRecognitionProviderConfig> {
    assertProviderInput(input)
    const id = input.id?.trim() || 'transient-provider'
    validateConfigId(id)
    return this.normalizeConfig({ ...input, id })
  }

  private async resolveApiKey(
    input: AIRouterSpeechRecognitionProviderConfigInput,
    id: string
  ): Promise<string> {
    if (input.apiKey !== undefined) return input.apiKey
    return (await this.secretScope().read(id)) ?? ''
  }

  private async summary(
    config: AIRouterSpeechRecognitionProviderConfig
  ): Promise<AIRouterSpeechRecognitionProviderConfigSummary> {
    return {
      ...config,
      models: config.models.map((model) => ({ ...model })),
      hasApiKey: config.kind === 'online' && (await this.secretScope().read(config.id)) !== null
    }
  }

  private async requireConfig(id: string): Promise<AIRouterSpeechRecognitionProviderConfig> {
    validateConfigId(id)
    const config = (await this.readDocument()).providers.find((candidate) => candidate.id === id)
    if (!config) throw new Error('语音识别 Provider 配置不存在')
    return config
  }

  private async readDocument(): Promise<StoredDocument> {
    const value = await this.configStorage.read<JsonValue>({ scope: ['airouter'], key: CONFIG_KEY })
    if (!value) return { version: CONFIG_VERSION, providers: [] }
    if (!isStoredDocument(value)) throw new Error('语音识别 Provider 配置数据无效')
    return value
  }

  private writeDocument(document: StoredDocument): Promise<void> {
    return this.configStorage.write(
      { scope: ['airouter'], key: CONFIG_KEY },
      document as unknown as JsonValue
    )
  }

  private secretScope(): ScopedSecretStorage {
    return this.secretStorage.scope('airouter').scope('speech-recognition-providers')
  }
}

function assertProviderInput(
  value: unknown
): asserts value is AIRouterSpeechRecognitionProviderConfigInput {
  if (!isRecord(value)) throw new Error('语音识别 Provider 配置无效')
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Provider 名称不能为空')
  if (value.kind !== 'online' && value.kind !== 'local') throw new Error('Provider 运行方式无效')
  if (value.type !== 'openai-compatible' && value.type !== 'qwen3-asr') {
    throw new Error('Provider 类型无效')
  }
  if (!Array.isArray(value.models)) throw new Error('模型配置必须是数组')
}

function normalizeModels(models: AIRouterModelConfig[]): AIRouterModelConfig[] {
  const result: AIRouterModelConfig[] = []
  for (const model of models) {
    const id = model?.id?.trim()
    if (!id || result.some((candidate) => candidate.id === id)) continue
    result.push({
      id,
      enabled: Boolean(model.enabled),
      ...(model.metadata ? { metadata: model.metadata } : {})
    })
  }
  return result
}

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = (value?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '')
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
  } catch {
    throw new Error('Base URL 必须是有效的 HTTP 地址')
  }
  return baseUrl
}

function validateRequest(request: AIRouterSpeechRecognitionRequest): void {
  if (
    !request ||
    typeof request.providerConfigId !== 'string' ||
    typeof request.modelId !== 'string'
  ) {
    throw new Error('语音识别 Provider 或模型无效')
  }
  if (
    !request.audio ||
    !(request.audio.data instanceof Uint8Array) ||
    request.audio.data.byteLength === 0 ||
    request.audio.data.byteLength > MAX_AUDIO_BYTES ||
    typeof request.audio.mediaType !== 'string' ||
    !request.audio.mediaType.toLowerCase().startsWith('audio/') ||
    (request.audio.filename !== undefined && typeof request.audio.filename !== 'string')
  )
    throw new Error('语音识别音频输入无效')
}

function isStoredDocument(value: JsonValue): value is JsonValue & StoredDocument {
  if (!isRecord(value) || value.version !== CONFIG_VERSION || !Array.isArray(value.providers))
    return false
  return value.providers.every(
    (provider) =>
      isRecord(provider) &&
      typeof provider.id === 'string' &&
      validConfigId.test(provider.id) &&
      typeof provider.name === 'string' &&
      (provider.kind === 'online' || provider.kind === 'local') &&
      (provider.type === 'openai-compatible' || provider.type === 'qwen3-asr') &&
      typeof provider.baseUrl === 'string' &&
      typeof provider.modelPackageId === 'string' &&
      typeof provider.modelPackageVersion === 'string' &&
      Array.isArray(provider.models)
  )
}

function validateConfigId(id: string): void {
  if (!validConfigId.test(id)) throw new Error('语音识别 Provider 配置 ID 无效')
}

function resolveFfmpegPath(): string {
  const value = require('ffmpeg-static') as unknown
  if (typeof value !== 'string' || !value) throw new Error('FFmpeg 不可用')
  return value.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

function recordString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function abortError(): DOMException {
  return new DOMException('Speech recognition was aborted', 'AbortError')
}
