import { Worker } from 'node:worker_threads'
import { app } from 'electron'
import type {
  AIRouterGeneratedAudio,
  AIRouterSpeechModelPackageModel,
  AIRouterSpeechModelPackageVoice
} from '../shared'
import type { AIRouterLocalSpeechRequest, AIRouterLocalSpeechSynthesizer } from './speech-service'

interface WorkerMessage {
  type: 'ready' | 'init-error' | 'result' | 'error'
  requestId?: string
  data?: Uint8Array
  message?: string
}

interface PendingRequest {
  resolve: (audio: AIRouterGeneratedAudio) => void
  reject: (error: unknown) => void
}

interface WorkerSession {
  key: string
  worker: Worker
  ready: Promise<void>
  pending: Map<string, PendingRequest>
  busy: boolean
}

export class PocketTtsSynthesizer implements AIRouterLocalSpeechSynthesizer {
  private readonly sessions = new Map<string, Set<WorkerSession>>()

  async synthesize(request: AIRouterLocalSpeechRequest): Promise<AIRouterGeneratedAudio> {
    try {
      return await this.synthesizeRequest(request)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw pocketTtsRequestError(error, request)
    }
  }

  private async synthesizeRequest(
    request: AIRouterLocalSpeechRequest
  ): Promise<AIRouterGeneratedAudio> {
    if (request.format !== 'wav') throw new Error('Pocket TTS 当前只支持 WAV 输出')
    const model = findModel(request.manifest.models, request.modelId)
    const voice = findVoice(request.manifest.voices, request.voiceId)
    const weights = firstArtifact(model, 'weights')
    const tokenizer = firstArtifact(model, 'tokenizer')
    if (!weights || !tokenizer || !voice.files[0]) {
      throw new Error('Pocket TTS 模型包缺少必要资产')
    }
    const parameters =
      request.manifest.models.find((candidate) => candidate.id === request.modelId)?.parameters ??
      {}
    const audioParameters = recordValue(parameters.audio)
    const synthesisParameters = recordValue(parameters.synthesis)
    const loadParameters = recordValue(parameters.load)
    const sampleRate = numberValue(audioParameters.sampleRate) ?? 24000
    const session = await this.acquireSession(request, model, weights, tokenizer, {
      quantization: stringValue(loadParameters.quantization) ?? 'f32',
      sampleRate,
      maxTokensPerChunk: numberValue(synthesisParameters.maxTokensPerChunk) ?? 50,
      silenceBetweenChunksMs: numberValue(synthesisParameters.silenceBetweenChunksMs) ?? 200,
      temperature: numberValue(synthesisParameters.temperature) ?? 0.7,
      padShortInputs: Boolean(synthesisParameters.padShortInputs),
      removeSemicolons: Boolean(synthesisParameters.removeSemicolons)
    })
    const requestId = crypto.randomUUID()
    return new Promise<AIRouterGeneratedAudio>((resolve, reject) => {
      const abort = (): void => {
        request.signal?.removeEventListener('abort', abort)
        this.terminate(session, requestId)
        reject(new DOMException('Speech synthesis was aborted', 'AbortError'))
      }
      if (request.signal?.aborted) {
        abort()
        return
      }
      request.signal?.addEventListener('abort', abort, { once: true })
      session.pending.set(requestId, {
        resolve: (audio) => {
          request.signal?.removeEventListener('abort', abort)
          resolve(audio)
        },
        reject: (error) => {
          request.signal?.removeEventListener('abort', abort)
          reject(error)
        }
      })
      try {
        session.worker.postMessage({
          type: 'synthesize',
          requestId,
          text: request.text,
          voiceId: request.voiceId
        })
      } catch (error) {
        session.pending.get(requestId)?.reject(error)
        session.pending.delete(requestId)
        this.releaseSession(session)
      }
    })
  }

  private async acquireSession(
    request: AIRouterLocalSpeechRequest,
    model: AIRouterSpeechModelPackageModel,
    weights: string,
    tokenizer: string,
    parameters: {
      quantization: string
      sampleRate: number
      maxTokensPerChunk: number
      silenceBetweenChunksMs: number
      temperature: number
      padShortInputs: boolean
      removeSemicolons: boolean
    }
  ): Promise<WorkerSession> {
    const key = `${request.provider.type}:${request.provider.modelPackageId}:${request.provider.modelPackageVersion}:${model.id}`
    const existing = [...(this.sessions.get(key) ?? [])].find((session) => !session.busy)
    if (existing) {
      existing.busy = true
      try {
        await existing.ready
        return existing
      } catch (error) {
        this.removeSession(existing)
        throw error
      }
    }
    const runtime = resolveRuntimePaths()
    const worker = new Worker(new URL('./pocket-tts-worker.js', import.meta.url), {
      workerData: {
        ...runtime,
        modelPath: await request.resolveAssetPath(weights),
        tokenizerPath: await request.resolveAssetPath(tokenizer),
        voices: await Promise.all(
          request.manifest.voices.map(async (candidate) => ({
            id: candidate.id,
            path: await request.resolveAssetPath(candidate.files[0])
          }))
        ),
        ...parameters
      }
    })
    const session: WorkerSession = {
      key,
      worker,
      pending: new Map(),
      ready: Promise.resolve(),
      busy: true
    }
    session.ready = new Promise<void>((resolve, reject) => {
      const onMessage = (message: WorkerMessage): void => {
        if (message.type === 'ready') resolve()
        else if (message.type === 'init-error')
          reject(new Error(message.message || 'Pocket TTS 初始化失败'))
        else if (message.type === 'result' && message.requestId && message.data) {
          session.pending.get(message.requestId)?.resolve({
            data: new Uint8Array(message.data),
            mediaType: 'audio/wav',
            format: 'wav',
            sampleRate: parameters.sampleRate,
            channels: 1,
            durationMs: ((message.data.byteLength - 44) / (parameters.sampleRate * 2)) * 1000
          })
          session.pending.delete(message.requestId)
          this.releaseSession(session)
        } else if (message.type === 'error' && message.requestId) {
          session.pending
            .get(message.requestId)
            ?.reject(new Error(message.message || 'Pocket TTS 合成失败'))
          session.pending.delete(message.requestId)
          this.releaseSession(session)
        }
      }
      worker.on('message', onMessage)
      worker.once('error', (error) => {
        reject(error)
        for (const pending of session.pending.values()) pending.reject(error)
        session.pending.clear()
        this.removeSession(session)
      })
      worker.once('exit', (code) => {
        const error = new Error(`Pocket TTS Worker 退出（${code}）`)
        reject(error)
        for (const pending of session.pending.values()) pending.reject(error)
        session.pending.clear()
        this.removeSession(session)
      })
    })
    const sessions = this.sessions.get(key) ?? new Set<WorkerSession>()
    sessions.add(session)
    this.sessions.set(key, sessions)
    try {
      await session.ready
      return session
    } catch (error) {
      this.removeSession(session)
      await worker.terminate()
      throw error
    }
  }

  private terminate(session: WorkerSession, requestId: string): void {
    session.pending.delete(requestId)
    this.removeSession(session)
    void session.worker.terminate()
  }

  private releaseSession(session: WorkerSession): void {
    if (this.sessions.get(session.key)?.has(session)) session.busy = false
  }

  private removeSession(session: WorkerSession): void {
    const sessions = this.sessions.get(session.key)
    if (!sessions) return
    sessions.delete(session)
    if (sessions.size === 0) this.sessions.delete(session.key)
  }
}

function pocketTtsRequestError(error: unknown, request: AIRouterLocalSpeechRequest): Error {
  const message = error instanceof Error ? error.message : String(error)
  const text = request.text.replace(/\s+/g, ' ').trim()
  const summary = text.length > 80 ? `${text.slice(0, 77)}...` : text
  return new Error(
    `Pocket TTS 合成失败（模型 ${request.modelId}，音色 ${request.voiceId}，文本“${summary}”）：${message}`,
    { cause: error }
  )
}

function resolveRuntimePaths(): { pttsWasmJsPath: string; wasmBinaryPath: string } {
  const electronApp = app as typeof app & { isPackaged?: boolean; getAppPath?: () => string }
  if (electronApp.isPackaged) {
    return {
      pttsWasmJsPath: `${process.resourcesPath}/tts/ptts_wasm.js`,
      wasmBinaryPath: `${process.resourcesPath}/tts/ptts_wasm_bg.wasm`
    }
  }
  const root = electronApp.getAppPath?.() ?? process.cwd()
  return {
    pttsWasmJsPath: `${root}/resources/tts/ptts_wasm.js`,
    wasmBinaryPath: `${root}/resources/tts/ptts_wasm_bg.wasm`
  }
}

function findModel(
  models: AIRouterSpeechModelPackageModel[],
  id: string
): AIRouterSpeechModelPackageModel {
  const model = models.find((candidate) => candidate.id === id)
  if (!model) throw new Error('Pocket TTS 模型不存在')
  return model
}

function findVoice(
  voices: AIRouterSpeechModelPackageVoice[],
  id: string
): AIRouterSpeechModelPackageVoice {
  const voice = voices.find((candidate) => candidate.id === id)
  if (!voice) throw new Error('Pocket TTS 音色不存在')
  return voice
}

function firstArtifact(model: AIRouterSpeechModelPackageModel, kind: string): string | null {
  return model.artifacts[kind]?.[0] ?? null
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
