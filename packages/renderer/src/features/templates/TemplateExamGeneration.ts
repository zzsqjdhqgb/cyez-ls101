import type {
  AIRouterClient,
  AIRouterSpeechProviderConfigSummary,
  AIRouterSpeechRouting,
  AIRouterSpeechTarget
} from '@ls101/airouter'
import { airouterClient } from '@ls101/airouter/renderer'
import { encodeExamPackage } from '@ls101/exam-package'
import type { FileDialog } from '@ls101/file-dialog/renderer'
import { fileDialog } from '@ls101/file-dialog/renderer'
import { templateCompileErrorsMessage } from './TemplateCompileErrors'
import type { TemplateApplication, TemplateInterfaceBinding } from '@ls101/template-editor'

export interface SpeechGenerationSelection extends AIRouterSpeechTarget {
  providerName: string
}

export interface GenerateExamInput {
  application: TemplateApplication
  templateId: string
  templateName: string
  bindings: readonly TemplateInterfaceBinding[]
  speech?: AIRouterSpeechRouting
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
  const startedAt = Date.now()
  const speech = input.speech
  console.info(
    `[Template Exam Generation] compile started: template=${input.templateId}, speech=${Boolean(speech)}`
  )
  const result = await input.application.templates.compile(
    input.templateId,
    input.bindings,
    speech
      ? {
          async synthesizeSpeech(text) {
            const speechStartedAt = Date.now()
            console.info(
              `[Template Exam Generation] TTS requested: chars=${text.length}, text="${summarizeText(text)}"`
            )
            const audio = await dependencies.speechClient.synthesizeSpeech({
              text,
              routing: speech,
              format: 'wav'
            })
            console.info(
              `[Template Exam Generation] TTS completed in ${Date.now() - speechStartedAt}ms, bytes=${audio.data.byteLength}`
            )
            return { data: audio.data, mediaType: audio.mediaType }
          }
        }
      : undefined
  )
  console.info(
    `[Template Exam Generation] compile returned after ${Date.now() - startedAt}ms: success=${result.success}`
  )
  if (!result.success) {
    throw new Error(templateCompileErrorsMessage(result.errors))
  }

  const resources: Record<string, Uint8Array> = {}
  console.info(
    `[Template Exam Generation] collecting ${result.resourceSources.length} resource source(s)`
  )
  for (const source of result.resourceSources) {
    if ('data' in source) {
      resources[source.assetKey] = source.data
      console.info(
        `[Template Exam Generation] collected generated resource ${source.assetKey}, bytes=${source.data.byteLength}`
      )
      continue
    }
    const response = await dependencies.fetchResource(source.sourceUrl)
    if (!response.ok) {
      throw new Error(`资源加载失败：${source.assetKey}（HTTP ${response.status}）`)
    }
    resources[source.assetKey] = new Uint8Array(await response.arrayBuffer())
    console.info(
      `[Template Exam Generation] fetched resource ${source.assetKey}, bytes=${resources[source.assetKey].byteLength}`
    )
  }

  console.info('[Template Exam Generation] encoding exam archive')
  const archive = await encodeExamPackage(result.examPackage, resources)
  console.info(`[Template Exam Generation] archive encoded, bytes=${archive.byteLength}`)
  console.info('[Template Exam Generation] opening save dialog')
  const written = await dependencies.fileDialog.writeBinary(archive, {
    title: '生成试卷',
    defaultName: `${safeFilename(input.templateName || '未命名试卷')}.lsexam`,
    filters: [{ name: 'LS101 试卷包', extensions: ['lsexam', 'zip'] }]
  })
  console.info(
    `[Template Exam Generation] save dialog completed after ${Date.now() - startedAt}ms: written=${written}`
  )
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

function safeFilename(value: string): string {
  const withoutControls = [...value.trim()]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
  const safe = withoutControls.replace(/[\\/:*?"<>|]+/g, '-').replace(/[. ]+$/g, '')
  return safe || '未命名试卷'
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}
