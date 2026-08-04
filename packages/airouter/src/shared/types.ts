export type AIRouterProviderType = 'openai-compatible' | 'anthropic'
export type AIRouterImageProviderType = 'openai-compatible'

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

export interface AIRouterImageProviderConfig {
  id: string
  name: string
  type: AIRouterImageProviderType
  baseUrl: string
  models: AIRouterModelConfig[]
}

export interface AIRouterImageProviderConfigInput {
  id?: string
  name: string
  type: AIRouterImageProviderType
  baseUrl?: string
  models: AIRouterModelConfig[]
  apiKey?: string
  clearApiKey?: boolean
}

export interface AIRouterImageProviderConfigSummary extends AIRouterImageProviderConfig {
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

export interface AIRouterGeneratedImage {
  data: Uint8Array
  mediaType: string
}

export interface AIRouterImageRequest {
  providerConfigId: string
  modelId: string
  prompt: string
  size?: { width: number; height: number }
}

export interface AIRouterImageConnectionTestInput {
  config: AIRouterImageProviderConfigInput
  modelId: string
}

export interface AIRouterImageTestResult {
  ok: true
  image: AIRouterGeneratedImage
}

export type AIRouterImageGenerationSettings =
  | { mode: 'manual' }
  | { mode: 'provider'; providerConfigId: string; modelId: string }

export type AIRouterImageGenerationEvent =
  | { type: 'result'; image: AIRouterGeneratedImage }
  | { type: 'error'; message: string }

export interface AIRouterClient {
  listProviderConfigs(): Promise<AIRouterProviderConfigSummary[]>
  saveProviderConfig(config: AIRouterProviderConfigInput): Promise<AIRouterProviderConfigSummary>
  deleteProviderConfig(id: string): Promise<void>
  readProviderApiKey(id: string): Promise<string | null>
  listModels(config: AIRouterProviderConfigInput): Promise<AIRouterModelOption[]>
  testConnection(request: AIRouterConnectionTestInput): Promise<AIRouterTestResult>
  listImageProviderConfigs(): Promise<AIRouterImageProviderConfigSummary[]>
  saveImageProviderConfig(
    config: AIRouterImageProviderConfigInput
  ): Promise<AIRouterImageProviderConfigSummary>
  deleteImageProviderConfig(id: string): Promise<void>
  readImageProviderApiKey(id: string): Promise<string | null>
  listImageModels(config: AIRouterImageProviderConfigInput): Promise<AIRouterModelOption[]>
  getImageGenerationSettings(): Promise<AIRouterImageGenerationSettings>
  saveImageGenerationSettings(
    settings: AIRouterImageGenerationSettings
  ): Promise<AIRouterImageGenerationSettings>
  testImageConnection(request: AIRouterImageConnectionTestInput): Promise<AIRouterImageTestResult>
  generateImage(
    request: AIRouterImageRequest,
    options?: { signal?: AbortSignal }
  ): Promise<AIRouterGeneratedImage>
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
  listImageProviderConfigs(): Promise<AIRouterImageProviderConfigSummary[]>
  saveImageProviderConfig(
    config: AIRouterImageProviderConfigInput
  ): Promise<AIRouterImageProviderConfigSummary>
  deleteImageProviderConfig(id: string): Promise<void>
  readImageProviderApiKey(id: string): Promise<string | null>
  listImageModels(config: AIRouterImageProviderConfigInput): Promise<AIRouterModelOption[]>
  getImageGenerationSettings(): Promise<AIRouterImageGenerationSettings>
  saveImageGenerationSettings(
    settings: AIRouterImageGenerationSettings
  ): Promise<AIRouterImageGenerationSettings>
  testImageConnection(request: AIRouterImageConnectionTestInput): Promise<AIRouterImageTestResult>
  startTextGeneration(
    request: AIRouterTextRequest,
    listener: (event: AIRouterStreamEvent) => void
  ): () => void
  startImageGeneration(
    request: AIRouterImageRequest,
    listener: (event: AIRouterImageGenerationEvent) => void
  ): () => void
}
