import { randomUUID } from 'node:crypto'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, streamText, type LanguageModel } from 'ai'
import { JsonConfigStorage } from '@ls101/config-store/main'
import type { JsonValue } from '@ls101/config-store/shared'
import { createElectronSecretStorage, type EncryptedSecretStorage } from '@ls101/secret-store/main'
import type {
  AIRouterConnectionTestInput,
  AIRouterModelConfig,
  AIRouterModelOption,
  AIRouterProviderConfig,
  AIRouterProviderConfigInput,
  AIRouterProviderConfigSummary,
  AIRouterProviderType,
  AIRouterTestResult,
  AIRouterTextChunk,
  AIRouterTextRequest
} from '../shared'

const CONFIG_VERSION = 1
const CONFIG_KEY = 'providers'
const validConfigId = /^[a-zA-Z0-9_-]+$/
const DEFAULT_BASE_URLS: Record<AIRouterProviderType, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1'
}

interface StoredDocument {
  version: number
  providers: AIRouterProviderConfig[]
}

export interface AIRouterServiceOptions {
  baseDir: string
  configStorage?: JsonConfigStorage
  secretStorage?: EncryptedSecretStorage
}

export class AIRouterService {
  private readonly configStorage: JsonConfigStorage
  private readonly secretStorage: EncryptedSecretStorage

  constructor(options: AIRouterServiceOptions) {
    this.configStorage = options.configStorage ?? new JsonConfigStorage(options.baseDir)
    this.secretStorage = options.secretStorage ?? createElectronSecretStorage(options.baseDir)
  }

  async listProviderConfigs(): Promise<AIRouterProviderConfigSummary[]> {
    const document = await this.readDocument()
    return Promise.all(document.providers.map((config) => this.summary(config)))
  }

  async saveProviderConfig(
    input: AIRouterProviderConfigInput
  ): Promise<AIRouterProviderConfigSummary> {
    const existing = await this.readDocument()
    const id = input.id?.trim() || randomUUID()
    validateConfigId(id)
    const config = normalizeConfig({ ...input, id })
    const previous = existing.providers.find((candidate) => candidate.id === id)
    const providers = previous
      ? existing.providers.map((candidate) => (candidate.id === id ? config : candidate))
      : [...existing.providers, config]

    await this.writeDocument({ version: CONFIG_VERSION, providers })
    if (input.clearApiKey) {
      await this.secretStorage.scope('airouter').delete(id)
    } else if (input.apiKey !== undefined) {
      await this.secretStorage.scope('airouter').write(id, input.apiKey)
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
    await this.secretStorage.scope('airouter').delete(id)
  }

  async readProviderApiKey(id: string): Promise<string | null> {
    validateConfigId(id)
    await this.requireConfig(id)
    return this.secretStorage.scope('airouter').read(id)
  }

  async listModels(input: AIRouterProviderConfigInput): Promise<AIRouterModelOption[]> {
    const { config, apiKey } = await this.resolveTransientConfig(input)
    const response = await fetch(modelEndpoint(config), {
      headers: requestHeaders(config.type, apiKey),
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

  async testConnection(request: AIRouterConnectionTestInput): Promise<AIRouterTestResult> {
    if (!request || typeof request.modelId !== 'string' || !request.modelId) {
      throw new Error('模型 ID 不能为空')
    }
    const { config, apiKey } = await this.resolveTransientConfig(request.config)
    const selected = config.models.find((model) => model.id === request.modelId && model.enabled)
    if (!selected) throw new Error('模型未配置或未启用')
    const result = await this.collectText(
      createLanguageModel(config, apiKey, selected.id),
      '请只回复 OK，不要添加其他内容。'
    )
    return { ok: true, text: result }
  }

  async *generateText(
    request: AIRouterTextRequest,
    options: { signal?: AbortSignal } = {}
  ): AsyncGenerator<AIRouterTextChunk> {
    const { model } = await this.resolveModel(request)
    const result = streamText({ model, prompt: request.prompt, abortSignal: options.signal })
    for await (const part of result.fullStream as AsyncIterable<unknown>) {
      const chunk = toChunk(part)
      if (chunk) yield chunk
      if (isStreamError(part)) throw new Error(formatProviderError(part.error))
    }
  }

  private async collectText(model: LanguageModel, prompt: string): Promise<string> {
    const result = await generateText({
      model,
      prompt,
      abortSignal: AbortSignal.timeout(30_000)
    })
    return result.text
  }

  private async resolveModel(request: AIRouterTextRequest): Promise<{ model: LanguageModel }> {
    validateTextRequest(request)
    const config = await this.requireConfig(request.providerConfigId)
    const selected = config.models.find((model) => model.id === request.modelId && model.enabled)
    if (!selected) throw new Error('模型未配置或未启用')
    const apiKey = (await this.secretStorage.scope('airouter').read(config.id)) ?? ''
    return { model: createLanguageModel(config, apiKey, selected.id) }
  }

  private async resolveTransientConfig(
    input: AIRouterProviderConfigInput
  ): Promise<{ config: AIRouterProviderConfig; apiKey: string }> {
    const id = input.id?.trim() || 'preview'
    validateConfigId(id)
    const config = normalizeConfig({ ...input, id })
    let apiKey = ''
    if (!input.clearApiKey) {
      if (input.apiKey !== undefined) apiKey = input.apiKey
      else if (input.id) apiKey = (await this.secretStorage.scope('airouter').read(id)) ?? ''
    }
    return { config, apiKey }
  }

  private async summary(config: AIRouterProviderConfig): Promise<AIRouterProviderConfigSummary> {
    return {
      ...config,
      models: config.models.map((model) => ({ ...model })),
      hasApiKey: (await this.secretStorage.scope('airouter').read(config.id)) !== null
    }
  }

  private async requireConfig(id: string): Promise<AIRouterProviderConfig> {
    const config = (await this.readDocument()).providers.find((candidate) => candidate.id === id)
    if (!config) throw new Error('Provider 配置不存在')
    return config
  }

  private async readDocument(): Promise<StoredDocument> {
    const value = await this.configStorage.read<JsonValue>({ scope: ['airouter'], key: CONFIG_KEY })
    if (!value) return { version: CONFIG_VERSION, providers: [] }
    if (!isStoredDocument(value)) throw new Error('AI 引擎配置数据无效')
    return value
  }

  private writeDocument(document: StoredDocument): Promise<void> {
    return this.configStorage.write(
      { scope: ['airouter'], key: CONFIG_KEY },
      document as unknown as JsonValue
    )
  }
}

function normalizeConfig(
  input: AIRouterProviderConfigInput & { id: string }
): AIRouterProviderConfig {
  if (typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('Provider 名称不能为空')
  }
  if (input.type !== 'openai-compatible' && input.type !== 'anthropic') {
    throw new Error('不支持的 Provider 类型')
  }
  if (input.baseUrl !== undefined && typeof input.baseUrl !== 'string') {
    throw new Error('Base URL 必须是字符串')
  }
  if (!Array.isArray(input.models)) throw new Error('模型配置必须是数组')
  const baseUrl = (input.baseUrl?.trim() || DEFAULT_BASE_URLS[input.type]).replace(/\/$/, '')
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

function isProviderConfig(value: unknown): value is AIRouterProviderConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AIRouterProviderConfig>
  return (
    typeof candidate.id === 'string' &&
    validConfigId.test(candidate.id) &&
    typeof candidate.name === 'string' &&
    (candidate.type === 'openai-compatible' || candidate.type === 'anthropic') &&
    typeof candidate.baseUrl === 'string' &&
    Array.isArray(candidate.models) &&
    candidate.models.every(
      (model) =>
        Boolean(model) && typeof model.id === 'string' && typeof model.enabled === 'boolean'
    )
  )
}

function modelEndpoint(config: AIRouterProviderConfig): string {
  return `${config.baseUrl}/models`
}

function requestHeaders(type: AIRouterProviderType, apiKey: string): Record<string, string> {
  return type === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${apiKey}` }
}

function createLanguageModel(
  config: AIRouterProviderConfig,
  apiKey: string,
  modelId: string
): LanguageModel {
  if (config.type === 'openai-compatible') {
    const provider = createOpenAI({ apiKey, baseURL: config.baseUrl })
    return provider.chat(modelId)
  }
  const provider = createAnthropic({ apiKey, baseURL: config.baseUrl })
  return provider(modelId)
}

function toChunk(part: unknown): AIRouterTextChunk | null {
  if (!part || typeof part !== 'object') return null
  const value = part as { type?: unknown; textDelta?: unknown; delta?: unknown }
  const delta = typeof value.textDelta === 'string' ? value.textDelta : value.delta
  if (typeof delta !== 'string' || !delta) return null
  if (value.type === 'reasoning-delta') return { type: 'reasoning', delta }
  if (value.type === 'text-delta' || value.type === 'text') return { type: 'output', delta }
  return null
}

function isStreamError(part: unknown): part is { error: unknown } {
  return Boolean(part && typeof part === 'object' && (part as { type?: unknown }).type === 'error')
}

function formatProviderError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'AI 引擎请求失败'
}

function validateConfigId(id: string): void {
  if (!validConfigId.test(id)) throw new Error('Provider 配置 ID 无效')
}

function validateTextSelection(request: Omit<AIRouterTextRequest, 'prompt'>): void {
  if (
    !request ||
    typeof request.providerConfigId !== 'string' ||
    typeof request.modelId !== 'string' ||
    !request.providerConfigId ||
    !request.modelId
  ) {
    throw new Error('Provider 和模型 ID 不能为空')
  }
  validateConfigId(request.providerConfigId)
}

function validateTextRequest(request: AIRouterTextRequest): void {
  validateTextSelection(request)
  if (typeof request.prompt !== 'string') throw new Error('Prompt 必须是字符串')
}
