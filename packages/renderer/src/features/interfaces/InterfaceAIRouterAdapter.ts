import { airouterClient, type AIRouterClient } from '@ls101/airouter/renderer'
import type { InterfaceTextGenerator } from '@ls101/interface-editor'

export function createInterfaceAIRouterTextGenerator(
  client: AIRouterClient = airouterClient
): InterfaceTextGenerator {
  return {
    async *generate(prompt, { signal }) {
      const configs = await client.listProviderConfigs()
      if (signal.aborted) return

      for (const config of configs) {
        const model = config.models.find(({ enabled }) => enabled)
        if (!model) continue
        yield* client.generateText(
          {
            providerConfigId: config.id,
            modelId: model.id,
            prompt
          },
          { signal }
        )
        return
      }

      throw new Error('请先在 AI 引擎设置中启用至少一个文本模型')
    }
  }
}
