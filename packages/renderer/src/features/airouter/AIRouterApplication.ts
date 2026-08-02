import { airouterClient, type AIRouterClient } from '@ls101/airouter/renderer'
import type {
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
    testConnection: (config, modelId) => client.testConnection({ config, modelId })
  }
}

export const airouterApplication = createAIRouterApplication()
