import { randomUUID } from 'node:crypto'
import { createOpenAI } from '@ai-sdk/openai'
import { generateImage as generateImageWithModel } from 'ai'
import { JsonConfigStorage } from '@ls101/config-store/main'
import type { JsonValue } from '@ls101/config-store/shared'
import {
  createElectronSecretStorage,
  type EncryptedSecretStorage,
  type ScopedSecretStorage
} from '@ls101/secret-store/main'
import type {
  AIRouterGeneratedImage,
  AIRouterImageConnectionTestInput,
  AIRouterImageGenerationSettings,
  AIRouterImageProviderConfig,
  AIRouterImageProviderConfigInput,
  AIRouterImageProviderConfigSummary,
  AIRouterImageRequest,
  AIRouterImageTestResult,
  AIRouterModelConfig,
  AIRouterModelOption
} from '../shared'

const CONFIG_VERSION = 1
const PROVIDERS_KEY = 'image-providers'
const SETTINGS_KEY = 'image-settings'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const validConfigId = /^[a-zA-Z0-9_-]+$/

interface StoredDocument {
  version: number
  providers: AIRouterImageProviderConfig[]
}

export interface AIRouterImageServiceOptions {
  baseDir: string
  configStorage?: JsonConfigStorage
  secretStorage?: EncryptedSecretStorage
}

export class AIRouterImageService {
  private readonly configStorage: JsonConfigStorage
  private readonly secretStorage: EncryptedSecretStorage

  constructor(options: AIRouterImageServiceOptions) {
    this.configStorage = options.configStorage ?? new JsonConfigStorage(options.baseDir)
    this.secretStorage = options.secretStorage ?? createElectronSecretStorage(options.baseDir)
  }

  async listProviderConfigs(): Promise<AIRouterImageProviderConfigSummary[]> {
    const document = await this.readDocument()
    return Promise.all(document.providers.map((config) => this.summary(config)))
  }

  async saveProviderConfig(
    input: AIRouterImageProviderConfigInput
  ): Promise<AIRouterImageProviderConfigSummary> {
    const document = await this.readDocument()
    const id = input.id?.trim() || randomUUID()
    validateConfigId(id)
    const config = normalizeConfig({ ...input, id })
    const providers = document.providers.some((candidate) => candidate.id === id)
      ? document.providers.map((candidate) => (candidate.id === id ? config : candidate))
      : [...document.providers, config]
    await this.writeDocument({ version: CONFIG_VERSION, providers })
    if (input.clearApiKey) await this.secretScope().delete(id)
    else if (input.apiKey !== undefined) await this.secretScope().write(id, input.apiKey)
    const settings = await this.getGenerationSettings()
    if (
      settings.mode === 'provider' &&
      settings.providerConfigId === id &&
      !config.models.some((model) => model.id === settings.modelId && model.enabled)
    ) {
      await this.saveGenerationSettings({ mode: 'manual' })
    }
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
    const settings = await this.getGenerationSettings()
    if (settings.mode === 'provider' && settings.providerConfigId === id) {
      await this.saveGenerationSettings({ mode: 'manual' })
    }
  }

  async readProviderApiKey(id: string): Promise<string | null> {
    validateConfigId(id)
    await this.requireConfig(id)
    return this.secretScope().read(id)
  }

  async listModels(input: AIRouterImageProviderConfigInput): Promise<AIRouterModelOption[]> {
    const { config, apiKey } = await this.resolveTransientConfig(input)
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`获取模型列表失败（HTTP ${response.status}）`)
    const payload = (await response.json()) as { data?: unknown }
    if (!Array.isArray(payload.data)) return []
    return payload.data
      .map((item): AIRouterModelOption | null => {
        if (typeof item === 'string') return { id: item }
        if (!item || typeof item !== 'object') return null
        const value = item as { id?: unknown; name?: unknown }
        return typeof value.id === 'string'
          ? { id: value.id, name: typeof value.name === 'string' ? value.name : undefined }
          : null
      })
      .filter((model): model is AIRouterModelOption => model !== null)
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  async getGenerationSettings(): Promise<AIRouterImageGenerationSettings> {
    const value = await this.configStorage.read<JsonValue>({
      scope: ['airouter'],
      key: SETTINGS_KEY
    })
    if (!value) return { mode: 'manual' }
    if (!isGenerationSettings(value)) throw new Error('图像生成设置数据无效')
    return value
  }

  async saveGenerationSettings(
    settings: AIRouterImageGenerationSettings
  ): Promise<AIRouterImageGenerationSettings> {
    validateGenerationSettings(settings)
    if (settings.mode === 'provider') {
      const config = await this.requireConfig(settings.providerConfigId)
      if (!config.models.some((model) => model.id === settings.modelId && model.enabled)) {
        throw new Error('图像生成模型未配置或未启用')
      }
    }
    await this.configStorage.write(
      { scope: ['airouter'], key: SETTINGS_KEY },
      settings as unknown as JsonValue
    )
    return settings
  }

  async testConnection(
    request: AIRouterImageConnectionTestInput
  ): Promise<AIRouterImageTestResult> {
    if (!request || typeof request.modelId !== 'string' || !request.modelId.trim()) {
      throw new Error('模型 ID 不能为空')
    }
    const { config, apiKey } = await this.resolveTransientConfig(request.config)
    if (!config.models.some((model) => model.id === request.modelId && model.enabled)) {
      throw new Error('模型未配置或未启用')
    }
    const image = await generate(config, apiKey, request.modelId, '一枚简洁的绿色圆形图标')
    return { ok: true, image }
  }

  async generateImage(
    request: AIRouterImageRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<AIRouterGeneratedImage> {
    validateImageRequest(request)
    const config = await this.requireConfig(request.providerConfigId)
    if (!config.models.some((model) => model.id === request.modelId && model.enabled)) {
      throw new Error('图像生成模型未配置或未启用')
    }
    const apiKey = (await this.secretScope().read(config.id)) ?? ''
    return generate(config, apiKey, request.modelId, request.prompt, request.size, options.signal)
  }

  private async resolveTransientConfig(
    input: AIRouterImageProviderConfigInput
  ): Promise<{ config: AIRouterImageProviderConfig; apiKey: string }> {
    const id = input.id?.trim() || 'preview'
    validateConfigId(id)
    const config = normalizeConfig({ ...input, id })
    let apiKey = ''
    if (!input.clearApiKey) {
      if (input.apiKey !== undefined) apiKey = input.apiKey
      else if (input.id) apiKey = (await this.secretScope().read(id)) ?? ''
    }
    return { config, apiKey }
  }

  private async summary(
    config: AIRouterImageProviderConfig
  ): Promise<AIRouterImageProviderConfigSummary> {
    return {
      ...config,
      models: config.models.map((model) => ({ ...model })),
      hasApiKey: (await this.secretScope().read(config.id)) !== null
    }
  }

  private async requireConfig(id: string): Promise<AIRouterImageProviderConfig> {
    validateConfigId(id)
    const config = (await this.readDocument()).providers.find((candidate) => candidate.id === id)
    if (!config) throw new Error('图像 Provider 配置不存在')
    return config
  }

  private async readDocument(): Promise<StoredDocument> {
    const value = await this.configStorage.read<JsonValue>({
      scope: ['airouter'],
      key: PROVIDERS_KEY
    })
    if (!value) return { version: CONFIG_VERSION, providers: [] }
    if (!isStoredDocument(value)) throw new Error('图像 Provider 配置数据无效')
    return value
  }

  private writeDocument(document: StoredDocument): Promise<void> {
    return this.configStorage.write(
      { scope: ['airouter'], key: PROVIDERS_KEY },
      document as unknown as JsonValue
    )
  }

  private secretScope(): ScopedSecretStorage {
    return this.secretStorage.scope('airouter').scope('image-providers')
  }
}

async function generate(
  config: AIRouterImageProviderConfig,
  apiKey: string,
  modelId: string,
  prompt: string,
  size?: { width: number; height: number },
  signal?: AbortSignal
): Promise<AIRouterGeneratedImage> {
  const provider = createOpenAI({ apiKey, baseURL: config.baseUrl })
  const result = await generateImageWithModel({
    model: provider.image(modelId),
    prompt,
    size: size ? `${size.width}x${size.height}` : undefined,
    abortSignal: signal
  })
  const data = new Uint8Array(result.image.uint8Array)
  if (!result.image.mediaType.startsWith('image/')) throw new Error('生成结果不是图片')
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error('生成图片不能超过 20 MB')
  return { data, mediaType: result.image.mediaType }
}

function normalizeConfig(
  input: AIRouterImageProviderConfigInput & { id: string }
): AIRouterImageProviderConfig {
  if (typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('Provider 名称不能为空')
  }
  if (input.type !== 'openai-compatible') throw new Error('不支持的图像 Provider 类型')
  if (input.baseUrl !== undefined && typeof input.baseUrl !== 'string') {
    throw new Error('Base URL 必须是字符串')
  }
  if (!Array.isArray(input.models)) throw new Error('模型配置必须是数组')
  const baseUrl = (input.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '')
  try {
    const url = new URL(baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
  } catch {
    throw new Error('Base URL 必须是有效的 HTTP 地址')
  }
  const models: AIRouterModelConfig[] = []
  for (const model of input.models) {
    if (!model || typeof model.id !== 'string') continue
    const id = model.id.trim()
    if (!id || models.some((candidate) => candidate.id === id)) continue
    models.push({ id, enabled: Boolean(model.enabled) })
  }
  return { id: input.id, name: input.name.trim(), type: input.type, baseUrl, models }
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

function isProviderConfig(value: unknown): value is AIRouterImageProviderConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AIRouterImageProviderConfig>
  return (
    typeof candidate.id === 'string' &&
    validConfigId.test(candidate.id) &&
    typeof candidate.name === 'string' &&
    candidate.type === 'openai-compatible' &&
    typeof candidate.baseUrl === 'string' &&
    Array.isArray(candidate.models) &&
    candidate.models.every(
      (model) =>
        Boolean(model) && typeof model.id === 'string' && typeof model.enabled === 'boolean'
    )
  )
}

function isGenerationSettings(value: JsonValue): value is AIRouterImageGenerationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AIRouterImageGenerationSettings>
  return (
    candidate.mode === 'manual' ||
    (candidate.mode === 'provider' &&
      typeof candidate.providerConfigId === 'string' &&
      typeof candidate.modelId === 'string')
  )
}

function validateGenerationSettings(settings: AIRouterImageGenerationSettings): void {
  if (!settings || (settings.mode !== 'manual' && settings.mode !== 'provider')) {
    throw new Error('图像生成模式无效')
  }
  if (settings.mode === 'provider') {
    validateConfigId(settings.providerConfigId)
    if (!settings.modelId) throw new Error('图像生成模型 ID 不能为空')
  }
}

function validateImageRequest(request: AIRouterImageRequest): void {
  if (!request || typeof request.providerConfigId !== 'string' || !request.providerConfigId) {
    throw new Error('图像 Provider ID 不能为空')
  }
  validateConfigId(request.providerConfigId)
  if (typeof request.modelId !== 'string' || !request.modelId) {
    throw new Error('图像模型 ID 不能为空')
  }
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) {
    throw new Error('图片提示词不能为空')
  }
  if (request.size) {
    const { width, height } = request.size
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192
    ) {
      throw new Error('图片尺寸必须是 1 到 8192 之间的整数')
    }
  }
}

function validateConfigId(id: string): void {
  if (!validConfigId.test(id)) throw new Error('Provider 配置 ID 无效')
}
