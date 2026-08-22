import { airouterClient, type AIRouterClient } from '@ls101/airouter/renderer'
import type {
  SpeechRecognizer,
  SpeechRecognitionModelSelection,
  TextGradingModel,
  TextGradingModelSelection
} from '@ls101/grading-engine'
import type { AIModelOption } from '../../components/ai/AIModelSelect'

export interface SubmissionAIModelOptions {
  speechRecognition: AIModelOption[]
  text: AIModelOption[]
}

export async function listSubmissionAIModels(
  client: AIRouterClient = airouterClient
): Promise<SubmissionAIModelOptions> {
  const [recognition, textProviders] = await Promise.all([
    client.listSpeechRecognitionModels(),
    client.listProviderConfigs()
  ])
  return {
    speechRecognition: recognition.map((model) => ({
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.modelId,
      modelName: model.modelName
    })),
    text: textProviders.flatMap((provider) =>
      provider.models
        .filter((model) => model.enabled)
        .map((model) => ({
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          ...(model.metadata?.name ? { modelName: model.metadata.name } : {})
        }))
    )
  }
}

export function createAIRouterSpeechRecognizer(
  selection: SpeechRecognitionModelSelection,
  client: AIRouterClient = airouterClient
): SpeechRecognizer {
  return {
    async recognize({ audio }, options) {
      const result = await client.recognizeSpeech(
        {
          providerConfigId: selection.providerId,
          modelId: selection.modelId,
          audio: {
            data: audio.data,
            mediaType: audio.mediaType ?? 'audio/webm',
            filename: audio.filename
          }
        },
        options
      )
      return result.text
    }
  }
}

export function createAIRouterTextGradingModel(
  selection: TextGradingModelSelection,
  client: AIRouterClient = airouterClient
): TextGradingModel {
  return {
    async generate(prompt, options) {
      let output = ''
      for await (const chunk of client.generateText(
        {
          providerConfigId: selection.providerId,
          modelId: selection.modelId,
          prompt
        },
        options
      )) {
        if (chunk.type === 'output') output += chunk.delta
      }
      return output
    }
  }
}
