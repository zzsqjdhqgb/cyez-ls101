import { airouterClient, type AIRouterClient } from '@ls101/airouter/renderer'
import type {
  InterfaceTextGenerator,
  InterfaceTextModelOption,
  InterfaceTextModelSelection
} from '@ls101/interface-editor'

export function createInterfaceAIRouterTextGenerator(
  client: AIRouterClient = airouterClient
): InterfaceTextGenerator {
  return {
    async listModels() {
      return listEnabledModels(await client.listProviderConfigs())
    },
    async *generate(prompt, { signal, model: requestedModel }) {
      const configs = await client.listProviderConfigs()
      if (signal.aborted) return

      const model = requestedModel
        ? findRequestedModel(configs, requestedModel)
        : listEnabledModels(configs)[0]
      if (!model) {
        throw new Error(
          requestedModel ? '所选文本模型未配置或未启用' : '请先在 AI 引擎设置中启用至少一个文本模型'
        )
      }

      yield* client.generateText(
        {
          providerConfigId: model.providerId,
          modelId: model.modelId,
          prompt
        },
        { signal }
      )
    }
  }
}

function listEnabledModels(
  configs: Awaited<ReturnType<AIRouterClient['listProviderConfigs']>>
): InterfaceTextModelOption[] {
  return configs.flatMap((config) =>
    config.models
      .filter(({ enabled }) => enabled)
      .map(({ id }) => ({
        providerId: config.id,
        providerName: config.name,
        modelId: id
      }))
  )
}

function findRequestedModel(
  configs: Awaited<ReturnType<AIRouterClient['listProviderConfigs']>>,
  requested: InterfaceTextModelSelection
): InterfaceTextModelOption | undefined {
  return listEnabledModels(configs).find(
    (model) => model.providerId === requested.providerId && model.modelId === requested.modelId
  )
}
