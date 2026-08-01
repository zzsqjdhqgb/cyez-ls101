import type {
  AIRouterBridge,
  AIRouterClient,
  AIRouterStreamEvent,
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
    listModels: (id) => getBridge().listModels(id),
    testConnection: (request) => getBridge().testConnection(request),
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

export const airouterClient = createAIRouterClient()

export type { AIRouterStreamEvent, AIRouterTextRequest }
