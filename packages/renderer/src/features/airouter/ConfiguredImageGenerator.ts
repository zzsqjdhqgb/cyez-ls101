import { airouterClient, type AIRouterClient } from '@ls101/airouter/renderer'
import type {
  InterfaceImageGenerator,
  InterfaceImageProviderOption,
  InterfaceImageProviderSelection
} from '@ls101/interface-editor'
import {
  manualImageGenerationCoordinator,
  type ManualImageGenerationCoordinator
} from './ManualImageGeneration'

export interface ConfiguredImageGenerator extends InterfaceImageGenerator {}

export function createConfiguredImageGenerator(
  client: AIRouterClient = airouterClient,
  manual: ManualImageGenerationCoordinator = manualImageGenerationCoordinator
): ConfiguredImageGenerator {
  return {
    async listProviders(): Promise<readonly InterfaceImageProviderOption[]> {
      return listImageProviderOptions(await client.listImageProviderConfigs())
    },
    async generate(prompt, options) {
      const configs = await client.listImageProviderConfigs()
      const providers = listImageProviderOptions(configs)
      const selected = options.provider
        ? findImageProvider(providers, options.provider)
        : providers[0]
      if (!selected) throw new Error('所选图像 Provider 未配置或未启用')
      const config = configs.find((candidate) => candidate.id === selected.providerId)
      if (!config) throw new Error('所选图像 Provider 不存在')
      const generationOptions = { signal: options.signal }
      if (config.type === 'manual') return manual.generate(prompt, generationOptions)
      if (!selected.modelId) throw new Error('所选图像 Provider 未选择模型')
      return client.generateImage(
        {
          providerConfigId: selected.providerId,
          modelId: selected.modelId,
          prompt
        },
        generationOptions
      )
    }
  }
}

function listImageProviderOptions(
  configs: Awaited<ReturnType<AIRouterClient['listImageProviderConfigs']>>
): InterfaceImageProviderOption[] {
  return configs.flatMap((config) =>
    config.type === 'manual'
      ? [{ providerId: config.id, providerName: config.name }]
      : config.models
          .filter(({ enabled }) => enabled)
          .map(({ id }) => ({ providerId: config.id, providerName: config.name, modelId: id }))
  )
}

function findImageProvider(
  options: readonly InterfaceImageProviderOption[],
  requested: InterfaceImageProviderSelection
): InterfaceImageProviderOption | undefined {
  return options.find(
    (option) => option.providerId === requested.providerId && option.modelId === requested.modelId
  )
}

export const configuredImageGenerator = createConfiguredImageGenerator()
