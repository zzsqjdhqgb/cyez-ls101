import { airouterClient, type AIRouterClient } from '@ls101/airouter/renderer'
import type {
  AIRouterImageProviderConfigInput,
  AIRouterImageProviderConfigSummary,
  AIRouterImageTestResult,
  AIRouterModelOption,
  AIRouterProviderConfigInput,
  AIRouterProviderConfigSummary,
  AIRouterSpeechConnectionTestInput,
  AIRouterSpeechModelOption,
  AIRouterSpeechModelPackageImportResult,
  AIRouterSpeechModelPackageSummary,
  AIRouterSpeechProviderConfigInput,
  AIRouterSpeechProviderConfigSummary,
  AIRouterSpeechProviderType,
  AIRouterQwenTtsCudaProbeResult,
  AIRouterSpeechRecognitionModelOption,
  AIRouterSpeechRecognitionModelPackageImportResult,
  AIRouterSpeechRecognitionModelPackageSummary,
  AIRouterSpeechRecognitionProviderConfigInput,
  AIRouterSpeechRecognitionProviderConfigSummary,
  AIRouterSpeechRecognitionProviderType,
  AIRouterSpeechTestResult,
  AIRouterSpeechVoiceListInput,
  AIRouterSpeechVoiceOption,
  AIRouterPronunciationAssessmentExtensionImportResult,
  AIRouterPronunciationAssessmentExtensionStatus,
  AIRouterTestResult
} from '@ls101/airouter/shared'

export interface AIRouterApplication {
  listConfigs(): Promise<AIRouterProviderConfigSummary[]>
  saveConfig(config: AIRouterProviderConfigInput): Promise<AIRouterProviderConfigSummary>
  deleteConfig(id: string): Promise<void>
  readApiKey(id: string): Promise<string | null>
  listModels(config: AIRouterProviderConfigInput): Promise<AIRouterModelOption[]>
  testConnection(config: AIRouterProviderConfigInput, modelId: string): Promise<AIRouterTestResult>
  listImageConfigs(): Promise<AIRouterImageProviderConfigSummary[]>
  saveImageConfig(
    config: AIRouterImageProviderConfigInput
  ): Promise<AIRouterImageProviderConfigSummary>
  deleteImageConfig(id: string): Promise<void>
  readImageApiKey(id: string): Promise<string | null>
  listImageModels(config: AIRouterImageProviderConfigInput): Promise<AIRouterModelOption[]>
  testImageConnection(
    config: AIRouterImageProviderConfigInput,
    modelId: string
  ): Promise<AIRouterImageTestResult>
  listSpeechConfigs(): Promise<AIRouterSpeechProviderConfigSummary[]>
  saveSpeechConfig(
    config: AIRouterSpeechProviderConfigInput
  ): Promise<AIRouterSpeechProviderConfigSummary>
  deleteSpeechConfig(id: string): Promise<void>
  readSpeechApiKey(id: string): Promise<string | null>
  listSpeechPackages(
    providerType?: AIRouterSpeechProviderType
  ): Promise<AIRouterSpeechModelPackageSummary[]>
  importSpeechPackage(): Promise<AIRouterSpeechModelPackageImportResult | null>
  deleteSpeechPackage(id: string, version: string): Promise<void>
  listSpeechModels(config: AIRouterSpeechProviderConfigInput): Promise<AIRouterSpeechModelOption[]>
  listSpeechVoices(request: AIRouterSpeechVoiceListInput): Promise<AIRouterSpeechVoiceOption[]>
  testSpeechConnection(
    request: AIRouterSpeechConnectionTestInput
  ): Promise<AIRouterSpeechTestResult>
  probeQwenTtsCuda(): Promise<AIRouterQwenTtsCudaProbeResult>
  getPronunciationExtensionStatus(): Promise<AIRouterPronunciationAssessmentExtensionStatus>
  importPronunciationExtension(): Promise<AIRouterPronunciationAssessmentExtensionImportResult | null>
  deletePronunciationExtension(): Promise<void>
  listSpeechRecognitionConfigs(): Promise<AIRouterSpeechRecognitionProviderConfigSummary[]>
  saveSpeechRecognitionConfig(
    config: AIRouterSpeechRecognitionProviderConfigInput
  ): Promise<AIRouterSpeechRecognitionProviderConfigSummary>
  deleteSpeechRecognitionConfig(id: string): Promise<void>
  readSpeechRecognitionApiKey(id: string): Promise<string | null>
  listSpeechRecognitionPackages(
    providerType?: AIRouterSpeechRecognitionProviderType
  ): Promise<AIRouterSpeechRecognitionModelPackageSummary[]>
  importSpeechRecognitionPackage(): Promise<AIRouterSpeechRecognitionModelPackageImportResult | null>
  deleteSpeechRecognitionPackage(id: string, version: string): Promise<void>
  listSpeechRecognitionModels(
    config: AIRouterSpeechRecognitionProviderConfigInput
  ): Promise<AIRouterSpeechRecognitionModelOption[]>
}

export function createAIRouterApplication(
  client: AIRouterClient = airouterClient
): AIRouterApplication {
  return {
    listConfigs: () => client.listProviderConfigs(),
    saveConfig: (config) => client.saveProviderConfig(config),
    deleteConfig: (id) => client.deleteProviderConfig(id),
    readApiKey: (id) => client.readProviderApiKey(id),
    listModels: (config) => client.listModels(config),
    testConnection: (config, modelId) => client.testConnection({ config, modelId }),
    listImageConfigs: () => client.listImageProviderConfigs(),
    saveImageConfig: (config) => client.saveImageProviderConfig(config),
    deleteImageConfig: (id) => client.deleteImageProviderConfig(id),
    readImageApiKey: (id) => client.readImageProviderApiKey(id),
    listImageModels: (config) => client.listImageModels(config),
    testImageConnection: (config, modelId) => client.testImageConnection({ config, modelId }),
    listSpeechConfigs: () => client.listSpeechProviderConfigs(),
    saveSpeechConfig: (config) => client.saveSpeechProviderConfig(config),
    deleteSpeechConfig: (id) => client.deleteSpeechProviderConfig(id),
    readSpeechApiKey: (id) => client.readSpeechProviderApiKey(id),
    listSpeechPackages: (providerType) => client.listSpeechModelPackages(providerType),
    importSpeechPackage: () => client.importSpeechModelPackage(),
    deleteSpeechPackage: (id, version) => client.deleteSpeechModelPackage(id, version),
    listSpeechModels: (config) => client.listSpeechModels(config),
    listSpeechVoices: (request) => client.listSpeechVoices(request),
    testSpeechConnection: (request) => client.testSpeechConnection(request),
    probeQwenTtsCuda: () => client.probeQwenTtsCuda(),
    getPronunciationExtensionStatus: () => client.getPronunciationAssessmentExtensionStatus(),
    importPronunciationExtension: () => client.importPronunciationAssessmentExtension(),
    deletePronunciationExtension: () => client.deletePronunciationAssessmentExtension(),
    listSpeechRecognitionConfigs: () => client.listSpeechRecognitionProviderConfigs(),
    saveSpeechRecognitionConfig: (config) => client.saveSpeechRecognitionProviderConfig(config),
    deleteSpeechRecognitionConfig: (id) => client.deleteSpeechRecognitionProviderConfig(id),
    readSpeechRecognitionApiKey: (id) => client.readSpeechRecognitionProviderApiKey(id),
    listSpeechRecognitionPackages: (providerType) =>
      client.listSpeechRecognitionModelPackages(providerType),
    importSpeechRecognitionPackage: () => client.importSpeechRecognitionModelPackage(),
    deleteSpeechRecognitionPackage: (id, version) =>
      client.deleteSpeechRecognitionModelPackage(id, version),
    listSpeechRecognitionModels: (config) => client.listSpeechRecognitionProviderModels(config)
  }
}

export const airouterApplication = createAIRouterApplication()
