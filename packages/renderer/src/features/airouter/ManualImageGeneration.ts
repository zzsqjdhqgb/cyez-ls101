import type { AIRouterGeneratedImage } from '@ls101/airouter'

export interface ManualImageGenerationRequest {
  id: string
  prompt: string
}

interface PendingRequest extends ManualImageGenerationRequest {
  resolve(image: AIRouterGeneratedImage): void
  reject(error: unknown): void
  signal?: AbortSignal
  abort(): void
}

export class ManualImageGenerationCoordinator {
  private readonly queue: PendingRequest[] = []
  private readonly listeners = new Set<() => void>()
  private current: PendingRequest | null = null

  getSnapshot = (): ManualImageGenerationRequest | null => this.current

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  generate(
    prompt: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<AIRouterGeneratedImage> {
    if (!prompt.trim()) return Promise.reject(new Error('图片提示词不能为空'))
    if (options.signal?.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      const request: PendingRequest = {
        id: crypto.randomUUID(),
        prompt,
        resolve,
        reject,
        signal: options.signal,
        abort: () => this.remove(request, abortError())
      }
      options.signal?.addEventListener('abort', request.abort, { once: true })
      this.queue.push(request)
      this.advance()
    })
  }

  complete(id: string, image: AIRouterGeneratedImage): void {
    if (this.current?.id !== id) return
    const current = this.current
    this.current = null
    current.signal?.removeEventListener('abort', current.abort)
    current.resolve({ data: new Uint8Array(image.data), mediaType: image.mediaType })
    this.advance()
  }

  cancel(id: string): void {
    if (this.current?.id === id) this.remove(this.current, abortError())
  }

  private remove(request: PendingRequest, error: unknown): void {
    const queuedIndex = this.queue.indexOf(request)
    if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1)
    if (this.current === request) this.current = null
    request.signal?.removeEventListener('abort', request.abort)
    request.reject(error)
    this.advance()
  }

  private advance(): void {
    if (!this.current) this.current = this.queue.shift() ?? null
    for (const listener of this.listeners) listener()
  }
}

function abortError(): DOMException {
  return new DOMException('Image generation was cancelled', 'AbortError')
}

export const manualImageGenerationCoordinator = new ManualImageGenerationCoordinator()
