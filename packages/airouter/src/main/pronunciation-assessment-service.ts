import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import {
  BUILTIN_PRONUNCIATION_MODEL_ID,
  BUILTIN_PRONUNCIATION_PROVIDER_ID,
  type AIRouterPronunciationAssessmentModelOption,
  type AIRouterPronunciationAssessmentRequest,
  type AIRouterPronunciationAssessmentResult
} from '../shared'

const MODEL_DIRECTORY = 'facebook-wav2vec2-lv-60-espeak-cv-ft-int8'
const MAX_AUDIO_BYTES = 100 * 1024 * 1024
const MAX_REFERENCE_TEXT_LENGTH = 10_000
const require = createRequire(import.meta.url)

interface PendingRequest {
  resolve(result: AIRouterPronunciationAssessmentResult): void
  reject(reason: unknown): void
  signal?: AbortSignal
  abort(): void
}

interface WorkerState {
  worker: Worker
  pending: Map<string, PendingRequest>
  ready: Promise<void>
}

export interface AIRouterPronunciationAssessmentServiceOptions {
  assetsDir: string
  workerUrl?: URL
  ffmpegPath?: string
}

export class AIRouterPronunciationAssessmentService {
  private statePromise: Promise<WorkerState> | null = null

  constructor(private readonly options: AIRouterPronunciationAssessmentServiceOptions) {}

  listModels(): AIRouterPronunciationAssessmentModelOption[] {
    return modelFiles(this.options.assetsDir).every(existsSync)
      ? [
          {
            providerId: BUILTIN_PRONUNCIATION_PROVIDER_ID,
            providerName: '内置发音评测',
            modelId: BUILTIN_PRONUNCIATION_MODEL_ID,
            modelName: 'Facebook Wav2Vec2 Phoneme INT8'
          }
        ]
      : []
  }

  async assess(
    request: AIRouterPronunciationAssessmentRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<AIRouterPronunciationAssessmentResult> {
    validateRequest(request)
    if (options.signal?.aborted) throw abortError()
    if (this.listModels().length === 0) throw new Error('Wav2Vec2 发音评测模型文件不完整')
    const state = await this.workerState()
    if (options.signal?.aborted) throw abortError()
    const requestId = randomUUID()
    return new Promise<AIRouterPronunciationAssessmentResult>((resolve, reject) => {
      const abort = (): void => {
        if (!state.pending.has(requestId)) return
        state.pending.delete(requestId)
        this.resetWorker(state, abortError())
        reject(abortError())
      }
      state.pending.set(requestId, { resolve, reject, signal: options.signal, abort })
      options.signal?.addEventListener('abort', abort, { once: true })
      state.worker.postMessage({ type: 'assess', requestId, request })
    })
  }

  private workerState(): Promise<WorkerState> {
    this.statePromise ??= this.createWorker()
    return this.statePromise
  }

  private async createWorker(): Promise<WorkerState> {
    const worker = new Worker(
      this.options.workerUrl ?? new URL('./pronunciation-assessment-worker.js', import.meta.url),
      {
        workerData: {
          modelDir: join(this.options.assetsDir, MODEL_DIRECTORY),
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
          reject(new Error(stringValue(message.message, '发音评测模型初始化失败')))
          return
        }
        if (typeof message.requestId !== 'string') return
        const pending = state.pending.get(message.requestId)
        if (!pending) return
        state.pending.delete(message.requestId)
        pending.signal?.removeEventListener('abort', pending.abort)
        if (message.type === 'result' && isRecord(message.result)) {
          pending.resolve(message.result as unknown as AIRouterPronunciationAssessmentResult)
        } else {
          pending.reject(new Error(stringValue(message.message, '发音评测失败')))
        }
      })
      worker.once('error', (error) => {
        reject(error)
        this.resetWorker(state, error)
      })
      worker.once('exit', (code) => {
        if (this.statePromise) {
          this.resetWorker(state, new Error(`发音评测 Worker 退出（${code}）`))
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

function validateRequest(request: AIRouterPronunciationAssessmentRequest): void {
  if (
    !request ||
    request.providerConfigId !== BUILTIN_PRONUNCIATION_PROVIDER_ID ||
    request.modelId !== BUILTIN_PRONUNCIATION_MODEL_ID
  ) {
    throw new Error('发音评测 Provider 或模型无效')
  }
  if (
    typeof request.referenceText !== 'string' ||
    !request.referenceText.trim() ||
    request.referenceText.length > MAX_REFERENCE_TEXT_LENGTH
  ) {
    throw new Error('发音评测参考文本无效')
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
    throw new Error('发音评测音频输入无效')
  }
}

function modelFiles(assetsDir: string): string[] {
  const modelDir = join(assetsDir, MODEL_DIRECTORY)
  return [
    join(modelDir, 'config.json'),
    join(modelDir, 'preprocessor_config.json'),
    join(modelDir, 'vocab.json'),
    join(modelDir, 'onnx', 'model_quantized.onnx')
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
  return new DOMException('Pronunciation assessment was aborted', 'AbortError')
}
