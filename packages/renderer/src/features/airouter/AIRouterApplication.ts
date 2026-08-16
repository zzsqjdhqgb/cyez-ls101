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
  AIRouterSpeechTestResult,
  AIRouterSpeechVoiceListInput,
  AIRouterSpeechVoiceOption,
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
    testSpeechConnection: (request) => client.testSpeechConnection(request)
  }
}

export const airouterApplication = createAIRouterApplication()
