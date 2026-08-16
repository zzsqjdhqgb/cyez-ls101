import type {
  AIRouterBridge,
  AIRouterClient,
  AIRouterGeneratedImage,
  AIRouterImageGenerationEvent,
  AIRouterStreamEvent,
  AIRouterSpeechProviderType,
  AIRouterSpeechRecognitionEvent,
  AIRouterSpeechRecognitionResult,
  AIRouterSpeechSynthesisEvent,
  AIRouterTextChunk,
  AIRouterTextRequest
} from '../shared'
import { getAIRouterBridge } from './bridge'

export type { AIRouterBridge, AIRouterClient } from '../shared'

export function createAIRouterClient(bridge?: AIRouterBridge): AIRouterClient {
  const getBridge = (): AIRouterBridge => bridge ?? getAIRouterBridge()
  return {
    listProviderConfigs: () => getBridge().listProviderConfigs(),
    saveProviderConfig: (config) => getBridge().saveProviderConfig(config),
    deleteProviderConfig: (id) => getBridge().deleteProviderConfig(id),
    readProviderApiKey: (id) => getBridge().readProviderApiKey(id),
    listModels: (config) => getBridge().listModels(config),
    testConnection: (request) => getBridge().testConnection(request),
    listImageProviderConfigs: () => getBridge().listImageProviderConfigs(),
    saveImageProviderConfig: (config) => getBridge().saveImageProviderConfig(config),
    deleteImageProviderConfig: (id) => getBridge().deleteImageProviderConfig(id),
    readImageProviderApiKey: (id) => getBridge().readImageProviderApiKey(id),
    listImageModels: (config) => getBridge().listImageModels(config),
    testImageConnection: (request) => getBridge().testImageConnection(request),
    listSpeechProviderConfigs: () => getBridge().listSpeechProviderConfigs(),
    saveSpeechProviderConfig: (config) => getBridge().saveSpeechProviderConfig(config),
    deleteSpeechProviderConfig: (id) => getBridge().deleteSpeechProviderConfig(id),
    readSpeechProviderApiKey: (id) => getBridge().readSpeechProviderApiKey(id),
    listSpeechModelPackages: (providerType?: AIRouterSpeechProviderType) =>
      getBridge().listSpeechModelPackages(providerType),
    importSpeechModelPackage: () => getBridge().importSpeechModelPackage(),
    deleteSpeechModelPackage: (id, version) => getBridge().deleteSpeechModelPackage(id, version),
    listSpeechModels: (config) => getBridge().listSpeechModels(config),
    listSpeechVoices: (request) => getBridge().listSpeechVoices(request),
    testSpeechConnection: (request) => getBridge().testSpeechConnection(request),
    listSpeechRecognitionModels: () => getBridge().listSpeechRecognitionModels(),
    recognizeSpeech(request, options = {}) {
      return new Promise<AIRouterSpeechRecognitionResult>((resolve, reject) => {
        let settled = false
        let stop = (): void => undefined
        const finish = (event: AIRouterSpeechRecognitionEvent): void => {
          if (settled) return
          settled = true
          options.signal?.removeEventListener('abort', abort)
          stop()
          if (event.type === 'result') resolve(event.result)
          else reject(new Error(event.message))
        }
        const abort = (): void => {
          if (settled) return
          settled = true
          stop()
          reject(new DOMException('Speech recognition was aborted', 'AbortError'))
        }
        stop = getBridge().startSpeechRecognition(request, finish)
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
    },
    synthesizeSpeech(request, options = {}) {
      const startedAt = Date.now()
      console.info(
        `[AIRouter Speech Client] synthesis requested: chars=${request.text.length}, text="${summarizeText(request.text)}"`
      )
      return new Promise((resolve, reject) => {
        let settled = false
        let stop = (): void => undefined
        const finish = (event: AIRouterSpeechSynthesisEvent): void => {
          if (settled) return
          settled = true
          options.signal?.removeEventListener('abort', abort)
          stop()
          if (event.type === 'result') {
            console.info(
              `[AIRouter Speech Client] result received after ${Date.now() - startedAt}ms, bytes=${event.audio.data.byteLength}`
            )
            resolve({
              data: new Uint8Array(event.audio.data as ArrayLike<number>),
              mediaType: event.audio.mediaType,
              format: event.audio.format,
              sampleRate: event.audio.sampleRate,
              channels: event.audio.channels,
              durationMs: event.audio.durationMs
            })
          } else {
            console.error(
              `[AIRouter Speech Client] error received after ${Date.now() - startedAt}ms: ${event.message}`
            )
            reject(new Error(event.message))
          }
        }
        const abort = (): void => {
          if (settled) return
          settled = true
          stop()
          console.warn(`[AIRouter Speech Client] request aborted after ${Date.now() - startedAt}ms`)
          reject(new DOMException('Speech synthesis was aborted', 'AbortError'))
        }
        stop = getBridge().startSpeechSynthesis(request, finish)
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
    },
    generateImage(request, options = {}) {
      return new Promise<AIRouterGeneratedImage>((resolve, reject) => {
        let settled = false
        let stop = (): void => undefined
        const finish = (event: AIRouterImageGenerationEvent): void => {
          if (settled) return
          settled = true
          options.signal?.removeEventListener('abort', abort)
          stop()
          if (event.type === 'result') {
            resolve({
              data: new Uint8Array(event.image.data as ArrayLike<number>),
              mediaType: event.image.mediaType
            })
          } else reject(new Error(event.message))
        }
        const abort = (): void => {
          if (settled) return
          settled = true
          stop()
          reject(new DOMException('Image generation was aborted', 'AbortError'))
        }
        stop = getBridge().startImageGeneration(request, finish)
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
    },
    generateText(request, options = {}) {
      const queue: AIRouterTextChunk[] = []
      const waiters: Array<{
        resolve: (result: IteratorResult<AIRouterTextChunk>) => void
        reject: (error: unknown) => void
      }> = []
      let ended = false
      let failure: unknown = null
      const stop = getBridge().startTextGeneration(request, (event) => {
        if (event.type === 'chunk') {
          const waiter = waiters.shift()
          if (waiter) waiter.resolve({ value: event.chunk, done: false })
          else queue.push(event.chunk)
        } else if (event.type === 'error') {
          failure = new Error(event.message)
          ended = true
          waiters.splice(0).forEach((waiter) => waiter.reject(failure))
        } else {
          ended = true
          waiters.splice(0).forEach((waiter) => waiter.resolve({ value: undefined, done: true }))
        }
      })
      const abort = (): void => {
        stop()
        ended = true
        waiters.splice(0).forEach((waiter) =>
          waiter.resolve({
            value: undefined,
            done: true
          })
        )
      }
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort', abort, { once: true })

      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<AIRouterTextChunk> {
          try {
            while (true) {
              if (queue.length) {
                yield queue.shift() as AIRouterTextChunk
                continue
              }
              if (ended) {
                if (failure) throw failure
                return
              }
              const next = await new Promise<IteratorResult<AIRouterTextChunk>>(
                (resolve, reject) => {
                  waiters.push({ resolve, reject })
                }
              )
              if (next.done) return
              yield next.value
            }
          } finally {
            stop()
            options.signal?.removeEventListener('abort', abort)
          }
        }
      }
    }
  }
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

export const airouterClient = createAIRouterClient()

export type { AIRouterStreamEvent, AIRouterTextRequest }
