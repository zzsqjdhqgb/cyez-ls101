import { airouterClient, type AIRouterClient } from '@ls101/airouter/renderer'
import type { AIRouterGeneratedImage } from '@ls101/airouter/shared'
import {
  manualImageGenerationCoordinator,
  type ManualImageGenerationCoordinator
} from './ManualImageGeneration'

export interface ConfiguredImageGenerator {
  generate(prompt: string, options?: { signal?: AbortSignal }): Promise<AIRouterGeneratedImage>
}

export function createConfiguredImageGenerator(
  client: AIRouterClient = airouterClient,
  manual: ManualImageGenerationCoordinator = manualImageGenerationCoordinator
): ConfiguredImageGenerator {
  return {
    async generate(prompt, options = {}) {
      const settings = await client.getImageGenerationSettings()
      if (settings.mode === 'manual') return manual.generate(prompt, options)
      return client.generateImage(
        {
          providerConfigId: settings.providerConfigId,
          modelId: settings.modelId,
          prompt
        },
        options
      )
    }
  }
}

export const configuredImageGenerator = createConfiguredImageGenerator()
