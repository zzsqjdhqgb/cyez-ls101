import type {
  AIRouterClient,
  AIRouterSpeechProviderConfigSummary,
  AIRouterSpeechTarget
} from '@ls101/airouter'
import { airouterClient } from '@ls101/airouter/renderer'
import { encodeExamPackage } from '@ls101/exam-package'
import type { FileDialog } from '@ls101/file-dialog/renderer'
import { fileDialog } from '@ls101/file-dialog/renderer'
import type { TemplateApplication, TemplateInterfaceBinding } from '@ls101/template-editor'

export interface SpeechGenerationSelection extends AIRouterSpeechTarget {
  providerName: string
}

export interface GenerateExamInput {
  application: TemplateApplication
  templateId: string
  templateName: string
  bindings: readonly TemplateInterfaceBinding[]
  speech?: AIRouterSpeechTarget
}

export interface GenerateExamDependencies {
  speechClient: Pick<AIRouterClient, 'synthesizeSpeech'>
  fileDialog: FileDialog
  fetchResource(input: string): Promise<Response>
}

const defaultDependencies: GenerateExamDependencies = {
  speechClient: airouterClient,
  fileDialog,
  fetchResource: (input) => fetch(input)
}

export async function listSpeechGenerationSelections(
  client: Pick<AIRouterClient, 'listSpeechProviderConfigs'> = airouterClient
): Promise<SpeechGenerationSelection[]> {
  const configs = await client.listSpeechProviderConfigs()
  return configs.flatMap((config) => speechSelections(config))
}

export async function generateExamArchive(
  input: GenerateExamInput,
  dependencies: GenerateExamDependencies = defaultDependencies
): Promise<'exported' | 'cancelled'> {
  const speech = input.speech
  const result = await input.application.templates.compile(
    input.templateId,
    input.bindings,
    speech
      ? {
          async synthesizeSpeech(text) {
            const audio = await dependencies.speechClient.synthesizeSpeech({
              text,
              routing: { default: speech },
              format: 'wav'
            })
            return { data: audio.data, mediaType: audio.mediaType }
          }
        }
      : undefined
  )
  if (!result.success) {
    throw new Error(formatCompileErrors(result.errors))
  }

  const resources: Record<string, Uint8Array> = {}
  for (const source of result.resourceSources) {
    if ('data' in source) {
      resources[source.assetKey] = source.data
      continue
    }
    const response = await dependencies.fetchResource(source.sourceUrl)
    if (!response.ok) {
      throw new Error(`资源加载失败：${source.assetKey}（HTTP ${response.status}）`)
    }
    resources[source.assetKey] = new Uint8Array(await response.arrayBuffer())
  }

  const archive = await encodeExamPackage(result.examPackage, resources)
  const written = await dependencies.fileDialog.writeBinary(archive, {
    title: '生成试卷',
    defaultName: `${safeFilename(input.templateName || '未命名试卷')}.lsexam`,
    filters: [{ name: 'LS101 试卷包', extensions: ['lsexam', 'zip'] }]
  })
  return written ? 'exported' : 'cancelled'
}

function speechSelections(
  config: AIRouterSpeechProviderConfigSummary
): SpeechGenerationSelection[] {
  const models = config.models.filter((model) => model.enabled)
  const voices = config.voices.filter((voice) => voice.enabled)
  return models.flatMap((model) =>
    voices.map((voice) => ({
      providerConfigId: config.id,
      providerName: config.name,
      modelId: model.id,
      voiceId: voice.id
    }))
  )
}

function formatCompileErrors(errors: readonly unknown[]): string {
  if (errors.length === 0) return '试卷编译失败'
  return errors
    .map((error) => {
      if (!isRecord(error)) return String(error)
      if (error.stage === 'validation' && isRecord(error.error)) {
        return `${String(error.error.code)}：${String(error.error.path)}`
      }
      return `${String(error.code)}：${String(error.path)}`
    })
    .join('\n')
}

function safeFilename(value: string): string {
  const withoutControls = [...value.trim()]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
  const safe = withoutControls.replace(/[\\/:*?"<>|]+/g, '-').replace(/[. ]+$/g, '')
  return safe || '未命名试卷'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
