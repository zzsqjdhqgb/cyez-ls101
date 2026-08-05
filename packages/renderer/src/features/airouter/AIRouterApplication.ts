import { airouterClient, type AIRouterClient } from '@ls101/airouter/renderer'
import type {
  AIRouterImageProviderConfigInput,
  AIRouterImageProviderConfigSummary,
  AIRouterImageTestResult,
  AIRouterModelOption,
  AIRouterProviderConfigInput,
  AIRouterProviderConfigSummary,
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
    testImageConnection: (config, modelId) => client.testImageConnection({ config, modelId })
  }
}

export const airouterApplication = createAIRouterApplication()
