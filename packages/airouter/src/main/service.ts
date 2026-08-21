import { randomUUID } from 'node:crypto'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { JSONObject, SharedV4ProviderOptions } from '@ai-sdk/provider'
import { generateText, streamText, type LanguageModel } from 'ai'
import { JsonConfigStorage } from '@ls101/config-store/main'
import type { JsonValue } from '@ls101/config-store/shared'
import { createElectronSecretStorage, type EncryptedSecretStorage } from '@ls101/secret-store/main'
import modelCatalog from './model-catalog.generated.json'
import type {
  AIRouterConnectionTestInput,
  AIRouterModelConfig,
  AIRouterModelMetadata,
  AIRouterModelOption,
  AIRouterProviderConfig,
  AIRouterProviderConfigInput,
  AIRouterProviderConfigSummary,
  AIRouterProviderType,
  AIRouterReasoningConfig,
  AIRouterReasoningEffort,
  AIRouterReasoningOption,
  AIRouterTestResult,
  AIRouterTextChunk,
  AIRouterTextRequest
} from '../shared'

const CONFIG_VERSION = 1
const CONFIG_KEY = 'providers'
const DEFAULT_MAX_OUTPUT_TOKENS = 128 * 1024
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
    const models = payload.data
      .map((item): AIRouterModelOption | null => {
        if (typeof item === 'string') return { id: item }
        if (!item || typeof item !== 'object') return null
        return toProviderModelOption(item)
      })
      .filter((model): model is AIRouterModelOption => model !== null)
      .sort((left, right) => left.id.localeCompare(right.id))
    return enrichModelsFromCatalog(models, config.catalogProviderId)
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
    const { model, config, selected } = await this.resolveModel(request)
    const reasoning = reasoningCallOptions(config.type, selected.reasoning)
    const result = streamText({
      model,
      prompt: request.prompt,
      abortSignal: options.signal,
      maxOutputTokens: selected.maxOutputTokens ?? defaultMaxOutputTokens(selected.metadata),
      ...reasoning
    })
    for await (const part of result.fullStream as AsyncIterable<unknown>) {
      const chunk = toChunk(part)
      if (chunk) yield chunk
      const finishReason = streamFinishReason(part)
      if (finishReason === 'length') {
        throw new Error('AI 输出达到长度上限，JSON 未完整生成；请减少字段内容后重试')
      }
      if (finishReason === 'content-filter') {
        throw new Error('AI 输出被 Provider 的内容安全策略截断')
      }
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

  private async resolveModel(request: AIRouterTextRequest): Promise<{
    model: LanguageModel
    config: AIRouterProviderConfig
    selected: AIRouterModelConfig
  }> {
    validateTextRequest(request)
    const config = await this.requireConfig(request.providerConfigId)
    const selected = config.models.find((model) => model.id === request.modelId && model.enabled)
    if (!selected) throw new Error('模型未配置或未启用')
    const apiKey = (await this.secretStorage.scope('airouter').read(config.id)) ?? ''
    return { model: createLanguageModel(config, apiKey, selected.id), config, selected }
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
    models.push(normalizeModelConfig({ ...model, id }, input.type))
  }
  return {
    id: input.id,
    name: input.name.trim(),
    type: input.type,
    catalogProviderId:
      input.catalogProviderId?.trim() || defaultCatalogProvider(input.type, baseUrl),
    baseUrl,
    models
  }
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
    (candidate.catalogProviderId === undefined ||
      typeof candidate.catalogProviderId === 'string') &&
    typeof candidate.baseUrl === 'string' &&
    Array.isArray(candidate.models) &&
    candidate.models.every((model) => isModelConfig(model))
  )
}

function normalizeModelConfig(
  model: AIRouterModelConfig,
  providerType: AIRouterProviderType
): AIRouterModelConfig {
  const metadata = normalizeModelMetadata(model.metadata)
  const officialLimit = metadata?.outputLimit
  const requestedMax = model.maxOutputTokens
  if (requestedMax !== undefined && (!Number.isInteger(requestedMax) || requestedMax < 1)) {
    throw new Error(`模型 ${model.id} 的最大输出长度必须是正整数`)
  }
  const maxOutputTokens =
    requestedMax === undefined
      ? undefined
      : officialLimit
        ? Math.min(requestedMax, officialLimit)
        : requestedMax
  const reasoning = normalizeReasoningConfig(model.id, model.reasoning, metadata, providerType)
  return {
    id: model.id,
    enabled: Boolean(model.enabled),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(metadata ? { metadata } : {})
  }
}

function normalizeModelMetadata(
  value: AIRouterModelMetadata | undefined
): AIRouterModelMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const metadata: AIRouterModelMetadata = {}
  if (typeof value.name === 'string' && value.name.trim()) metadata.name = value.name.trim()
  if (Number.isInteger(value.contextLimit) && (value.contextLimit as number) > 0) {
    metadata.contextLimit = value.contextLimit
  }
  if (Number.isInteger(value.outputLimit) && (value.outputLimit as number) > 0) {
    metadata.outputLimit = value.outputLimit
  }
  if (typeof value.reasoning === 'boolean') metadata.reasoning = value.reasoning
  if (Array.isArray(value.reasoningOptions)) {
    const options = normalizeReasoningOptions(value.reasoningOptions)
    if (options.length) metadata.reasoningOptions = options
  }
  if (typeof value.structuredOutput === 'boolean') {
    metadata.structuredOutput = value.structuredOutput
  }
  if (typeof value.attachment === 'boolean') metadata.attachment = value.attachment
  return Object.keys(metadata).length ? metadata : undefined
}

function normalizeReasoningConfig(
  modelId: string,
  reasoning: AIRouterReasoningConfig | undefined,
  metadata: AIRouterModelMetadata | undefined,
  providerType: AIRouterProviderType
): AIRouterReasoningConfig | undefined {
  if (!reasoning) return undefined
  if (metadata?.reasoning === false) throw new Error(`模型 ${modelId} 不支持推理`)
  const options = metadata?.reasoningOptions ?? []
  if (reasoning.type === 'disabled' || reasoning.type === 'enabled') {
    const budgetOnlyCompatibleFallback =
      providerType === 'openai-compatible' &&
      options.some((option) => option.type === 'budget_tokens') &&
      !options.some((option) => option.type === 'effort')
    if (
      options.length &&
      !options.some((option) => option.type === 'toggle') &&
      !budgetOnlyCompatibleFallback
    ) {
      throw new Error(`模型 ${modelId} 不支持推理开关`)
    }
    return { type: reasoning.type }
  }
  if (reasoning.type === 'effort') {
    const option = options.find((candidate) => candidate.type === 'effort')
    if (option?.type === 'effort' && !option.values.includes(reasoning.effort)) {
      throw new Error(`模型 ${modelId} 不支持推理强度 ${reasoning.effort}`)
    }
    if (!isReasoningEffort(reasoning.effort)) throw new Error(`模型 ${modelId} 的推理强度无效`)
    return { type: 'effort', effort: reasoning.effort }
  }
  if (!Number.isInteger(reasoning.budgetTokens) || reasoning.budgetTokens < 1) {
    throw new Error(`模型 ${modelId} 的推理预算必须是正整数`)
  }
  if (providerType !== 'anthropic') {
    throw new Error(`模型 ${modelId} 的当前 Provider 不支持 token 推理预算`)
  }
  const option = options.find((candidate) => candidate.type === 'budget_tokens')
  if (option?.type === 'budget_tokens') {
    if (option.min !== undefined && reasoning.budgetTokens < option.min) {
      throw new Error(`模型 ${modelId} 的推理预算不能小于 ${option.min}`)
    }
    if (option.max !== undefined && reasoning.budgetTokens > option.max) {
      throw new Error(`模型 ${modelId} 的推理预算不能大于 ${option.max}`)
    }
  }
  return { type: 'budget_tokens', budgetTokens: reasoning.budgetTokens }
}

function isModelConfig(value: unknown): value is AIRouterModelConfig {
  if (!value || typeof value !== 'object') return false
  const model = value as Partial<AIRouterModelConfig>
  return (
    typeof model.id === 'string' &&
    typeof model.enabled === 'boolean' &&
    (model.maxOutputTokens === undefined ||
      (Number.isInteger(model.maxOutputTokens) && model.maxOutputTokens > 0)) &&
    (model.reasoning === undefined || isReasoningConfig(model.reasoning)) &&
    (model.metadata === undefined || typeof model.metadata === 'object')
  )
}

function isReasoningConfig(value: unknown): value is AIRouterReasoningConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as { type?: unknown; effort?: unknown; budgetTokens?: unknown }
  if (config.type === 'disabled' || config.type === 'enabled') return true
  if (config.type === 'effort') return isReasoningEffort(config.effort)
  return (
    config.type === 'budget_tokens' &&
    Number.isInteger(config.budgetTokens) &&
    (config.budgetTokens as number) > 0
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

function defaultCatalogProvider(type: AIRouterProviderType, baseUrl: string): string {
  if (type === 'anthropic') return 'anthropic'
  return baseUrl === DEFAULT_BASE_URLS['openai-compatible'] ? 'openai' : ''
}

function defaultMaxOutputTokens(metadata?: AIRouterModelMetadata): number {
  const officialLimit = metadata?.outputLimit
  return officialLimit && officialLimit > 0
    ? Math.min(DEFAULT_MAX_OUTPUT_TOKENS, officialLimit)
    : DEFAULT_MAX_OUTPUT_TOKENS
}

function reasoningCallOptions(
  providerType: AIRouterProviderType,
  reasoning?: AIRouterReasoningConfig
): {
  reasoning?: Exclude<AIRouterReasoningEffort, 'max'>
  providerOptions?: SharedV4ProviderOptions
} {
  if (!reasoning) return {}
  if (reasoning.type === 'disabled') return { reasoning: 'none' }
  if (reasoning.type === 'enabled') return { reasoning: 'medium' }
  if (reasoning.type === 'effort') {
    if (reasoning.effort === 'max') {
      return {
        providerOptions: {
          [providerType === 'anthropic' ? 'anthropic' : 'openai']:
            providerType === 'anthropic'
              ? ({
                  effort: 'max',
                  thinking: { type: 'adaptive', display: 'summarized' }
                } as JSONObject)
              : ({ reasoningEffort: 'max' } as JSONObject)
        }
      }
    }
    return { reasoning: reasoning.effort }
  }
  if (providerType !== 'anthropic') {
    throw new Error('当前 Provider 协议不支持按 token 设置推理预算')
  }
  return {
    providerOptions: {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: reasoning.budgetTokens }
      }
    }
  }
}

function toProviderModelOption(item: object): AIRouterModelOption | null {
  const value = item as {
    id?: unknown
    name?: unknown
    display_name?: unknown
    context_length?: unknown
    max_output_tokens?: unknown
    input_modalities?: unknown
    capabilities?: { reasoning?: unknown; structured_output?: unknown }
  }
  if (typeof value.id !== 'string') return null
  const model: AIRouterModelOption = { id: value.id }
  const name =
    typeof value.name === 'string'
      ? value.name
      : typeof value.display_name === 'string'
        ? value.display_name
        : undefined
  if (name) model.name = name
  if (typeof value.context_length === 'number') model.contextLimit = value.context_length
  if (typeof value.max_output_tokens === 'number') model.outputLimit = value.max_output_tokens
  if (typeof value.capabilities?.reasoning === 'boolean') {
    model.reasoning = value.capabilities.reasoning
  }
  if (typeof value.capabilities?.structured_output === 'boolean') {
    model.structuredOutput = value.capabilities.structured_output
  }
  if (Array.isArray(value.input_modalities)) {
    model.attachment = value.input_modalities.includes('image')
  }
  return model
}

interface CatalogModel {
  name?: unknown
  contextLimit?: unknown
  outputLimit?: unknown
  reasoning?: unknown
  reasoningOptions?: unknown
  structuredOutput?: unknown
  attachment?: unknown
}

interface CatalogProvider {
  models?: Record<string, CatalogModel>
}

function enrichModelsFromCatalog(
  models: AIRouterModelOption[],
  providerId: string
): AIRouterModelOption[] {
  if (!providerId) return models
  const providers = modelCatalog.providers as Record<string, CatalogProvider>
  const providerModels = providers[providerId]?.models ?? {}
  return models.map((model) => ({
    ...toModelMetadata(providerModels[model.id]),
    ...model
  }))
}

function toModelMetadata(model?: CatalogModel): AIRouterModelMetadata {
  if (!model) return {}
  const metadata: AIRouterModelMetadata = {}
  if (typeof model.name === 'string') metadata.name = model.name
  if (typeof model.contextLimit === 'number') metadata.contextLimit = model.contextLimit
  if (typeof model.outputLimit === 'number') metadata.outputLimit = model.outputLimit
  if (typeof model.reasoning === 'boolean') metadata.reasoning = model.reasoning
  const reasoningOptions = normalizeReasoningOptions(model.reasoningOptions)
  if (reasoningOptions.length) metadata.reasoningOptions = reasoningOptions
  if (typeof model.structuredOutput === 'boolean') {
    metadata.structuredOutput = model.structuredOutput
  }
  if (typeof model.attachment === 'boolean') metadata.attachment = model.attachment
  return metadata
}

function normalizeReasoningOptions(value: unknown): AIRouterReasoningOption[] {
  if (!Array.isArray(value)) return []
  const options: AIRouterReasoningOption[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const option = item as { type?: unknown; values?: unknown; min?: unknown; max?: unknown }
    if (option.type === 'toggle') options.push({ type: 'toggle' })
    if (option.type === 'effort' && Array.isArray(option.values)) {
      const values = option.values.filter(isReasoningEffort)
      if (values.length) options.push({ type: 'effort', values })
    }
    if (option.type === 'budget_tokens') {
      options.push({
        type: 'budget_tokens',
        ...(typeof option.min === 'number' ? { min: option.min } : {}),
        ...(typeof option.max === 'number' ? { max: option.max } : {})
      })
    }
  }
  return options
}

function isReasoningEffort(value: unknown): value is AIRouterReasoningEffort {
  return (
    typeof value === 'string' &&
    ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value)
  )
}

function toChunk(part: unknown): AIRouterTextChunk | null {
  if (!part || typeof part !== 'object') return null
  const value = part as {
    type?: unknown
    text?: unknown
    textDelta?: unknown
    delta?: unknown
  }
  const delta =
    typeof value.text === 'string'
      ? value.text
      : typeof value.textDelta === 'string'
        ? value.textDelta
        : value.delta
  if (typeof delta !== 'string' || !delta) return null
  if (value.type === 'reasoning-delta') return { type: 'reasoning', delta }
  if (value.type === 'text-delta' || value.type === 'text') return { type: 'output', delta }
  return null
}

function isStreamError(part: unknown): part is { error: unknown } {
  return Boolean(part && typeof part === 'object' && (part as { type?: unknown }).type === 'error')
}

function streamFinishReason(part: unknown): string | null {
  if (!part || typeof part !== 'object') return null
  const value = part as { type?: unknown; finishReason?: unknown }
  if (value.type !== 'finish' && value.type !== 'finish-step') return null
  return typeof value.finishReason === 'string' ? value.finishReason : null
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
