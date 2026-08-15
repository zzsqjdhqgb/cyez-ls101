import type {
  AIRouterClient,
  AIRouterSpeechProviderConfigSummary,
  AIRouterSpeechRouting,
  AIRouterSpeechTarget
} from '@ls101/airouter'
import { airouterClient } from '@ls101/airouter/renderer'
import type { ExamPackage, TaskProgressHandle, TaskProgressItem } from '@ls101/core-types'
import { encodeExamPackage } from '@ls101/exam-package'
import type { FileDialog } from '@ls101/file-dialog/renderer'
import { fileDialog } from '@ls101/file-dialog/renderer'
import type { FileStore } from '@ls101/file-store/renderer'
import { assetUrlToKey, fileStore } from '@ls101/file-store/renderer'
import type {
  GeneratedTimelineAudio,
  TemplateApplication,
  TemplateDocument,
  TemplateInterfaceBinding
} from '@ls101/template-editor'
import { templateCompileErrorsMessage } from './TemplateCompileErrors'

const MAX_SPEECH_ATTEMPTS = 4

export interface SpeechGenerationSelection extends AIRouterSpeechTarget {
  providerName: string
}

export interface GenerateExamInput {
  application: TemplateApplication
  document: TemplateDocument
  source?: 'local' | 'builtin'
  examName: string
  bindings: readonly TemplateInterfaceBinding[]
  speech?: AIRouterSpeechRouting
}

export interface GenerateExamDependencies {
  speechClient: Pick<AIRouterClient, 'synthesizeSpeech'>
  fetchResource(input: string, signal: AbortSignal): Promise<Response>
}

export type ExamGenerationResult =
  | {
      status: 'completed'
      archive: Uint8Array
      examPackage: ExamPackage
    }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

export interface ExamGenerationSession {
  start(): TaskProgressHandle<ExamGenerationResult>
  dispose(): void
}

interface SpeechTask {
  id: string
  text: string
}

interface CachedSpeech {
  text: string
  audio: GeneratedTimelineAudio
}

const defaultDependencies: GenerateExamDependencies = {
  speechClient: airouterClient,
  fetchResource: fetchExamResource
}

export async function fetchExamResource(
  input: string,
  signal: AbortSignal,
  store: Pick<FileStore, 'readAsset'> = fileStore,
  fetcher: typeof fetch = fetch
): Promise<Response> {
  if (!input.startsWith('asset:')) return fetcher(input, { signal })

  throwIfAborted(signal)
  const data = await store.readAsset(assetUrlToKey(input))
  throwIfAborted(signal)
  return data === null ? new Response(null, { status: 404 }) : new Response(data)
}

export async function listSpeechGenerationSelections(
  client: Pick<AIRouterClient, 'listSpeechProviderConfigs'> = airouterClient
): Promise<SpeechGenerationSelection[]> {
  const configs = await client.listSpeechProviderConfigs()
  return configs.flatMap((config) => speechSelections(config))
}

export function createExamGenerationSession(
  input: GenerateExamInput,
  dependencies: GenerateExamDependencies = defaultDependencies
): ExamGenerationSession {
  const cache = new Map<number, CachedSpeech>()
  let active: TaskProgressHandle<ExamGenerationResult> | null = null
  let disposed = false

  return {
    start() {
      if (disposed) throw new Error('生成会话已经关闭')
      if (active) throw new Error('生成任务正在运行')
      const handle = createGenerationHandle(input, dependencies, cache, () => {
        if (active === handle) active = null
      })
      active = handle
      return handle
    },
    dispose() {
      disposed = true
      active?.cancel()
      active = null
      cache.clear()
    }
  }
}

export async function exportGeneratedExam(
  archive: Uint8Array,
  examName: string,
  dialog: Pick<FileDialog, 'writeBinary'> = fileDialog
): Promise<boolean> {
  return dialog.writeBinary(archive, {
    title: '导出试卷',
    defaultName: `${safeFilename(examName)}.lsexam`,
    filters: [{ name: 'LS101 试卷包', extensions: ['lsexam', 'zip'] }]
  })
}

function createGenerationHandle(
  input: GenerateExamInput,
  dependencies: GenerateExamDependencies,
  cache: Map<number, CachedSpeech>,
  dispose: () => void
): TaskProgressHandle<ExamGenerationResult> {
  const controller = new AbortController()
  let cancelled = false
  let snapshot = {
    items: baseItems('running')
  }
  const listeners = new Set<() => void>()
  const publish = (items: readonly TaskProgressItem[]): void => {
    snapshot = { items }
    listeners.forEach((listener) => listener())
  }
  const update = (id: string, next: Partial<TaskProgressItem>): void => {
    publish(snapshot.items.map((item) => (item.id === id ? { ...item, ...next } : item)))
  }

  const completion = runGeneration(input, dependencies, cache, controller.signal, {
    get items() {
      return snapshot.items
    },
    publish,
    update
  })
    .catch((reason: unknown): ExamGenerationResult => {
      if (cancelled || isAbortError(reason)) return { status: 'cancelled' }
      const message = errorMessage(reason)
      const running = snapshot.items.find((item) => item.status === 'running')
      if (running) update(running.id, { status: 'failed', log: textLog(message) })
      return { status: 'failed', message }
    })
    .finally(dispose)

  return {
    getSnapshot: () => snapshot,
    subscribe(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    cancel() {
      cancelled = true
      controller.abort()
    },
    completion
  }
}

async function runGeneration(
  input: GenerateExamInput,
  dependencies: GenerateExamDependencies,
  cache: Map<number, CachedSpeech>,
  signal: AbortSignal,
  progress: {
    readonly items: readonly TaskProgressItem[]
    publish(items: readonly TaskProgressItem[]): void
    update(id: string, next: Partial<TaskProgressItem>): void
  }
): Promise<ExamGenerationResult> {
  const preview =
    input.source === 'builtin'
      ? await input.application.builtinTemplates.preview(input.document.templateId, input.bindings)
      : await input.application.templates.preview(input.document, input.bindings)
  throwIfAborted(signal)
  if (!preview.success) {
    const message = templateCompileErrorsMessage(preview.errors)
    progress.update('prepare', { status: 'failed', log: textLog(message) })
    return { status: 'failed', message }
  }

  const speechTasks: SpeechTask[] = preview.preview.pages.flatMap((page) =>
    page.timeline
      .filter((step): step is Extract<(typeof page.timeline)[number], { type: 'play' }> =>
        Boolean(step.type === 'play')
      )
      .map((step, index) => ({
        id: `speech-${page.id}-${index}`,
        text: step.text
      }))
  )
  pruneStaleCache(cache, speechTasks)
  progress.publish([
    { id: 'prepare', label: '准备试卷内容', status: 'completed' },
    ...(speechTasks.length > 0
      ? speechTasks.map((task, index): TaskProgressItem => {
          const cached = cache.get(index)
          return {
            id: task.id,
            label: `合成语音 ${index + 1}：${summarizeText(task.text)}`,
            status: cached?.text === task.text ? 'completed' : 'waiting',
            log: textLog(task.text)
          }
        })
      : [
          {
            id: 'speech-none',
            label: '合成语音',
            status: 'completed' as const,
            log: textLog('此模板无需合成语音')
          }
        ]),
    { id: 'resources', label: '整理试卷资源', status: 'waiting' },
    { id: 'package', label: '打包试卷', status: 'waiting' }
  ])

  let speechIndex = 0
  const compiler =
    input.source === 'builtin'
      ? input.application.builtinTemplates.compile.bind(input.application.builtinTemplates)
      : input.application.templates.compile.bind(input.application.templates)
  const compiled = await compiler(
    input.document.templateId,
    input.bindings,
    input.speech
      ? {
          synthesizeSpeech: async (text): Promise<GeneratedTimelineAudio> => {
            throwIfAborted(signal)
            const index = speechIndex++
            const task = speechTasks[index]
            if (!task || task.text !== text) {
              throw new Error('语音任务顺序与试卷内容不一致，请重新开始生成')
            }
            const cached = cache.get(index)
            if (cached?.text === text) return cached.audio

            for (let attempt = 1; attempt <= MAX_SPEECH_ATTEMPTS; attempt += 1) {
              progress.update(task.id, {
                status: 'running',
                log: textLog(`${text}\n\n第 ${attempt} / ${MAX_SPEECH_ATTEMPTS} 次尝试`)
              })
              try {
                const audio = await dependencies.speechClient.synthesizeSpeech(
                  { text, routing: input.speech as AIRouterSpeechRouting, format: 'wav' },
                  { signal }
                )
                const generated = { data: audio.data, mediaType: audio.mediaType }
                cache.set(index, { text, audio: generated })
                progress.update(task.id, { status: 'completed', log: textLog(text) })
                return generated
              } catch (reason) {
                if (signal.aborted || isAbortError(reason)) throw reason
                const message = errorMessage(reason)
                progress.update(task.id, {
                  status: attempt === MAX_SPEECH_ATTEMPTS ? 'failed' : 'running',
                  log: textLog(
                    `${text}\n\n第 ${attempt} / ${MAX_SPEECH_ATTEMPTS} 次尝试失败：${message}`
                  )
                })
                if (attempt === MAX_SPEECH_ATTEMPTS) throw reason
              }
            }
            throw new Error('语音合成失败')
          }
        }
      : undefined
  )
  throwIfAborted(signal)
  if (!compiled.success) {
    const message = templateCompileErrorsMessage(compiled.errors)
    if (!progress.items.some((item) => item.status === 'failed')) {
      progress.update('prepare', { status: 'failed', log: textLog(message) })
    }
    return { status: 'failed', message }
  }

  progress.update('resources', { status: 'running' })
  const resources: Record<string, Uint8Array> = {}
  try {
    for (const source of compiled.resourceSources) {
      throwIfAborted(signal)
      if ('data' in source) {
        resources[source.assetKey] = source.data
        continue
      }
      const response = await dependencies.fetchResource(source.sourceUrl, signal)
      if (!response.ok) {
        throw new Error(`资源加载失败：${source.assetKey}（HTTP ${response.status}）`)
      }
      resources[source.assetKey] = new Uint8Array(await response.arrayBuffer())
    }
    progress.update('resources', { status: 'completed' })
  } catch (reason) {
    if (signal.aborted || isAbortError(reason)) throw reason
    const message = errorMessage(reason)
    progress.update('resources', { status: 'failed', log: textLog(message) })
    return { status: 'failed', message }
  }

  progress.update('package', { status: 'running' })
  try {
    const examPackage = renameExamPackage(compiled.examPackage, input.examName.trim())
    const archive = await encodeExamPackage(examPackage, resources)
    throwIfAborted(signal)
    progress.update('package', { status: 'completed' })
    return { status: 'completed', archive, examPackage }
  } catch (reason) {
    if (signal.aborted || isAbortError(reason)) throw reason
    const message = errorMessage(reason)
    progress.update('package', { status: 'failed', log: textLog(message) })
    return { status: 'failed', message }
  }
}

function baseItems(prepareStatus: TaskProgressItem['status']): TaskProgressItem[] {
  return [
    { id: 'prepare', label: '准备试卷内容', status: prepareStatus },
    { id: 'resources', label: '整理试卷资源', status: 'waiting' },
    { id: 'package', label: '打包试卷', status: 'waiting' }
  ]
}

function pruneStaleCache(cache: Map<number, CachedSpeech>, tasks: readonly SpeechTask[]): void {
  let mismatch = false
  for (let index = 0; index < tasks.length; index += 1) {
    if (cache.get(index)?.text !== tasks[index].text) mismatch = true
    if (mismatch) cache.delete(index)
  }
  for (const index of cache.keys()) {
    if (index >= tasks.length) cache.delete(index)
  }
}

function renameExamPackage(examPackage: ExamPackage, examName: string): ExamPackage {
  const renamed = structuredClone(examPackage)
  renamed.examData.title = examName
  renamed.submissionTemplate.meta.examTitle = examName
  return renamed
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
  return normalized.length > 56 ? `${normalized.slice(0, 53)}...` : normalized
}

function textLog(content: string): TaskProgressItem['log'] {
  return { format: 'text', content }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Generation was aborted', 'AbortError')
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'AbortError'
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
