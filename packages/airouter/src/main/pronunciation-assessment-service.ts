import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  BUILTIN_PRONUNCIATION_MODEL_ID,
  BUILTIN_PRONUNCIATION_PROVIDER_ID,
  PRONUNCIATION_EXTENSION_ID,
  PRONUNCIATION_EXTENSION_VERSION,
  type AIRouterPronunciationAssessmentExtensionImportResult,
  type AIRouterPronunciationAssessmentExtensionStatus,
  type AIRouterPronunciationAssessmentModelOption,
  type AIRouterPronunciationAssessmentRequest,
  type AIRouterPronunciationAssessmentResult
} from '../shared'
import { AIRouterExtensionStore } from './extension-store'

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
  worker: ChildProcess
  pending: Map<string, PendingRequest>
  ready: Promise<void>
}

export interface AIRouterPronunciationAssessmentServiceOptions {
  baseDir?: string
  assetsDir?: string
  extensionStore?: AIRouterExtensionStore
  workerUrl?: URL
  ffmpegPath?: string
}

export class AIRouterPronunciationAssessmentService {
  private statePromise: Promise<WorkerState> | null = null
  private readonly extensionStore: AIRouterExtensionStore

  constructor(private readonly options: AIRouterPronunciationAssessmentServiceOptions) {
    const baseDir = options.baseDir ?? options.assetsDir
    if (!baseDir) throw new Error('AI 语音评测扩展存储目录未配置')
    this.extensionStore = options.extensionStore ?? new AIRouterExtensionStore({ baseDir })
  }

  getExtensionStatus(): Promise<AIRouterPronunciationAssessmentExtensionStatus> {
    return this.extensionStore.getStatus(
      PRONUNCIATION_EXTENSION_ID,
      PRONUNCIATION_EXTENSION_VERSION,
      'AI 语音评测'
    )
  }

  importExtension(filePath: string): Promise<AIRouterPronunciationAssessmentExtensionImportResult> {
    return this.extensionStore.importPackage(
      filePath,
      PRONUNCIATION_EXTENSION_ID,
      PRONUNCIATION_EXTENSION_VERSION
    )
  }

  async deleteExtension(): Promise<void> {
    const statePromise = this.statePromise
    if (statePromise) {
      const state = await statePromise.catch(() => null)
      if (state) this.resetWorker(state, new Error('AI 语音评测扩展包已删除'))
      else this.statePromise = null
    }
    await this.extensionStore.deletePackage(
      PRONUNCIATION_EXTENSION_ID,
      PRONUNCIATION_EXTENSION_VERSION
    )
  }

  listModels(): AIRouterPronunciationAssessmentModelOption[] {
    return this.extensionStore.isInstalled(
      PRONUNCIATION_EXTENSION_ID,
      PRONUNCIATION_EXTENSION_VERSION
    )
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
    if ((await this.getExtensionStatus()).state !== 'imported') {
      throw new Error('AI 语音评测扩展包未导入')
    }
    const assets = await this.extensionStore.resolveAssetPaths(
      PRONUNCIATION_EXTENSION_ID,
      PRONUNCIATION_EXTENSION_VERSION
    )
    const state = await this.workerState(assets)
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
      state.worker.send({ type: 'assess', requestId, request })
    })
  }

  private workerState(assets: Record<string, string>): Promise<WorkerState> {
    this.statePromise ??= this.createWorker(assets)
    return this.statePromise
  }

  private async createWorker(assets: Record<string, string>): Promise<WorkerState> {
    const workerPath = unpackedPath(
      fileURLToPath(
        this.options.workerUrl ?? new URL('./pronunciation-assessment-worker.js', import.meta.url)
      )
    )
    const worker = fork(workerPath, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
      },
      execPath: process.execPath,
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    })
    worker.send({
      type: 'initialize',
      assets,
      ffmpegPath: this.options.ffmpegPath ?? resolveFfmpegPath()
    })
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
      stopWorker(worker)
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
    stopWorker(state.worker)
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

function stopWorker(worker: ChildProcess): void {
  if (worker.connected) worker.disconnect()
  if (!worker.killed) worker.kill()
}

function unpackedPath(value: string): string {
  return value.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

function abortError(): DOMException {
  return new DOMException('Pronunciation assessment was aborted', 'AbortError')
}
