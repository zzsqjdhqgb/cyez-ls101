export type AIRouterProviderType = 'openai-compatible' | 'anthropic'

export interface AIRouterModelConfig {
  id: string
  enabled: boolean
}

export interface AIRouterProviderConfig {
  id: string
  name: string
  type: AIRouterProviderType
  baseUrl: string
  models: AIRouterModelConfig[]
}

export interface AIRouterProviderConfigInput {
  id?: string
  name: string
  type: AIRouterProviderType
  baseUrl?: string
  models: AIRouterModelConfig[]
  apiKey?: string
  clearApiKey?: boolean
}

export interface AIRouterProviderConfigSummary extends AIRouterProviderConfig {
  hasApiKey: boolean
}

export interface AIRouterModelOption {
  id: string
  name?: string
}

export interface AIRouterTextRequest {
  providerConfigId: string
  modelId: string
  prompt: string
}

export type AIRouterTextChunk =
  | { type: 'reasoning'; delta: string }
  | { type: 'output'; delta: string }

export type AIRouterStreamEvent =
  | { type: 'chunk'; chunk: AIRouterTextChunk }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface AIRouterTestResult {
  ok: true
  text: string
}

export interface AIRouterConnectionTestInput {
  config: AIRouterProviderConfigInput
  modelId: string
}

export interface AIRouterClient {
  listProviderConfigs(): Promise<AIRouterProviderConfigSummary[]>
  saveProviderConfig(config: AIRouterProviderConfigInput): Promise<AIRouterProviderConfigSummary>
  deleteProviderConfig(id: string): Promise<void>
  readProviderApiKey(id: string): Promise<string | null>
  listModels(config: AIRouterProviderConfigInput): Promise<AIRouterModelOption[]>
  testConnection(request: AIRouterConnectionTestInput): Promise<AIRouterTestResult>
  generateText(
    request: AIRouterTextRequest,
    options?: { signal?: AbortSignal }
  ): AsyncIterable<AIRouterTextChunk>
}

export interface AIRouterBridge {
  listProviderConfigs(): Promise<AIRouterProviderConfigSummary[]>
  saveProviderConfig(config: AIRouterProviderConfigInput): Promise<AIRouterProviderConfigSummary>
  deleteProviderConfig(id: string): Promise<void>
  readProviderApiKey(id: string): Promise<string | null>
  listModels(config: AIRouterProviderConfigInput): Promise<AIRouterModelOption[]>
  testConnection(request: AIRouterConnectionTestInput): Promise<AIRouterTestResult>
  startTextGeneration(
    request: AIRouterTextRequest,
    listener: (event: AIRouterStreamEvent) => void
  ): () => void
}
