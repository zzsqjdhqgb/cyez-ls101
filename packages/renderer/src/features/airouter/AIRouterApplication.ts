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
  listModels(id: string): Promise<AIRouterModelOption[]>
  testConnection(configId: string, modelId: string): Promise<AIRouterTestResult>
}

export function createAIRouterApplication(
  client: AIRouterClient = airouterClient
): AIRouterApplication {
  return {
    listConfigs: () => client.listProviderConfigs(),
    saveConfig: (config) => client.saveProviderConfig(config),
    deleteConfig: (id) => client.deleteProviderConfig(id),
    listModels: (id) => client.listModels(id),
    testConnection: (configId, modelId) =>
      client.testConnection({ providerConfigId: configId, modelId })
  }
}

export const airouterApplication = createAIRouterApplication()
