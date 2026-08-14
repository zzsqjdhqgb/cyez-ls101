import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type {
  AIRouterSpeechRecognitionModelOption,
  AIRouterSpeechRecognitionRequest,
  AIRouterSpeechRecognitionResult
} from '../shared'

export const BUILTIN_ASR_PROVIDER_ID = 'builtin-qwen3-asr'
export const BUILTIN_ASR_MODEL_ID = 'qwen3-asr-0.6b'
const MAX_AUDIO_BYTES = 100 * 1024 * 1024
const MODEL_DIRECTORY = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25'
const require = createRequire(import.meta.url)

interface PendingRequest {
  resolve(result: AIRouterSpeechRecognitionResult): void
  reject(reason: unknown): void
  signal?: AbortSignal
  abort(): void
}

interface WorkerState {
  worker: Worker
  pending: Map<string, PendingRequest>
  ready: Promise<void>
}

export interface AIRouterSpeechRecognitionServiceOptions {
  assetsDir: string
  workerUrl?: URL
  ffmpegPath?: string
}

export class AIRouterSpeechRecognitionService {
  private statePromise: Promise<WorkerState> | null = null

  constructor(private readonly options: AIRouterSpeechRecognitionServiceOptions) {}

  listModels(): AIRouterSpeechRecognitionModelOption[] {
    return modelFiles(this.options.assetsDir).every(existsSync)
      ? [
          {
            providerId: BUILTIN_ASR_PROVIDER_ID,
            providerName: '内置语音识别',
            modelId: BUILTIN_ASR_MODEL_ID,
            modelName: 'Qwen3 ASR 0.6B'
          }
        ]
      : []
  }

  async recognize(
    request: AIRouterSpeechRecognitionRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<AIRouterSpeechRecognitionResult> {
    validateRequest(request)
    if (options.signal?.aborted) throw abortError()
    if (this.listModels().length === 0) throw new Error('Qwen3 ASR 模型文件不完整')
    const state = await this.workerState()
    if (options.signal?.aborted) throw abortError()
    const requestId = randomUUID()
    return new Promise<AIRouterSpeechRecognitionResult>((resolve, reject) => {
      const abort = (): void => {
        const pending = state.pending.get(requestId)
        if (!pending) return
        state.pending.delete(requestId)
        this.resetWorker(state, abortError())
        reject(abortError())
      }
      state.pending.set(requestId, { resolve, reject, signal: options.signal, abort })
      options.signal?.addEventListener('abort', abort, { once: true })
      state.worker.postMessage({
        type: 'recognize',
        requestId,
        audio: {
          data: request.audio.data,
          mediaType: request.audio.mediaType,
          filename: request.audio.filename
        }
      })
    })
  }

  private workerState(): Promise<WorkerState> {
    this.statePromise ??= this.createWorker()
    return this.statePromise
  }

  private async createWorker(): Promise<WorkerState> {
    const worker = new Worker(
      this.options.workerUrl ?? new URL('./qwen3-asr-worker.js', import.meta.url),
      {
        workerData: {
          assetsDir: this.options.assetsDir,
          ffmpegPath: this.options.ffmpegPath ?? resolveFfmpegPath()
        }
      }
    )
    const state: WorkerState = { worker, pending: new Map(), ready: Promise.resolve() }
    state.ready = new Promise<void>((resolve, reject) => {
      worker.on('message', (message: unknown) => {
        if (!isRecord(message)) return
        if (message.type === 'ready') {
          resolve()
          return
        }
        if (message.type === 'init-error') {
          reject(new Error(stringValue(message.message, 'Qwen3 ASR 初始化失败')))
          return
        }
        if (typeof message.requestId !== 'string') return
        const pending = state.pending.get(message.requestId)
        if (!pending) return
        state.pending.delete(message.requestId)
        pending.signal?.removeEventListener('abort', pending.abort)
        if (message.type === 'result' && typeof message.text === 'string') {
          pending.resolve({ text: message.text })
        } else {
          pending.reject(new Error(stringValue(message.message, '语音识别失败')))
        }
      })
      worker.once('error', (error) => {
        reject(error)
        this.resetWorker(state, error)
      })
      worker.once('exit', (code) => {
        if (this.statePromise) {
          this.resetWorker(state, new Error(`Qwen3 ASR Worker 退出（${code}）`))
        }
      })
    })
    try {
      await state.ready
      return state
    } catch (error) {
      this.resetWorker(state, error)
      await worker.terminate()
      throw error
    }
  }

  private resetWorker(state: WorkerState, reason: unknown): void {
    for (const pending of state.pending.values()) {
      pending.signal?.removeEventListener('abort', pending.abort)
      pending.reject(reason)
    }
    state.pending.clear()
    if (this.statePromise) this.statePromise = null
    void state.worker.terminate()
  }
}

function validateRequest(request: AIRouterSpeechRecognitionRequest): void {
  if (
    !request ||
    request.providerConfigId !== BUILTIN_ASR_PROVIDER_ID ||
    request.modelId !== BUILTIN_ASR_MODEL_ID
  ) {
    throw new Error('语音识别 Provider 或模型无效')
  }
  if (
    !request.audio ||
    !(request.audio.data instanceof Uint8Array) ||
    request.audio.data.byteLength === 0 ||
    request.audio.data.byteLength > MAX_AUDIO_BYTES ||
    typeof request.audio.mediaType !== 'string' ||
    !request.audio.mediaType.toLowerCase().startsWith('audio/') ||
    (request.audio.filename !== undefined && typeof request.audio.filename !== 'string')
  ) {
    throw new Error('语音识别音频输入无效')
  }
}

function modelFiles(assetsDir: string): string[] {
  const modelDir = join(assetsDir, MODEL_DIRECTORY)
  return [
    join(modelDir, 'conv_frontend.onnx'),
    join(modelDir, 'encoder.int8.onnx'),
    join(modelDir, 'decoder.int8.onnx'),
    join(modelDir, 'tokenizer'),
    join(assetsDir, 'silero_vad.onnx')
  ]
}

function resolveFfmpegPath(): string {
  const value = require('ffmpeg-static') as unknown
  if (typeof value !== 'string' || !value) throw new Error('FFmpeg 不可用')
  return value.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function abortError(): DOMException {
  return new DOMException('Speech recognition was aborted', 'AbortError')
}
