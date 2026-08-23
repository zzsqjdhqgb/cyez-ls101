export type AIRouterProviderType = 'openai-compatible' | 'anthropic'
export type AIRouterImageProviderType = 'manual' | 'openai-compatible'
export type AIRouterSpeechProviderType = 'openai-compatible' | 'pocket-tts' | 'qwen-tts'
export type AIRouterLocalSpeechProviderType = Exclude<
  AIRouterSpeechProviderType,
  'openai-compatible'
>
export type AIRouterSpeechProviderKind = 'online' | 'local'
export type AIRouterQwenTtsBackend = 'cpu' | 'cuda'
export type AIRouterSpeechRole = 'default' | 'man' | 'woman'
export type AIRouterSpeechAudioFormat = 'wav' | 'mp3' | 'opus' | 'pcm-s16le'

export type AIRouterSpeechRecognitionProviderType = 'openai-compatible' | 'qwen3-asr'
export type AIRouterLocalSpeechRecognitionProviderType = Exclude<
  AIRouterSpeechRecognitionProviderType,
  'openai-compatible'
>
export type AIRouterSpeechRecognitionProviderKind = 'online' | 'local'

export interface AIRouterSpeechRecognitionProviderConfig {
  id: string
  name: string
  kind: AIRouterSpeechRecognitionProviderKind
  type: AIRouterSpeechRecognitionProviderType
  baseUrl: string
  modelPackageId: string
  modelPackageVersion: string
  models: AIRouterModelConfig[]
}

export interface AIRouterSpeechRecognitionProviderConfigInput {
  id?: string
  name: string
  kind: AIRouterSpeechRecognitionProviderKind
  type: AIRouterSpeechRecognitionProviderType
  baseUrl?: string
  modelPackageId?: string
  modelPackageVersion?: string
  models: AIRouterModelConfig[]
  apiKey?: string
  clearApiKey?: boolean
}

export interface AIRouterSpeechRecognitionProviderConfigSummary extends AIRouterSpeechRecognitionProviderConfig {
  hasApiKey: boolean
}

export interface AIRouterSpeechRecognitionModelOption {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
}

export interface AIRouterSpeechRecognitionModelPackageRuntime {
  engine: AIRouterLocalSpeechRecognitionProviderType
  engineApiVersion: number
  minimumAppVersion?: string
}

export interface AIRouterSpeechRecognitionModelPackageManifest {
  format: 'ls101.asr-model-package'
  formatVersion: 1
  package: AIRouterSpeechModelPackageInfo
  runtime: AIRouterSpeechRecognitionModelPackageRuntime
  assets: AIRouterSpeechModelPackageAsset[]
  models: AIRouterSpeechModelPackageModel[]
  extensions?: Record<string, unknown>
}

export interface AIRouterSpeechRecognitionModelPackageSummary {
  package: AIRouterSpeechModelPackageInfo
  runtime: AIRouterSpeechRecognitionModelPackageRuntime
  models: AIRouterSpeechModelPackageModel[]
  assetCount: number
  totalBytes: number
}

export interface AIRouterSpeechRecognitionModelPackageImportResult {
  package: AIRouterSpeechRecognitionModelPackageSummary
  reusedAssetCount: number
  storedAssetCount: number
}

export interface AIRouterSpeechRecognitionRequest {
  providerConfigId: string
  modelId: string
  audio: {
    data: Uint8Array
    mediaType: string
    filename?: string
  }
}

export interface AIRouterSpeechRecognitionResult {
  text: string
}

export type AIRouterSpeechRecognitionEvent =
  | { type: 'result'; result: AIRouterSpeechRecognitionResult }
  | { type: 'error'; message: string }

export interface AIRouterPronunciationAssessmentModelOption {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
}

export type AIRouterExtensionImportState = 'imported' | 'not-imported'

export interface AIRouterPronunciationAssessmentExtensionStatus {
  extensionId: string
  requiredVersion: string
  name: string
  state: AIRouterExtensionImportState
  installedVersion?: string
  assetCount?: number
  totalBytes?: number
}

export interface AIRouterPronunciationAssessmentExtensionImportResult {
  extensionId: string
  version: string
  assetCount: number
  totalBytes: number
}

export interface AIRouterPronunciationAssessmentRequest {
  providerConfigId: string
  modelId: string
  referenceText: string
  audio: {
    data: Uint8Array
    mediaType: string
    filename?: string
  }
}

export interface AIRouterPronunciationPhoneAssessment {
  index: number
  word_index: number
  phone_index: number
  word: string
  expected: string
  expected_ipa: string
  acoustic_winner: string
  acoustic_winner_ipa: string
  best_alternative: string
  best_alternative_ipa: string
  expected_log_p: number
  alternative_log_p: number
  gop_log_ratio: number
  confidence: number
  start_ms: number
  end_ms: number
}

export interface AIRouterPronunciationWordAssessment {
  word_index: number
  text: string
  expected_arpabet: string[]
  expected_ipa: string[]
  start_ms: number
  end_ms: number
  phones: AIRouterPronunciationPhoneAssessment[]
}

export interface AIRouterPronunciationAssessmentResult {
  schema_version: 2
  reference_text: string
  audio_duration_ms: number
  frame_count: number
  recognized_phones: string[]
  recognized_phones_ipa: string[]
  gop_method: 'viterbi'
  alignment_path_score: number
  acoustic_model: string
  acoustic_phone_inventory: string
  reference_source: string
  dictionary_source: string
  phones: AIRouterPronunciationPhoneAssessment[]
  words: AIRouterPronunciationWordAssessment[]
}

export type AIRouterPronunciationAssessmentEvent =
  | { type: 'result'; result: AIRouterPronunciationAssessmentResult }
  | { type: 'error'; message: string }

export type AIRouterReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export type AIRouterReasoningOption =
  | { type: 'toggle' }
  | { type: 'effort'; values: AIRouterReasoningEffort[] }
  | { type: 'budget_tokens'; min?: number; max?: number }

export type AIRouterReasoningConfig =
  | { type: 'disabled' }
  | { type: 'enabled' }
  | { type: 'effort'; effort: AIRouterReasoningEffort }
  | { type: 'budget_tokens'; budgetTokens: number }

export interface AIRouterModelMetadata {
  name?: string
  contextLimit?: number
  outputLimit?: number
  reasoning?: boolean
  reasoningOptions?: AIRouterReasoningOption[]
  structuredOutput?: boolean
  attachment?: boolean
}

export interface AIRouterModelConfig {
  id: string
  enabled: boolean
  maxOutputTokens?: number
  reasoning?: AIRouterReasoningConfig
  metadata?: AIRouterModelMetadata
}

export interface AIRouterProviderConfig {
  id: string
  name: string
  type: AIRouterProviderType
  catalogProviderId?: string
  baseUrl: string
  models: AIRouterModelConfig[]
}

export interface AIRouterProviderConfigInput {
  id?: string
  name: string
  type: AIRouterProviderType
  catalogProviderId?: string
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

export interface AIRouterModelOption extends AIRouterModelMetadata {
  id: string
}

export interface AIRouterTextRequest {
  providerConfigId: string
  modelId: string
  prompt: string
  systemPrompt?: string
  temperature?: number
  maxOutputTokens?: number
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

export type AIRouterImageGenerationEvent =
  | { type: 'result'; image: AIRouterGeneratedImage }
  | { type: 'error'; message: string }

export interface AIRouterSpeechVoiceConfig {
  id: string
  enabled: boolean
}

export interface AIRouterSpeechProviderConfig {
  id: string
  name: string
  kind: AIRouterSpeechProviderKind
  type: AIRouterSpeechProviderType
  baseUrl: string
  modelPackageId: string
  modelPackageVersion: string
  models: AIRouterModelConfig[]
  voices: AIRouterSpeechVoiceConfig[]
  backend?: AIRouterQwenTtsBackend
}

export interface AIRouterSpeechProviderConfigInput {
  id?: string
  name: string
  kind: AIRouterSpeechProviderKind
  type: AIRouterSpeechProviderType
  baseUrl?: string
  modelPackageId?: string
  modelPackageVersion?: string
  models: AIRouterModelConfig[]
  voices: AIRouterSpeechVoiceConfig[]
  backend?: AIRouterQwenTtsBackend
  apiKey?: string
  clearApiKey?: boolean
}

export interface AIRouterSpeechProviderConfigSummary extends AIRouterSpeechProviderConfig {
  hasApiKey: boolean
}

export interface AIRouterSpeechVoiceOption {
  id: string
  name?: string
  languageCodes?: string[]
}

export interface AIRouterSpeechModelOption extends AIRouterModelOption {
  languageCodes?: string[]
}

export interface AIRouterSpeechModelPackageAsset {
  path: string
  kind: string
  size: number
  sha256: string
}

export interface AIRouterSpeechModelPackageRuntime {
  engine: AIRouterLocalSpeechProviderType
  engineApiVersion: number
  minimumAppVersion?: string
}

export interface AIRouterSpeechModelPackageInfo {
  id: string
  version: string
  name: string
  description?: string
}

export interface AIRouterSpeechModelPackageModel {
  id: string
  name: string
  languageCodes?: string[]
  artifacts: Record<string, string[]>
  parameters: Record<string, unknown>
}

export interface AIRouterSpeechModelPackageVoice {
  id: string
  name: string
  languageCodes?: string[]
  files: string[]
}

export interface AIRouterSpeechModelPackageManifest {
  format: 'ls101.tts-model-package'
  formatVersion: 1
  package: AIRouterSpeechModelPackageInfo
  runtime: AIRouterSpeechModelPackageRuntime
  assets: AIRouterSpeechModelPackageAsset[]
  models: AIRouterSpeechModelPackageModel[]
  voices: AIRouterSpeechModelPackageVoice[]
  extensions?: Record<string, unknown>
}

export interface AIRouterSpeechInstalledAsset extends AIRouterSpeechModelPackageAsset {
  blob: string
}

export interface AIRouterSpeechModelPackageSummary {
  package: AIRouterSpeechModelPackageInfo
  runtime: AIRouterSpeechModelPackageRuntime
  models: AIRouterSpeechModelPackageModel[]
  voices: AIRouterSpeechModelPackageVoice[]
  assetCount: number
  totalBytes: number
}

export interface AIRouterSpeechModelPackageImportResult {
  package: AIRouterSpeechModelPackageSummary
  reusedAssetCount: number
  storedAssetCount: number
}

export interface AIRouterSpeechTarget {
  providerConfigId: string
  modelId: string
  voiceId: string
}

export interface AIRouterSpeechRouting {
  default: AIRouterSpeechTarget
  man?: AIRouterSpeechTarget
  woman?: AIRouterSpeechTarget
}

export interface AIRouterSpeechSynthesisRequest {
  text: string
  routing: AIRouterSpeechRouting
  format?: AIRouterSpeechAudioFormat
}

export interface AIRouterSpeechSegment {
  role: AIRouterSpeechRole
  text: string
}

export interface AIRouterGeneratedAudio {
  data: Uint8Array
  mediaType: string
  format: AIRouterSpeechAudioFormat
  sampleRate?: number
  channels?: number
  durationMs?: number
}

export interface AIRouterSpeechConnectionTestInput {
  config: AIRouterSpeechProviderConfigInput
  modelId: string
  voiceId?: string
}

export interface AIRouterSpeechTestResult {
  ok: true
  audio: AIRouterGeneratedAudio
}

export interface AIRouterQwenTtsCudaProbeResult {
  available: boolean
  device?: string
  description?: string
  memoryFree?: number
  memoryTotal?: number
  message?: string
}

export interface AIRouterSpeechVoiceListInput {
  config: AIRouterSpeechProviderConfigInput
  modelId: string
}

export type AIRouterSpeechSynthesisEvent =
  | { type: 'result'; audio: AIRouterGeneratedAudio }
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
  testImageConnection(request: AIRouterImageConnectionTestInput): Promise<AIRouterImageTestResult>
  listSpeechProviderConfigs(): Promise<AIRouterSpeechProviderConfigSummary[]>
  saveSpeechProviderConfig(
    config: AIRouterSpeechProviderConfigInput
  ): Promise<AIRouterSpeechProviderConfigSummary>
  deleteSpeechProviderConfig(id: string): Promise<void>
  readSpeechProviderApiKey(id: string): Promise<string | null>
  listSpeechModelPackages(
    providerType?: AIRouterSpeechProviderType
  ): Promise<AIRouterSpeechModelPackageSummary[]>
  importSpeechModelPackage(): Promise<AIRouterSpeechModelPackageImportResult | null>
  deleteSpeechModelPackage(id: string, version: string): Promise<void>
  listSpeechModels(config: AIRouterSpeechProviderConfigInput): Promise<AIRouterSpeechModelOption[]>
  listSpeechVoices(request: AIRouterSpeechVoiceListInput): Promise<AIRouterSpeechVoiceOption[]>
  testSpeechConnection(
    request: AIRouterSpeechConnectionTestInput
  ): Promise<AIRouterSpeechTestResult>
  probeQwenTtsCuda(): Promise<AIRouterQwenTtsCudaProbeResult>
  listSpeechRecognitionProviderConfigs(): Promise<AIRouterSpeechRecognitionProviderConfigSummary[]>
  saveSpeechRecognitionProviderConfig(
    config: AIRouterSpeechRecognitionProviderConfigInput
  ): Promise<AIRouterSpeechRecognitionProviderConfigSummary>
  deleteSpeechRecognitionProviderConfig(id: string): Promise<void>
  readSpeechRecognitionProviderApiKey(id: string): Promise<string | null>
  listSpeechRecognitionModelPackages(
    providerType?: AIRouterSpeechRecognitionProviderType
  ): Promise<AIRouterSpeechRecognitionModelPackageSummary[]>
  importSpeechRecognitionModelPackage(): Promise<AIRouterSpeechRecognitionModelPackageImportResult | null>
  deleteSpeechRecognitionModelPackage(id: string, version: string): Promise<void>
  listSpeechRecognitionProviderModels(
    config: AIRouterSpeechRecognitionProviderConfigInput
  ): Promise<AIRouterSpeechRecognitionModelOption[]>
  listSpeechRecognitionModels(): Promise<AIRouterSpeechRecognitionModelOption[]>
  recognizeSpeech(
    request: AIRouterSpeechRecognitionRequest,
    options?: { signal?: AbortSignal }
  ): Promise<AIRouterSpeechRecognitionResult>
  listPronunciationAssessmentModels(): Promise<AIRouterPronunciationAssessmentModelOption[]>
  getPronunciationAssessmentExtensionStatus(): Promise<AIRouterPronunciationAssessmentExtensionStatus>
  importPronunciationAssessmentExtension(): Promise<AIRouterPronunciationAssessmentExtensionImportResult | null>
  deletePronunciationAssessmentExtension(): Promise<void>
  assessPronunciation(
    request: AIRouterPronunciationAssessmentRequest,
    options?: { signal?: AbortSignal }
  ): Promise<AIRouterPronunciationAssessmentResult>
  synthesizeSpeech(
    request: AIRouterSpeechSynthesisRequest,
    options?: { signal?: AbortSignal }
  ): Promise<AIRouterGeneratedAudio>
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
  testImageConnection(request: AIRouterImageConnectionTestInput): Promise<AIRouterImageTestResult>
  listSpeechProviderConfigs(): Promise<AIRouterSpeechProviderConfigSummary[]>
  saveSpeechProviderConfig(
    config: AIRouterSpeechProviderConfigInput
  ): Promise<AIRouterSpeechProviderConfigSummary>
  deleteSpeechProviderConfig(id: string): Promise<void>
  readSpeechProviderApiKey(id: string): Promise<string | null>
  listSpeechModelPackages(
    providerType?: AIRouterSpeechProviderType
  ): Promise<AIRouterSpeechModelPackageSummary[]>
  importSpeechModelPackage(): Promise<AIRouterSpeechModelPackageImportResult | null>
  deleteSpeechModelPackage(id: string, version: string): Promise<void>
  listSpeechModels(config: AIRouterSpeechProviderConfigInput): Promise<AIRouterSpeechModelOption[]>
  listSpeechVoices(request: AIRouterSpeechVoiceListInput): Promise<AIRouterSpeechVoiceOption[]>
  testSpeechConnection(
    request: AIRouterSpeechConnectionTestInput
  ): Promise<AIRouterSpeechTestResult>
  probeQwenTtsCuda(): Promise<AIRouterQwenTtsCudaProbeResult>
  listSpeechRecognitionProviderConfigs(): Promise<AIRouterSpeechRecognitionProviderConfigSummary[]>
  saveSpeechRecognitionProviderConfig(
    config: AIRouterSpeechRecognitionProviderConfigInput
  ): Promise<AIRouterSpeechRecognitionProviderConfigSummary>
  deleteSpeechRecognitionProviderConfig(id: string): Promise<void>
  readSpeechRecognitionProviderApiKey(id: string): Promise<string | null>
  listSpeechRecognitionModelPackages(
    providerType?: AIRouterSpeechRecognitionProviderType
  ): Promise<AIRouterSpeechRecognitionModelPackageSummary[]>
  importSpeechRecognitionModelPackage(): Promise<AIRouterSpeechRecognitionModelPackageImportResult | null>
  deleteSpeechRecognitionModelPackage(id: string, version: string): Promise<void>
  listSpeechRecognitionProviderModels(
    config: AIRouterSpeechRecognitionProviderConfigInput
  ): Promise<AIRouterSpeechRecognitionModelOption[]>
  listSpeechRecognitionModels(): Promise<AIRouterSpeechRecognitionModelOption[]>
  startSpeechRecognition(
    request: AIRouterSpeechRecognitionRequest,
    listener: (event: AIRouterSpeechRecognitionEvent) => void
  ): () => void
  listPronunciationAssessmentModels(): Promise<AIRouterPronunciationAssessmentModelOption[]>
  getPronunciationAssessmentExtensionStatus(): Promise<AIRouterPronunciationAssessmentExtensionStatus>
  importPronunciationAssessmentExtension(): Promise<AIRouterPronunciationAssessmentExtensionImportResult | null>
  deletePronunciationAssessmentExtension(): Promise<void>
  startPronunciationAssessment(
    request: AIRouterPronunciationAssessmentRequest,
    listener: (event: AIRouterPronunciationAssessmentEvent) => void
  ): () => void
  startSpeechSynthesis(
    request: AIRouterSpeechSynthesisRequest,
    listener: (event: AIRouterSpeechSynthesisEvent) => void
  ): () => void
  startTextGeneration(
    request: AIRouterTextRequest,
    listener: (event: AIRouterStreamEvent) => void
  ): () => void
  startImageGeneration(
    request: AIRouterImageRequest,
    listener: (event: AIRouterImageGenerationEvent) => void
  ): () => void
}
