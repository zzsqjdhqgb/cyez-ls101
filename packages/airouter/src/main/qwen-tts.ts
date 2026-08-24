import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type {
  AIRouterGeneratedAudio,
  AIRouterQwenTtsBackend,
  AIRouterQwenTtsCudaProbeResult,
  AIRouterSpeechModelPackageModel,
  AIRouterSpeechModelPackageVoice
} from '../shared'
import type { AIRouterLocalSpeechRequest, AIRouterLocalSpeechSynthesizer } from './speech-service'
import { QwenTtsProtocolDecoder, type QwenTtsProtocolMessage } from './qwen-tts-protocol'

const PROTOCOL_VERSION = 1
const MAX_TEXT_BYTES = 64 * 1024
const DEFAULT_STARTUP_TIMEOUT_MS = 180_000
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 600_000
const CUDA_PROBE_TIMEOUT_MS = 10_000
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024

interface QwenRuntimeParameters {
  threads: number
  maxAudioTokens: number
  topK: number
  temperature: number
  repetitionPenalty: number
  languageId: number
  startupTimeoutMs: number
  synthesisTimeoutMs: number
  lowMemory: boolean
}

interface PendingRequest {
  resolve: (audio: AIRouterGeneratedAudio) => void
  reject: (error: unknown) => void
}

interface HelperSession {
  key: string
  process: ChildProcessWithoutNullStreams
  pending: Map<string, PendingRequest>
  ready: Promise<void>
  stderr: string
  closed: boolean
  failure?: Error
}

export interface QwenTtsSynthesizerOptions {
  helperPath?: string
  helperPaths?: Partial<Record<AIRouterQwenTtsBackend, string>>
  spawnProcess?: typeof spawn
}

export class QwenTtsSynthesizer implements AIRouterLocalSpeechSynthesizer {
  private readonly sessions = new Map<string, Promise<HelperSession>>()
  private readonly activeSessions = new Set<HelperSession>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly spawnProcess: typeof spawn

  constructor(private readonly options: QwenTtsSynthesizerOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawn
  }

  async synthesize(request: AIRouterLocalSpeechRequest): Promise<AIRouterGeneratedAudio> {
    try {
      return await this.synthesizeRequest(request)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Qwen TTS 合成失败（模型 ${request.modelId}，音色 ${request.voiceId}，文本“${summarizeText(request.text)}”）：${message}`,
        { cause: error }
      )
    }
  }

  dispose(): void {
    for (const session of this.activeSessions) this.stopSession(session)
    for (const sessionPromise of this.sessions.values()) {
      void sessionPromise.then((session) => this.stopSession(session)).catch(() => undefined)
    }
    this.sessions.clear()
  }

  async probeCuda(): Promise<AIRouterQwenTtsCudaProbeResult> {
    const helperPath = this.resolveHelperPath('cuda')
    try {
      await assertExecutableExists(helperPath)
    } catch (error) {
      return { available: false, message: error instanceof Error ? error.message : String(error) }
    }

    return new Promise((resolve) => {
      const child = this.spawnProcess(helperPath, ['--probe-backend', 'cuda'], {
        env: helperEnvironment(helperPath),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      let settled = false
      let stdout = ''
      let stderr = ''
      const finish = (result: AIRouterQwenTtsCudaProbeResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const append = (current: string, chunk: Buffer): string =>
        `${current}${chunk.toString('utf8')}`.slice(-MAX_PROBE_OUTPUT_BYTES)
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = append(stdout, chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = append(stderr, chunk)
      })
      child.once('error', (error) => finish({ available: false, message: error.message }))
      child.once('exit', (code) => {
        const result = parseCudaProbe(stdout)
        if (code === 0 && result?.available) {
          finish(result)
          return
        }
        finish({
          available: false,
          message: result?.message || stderr.trim() || `CUDA 检测失败（code=${code ?? 'null'}）`
        })
      })
      const timer = setTimeout(() => {
        if (!child.killed) child.kill()
        finish({ available: false, message: 'CUDA 检测超时' })
      }, CUDA_PROBE_TIMEOUT_MS)
    })
  }

  private async synthesizeRequest(
    request: AIRouterLocalSpeechRequest
  ): Promise<AIRouterGeneratedAudio> {
    if (request.format !== 'wav') throw new Error('Qwen TTS 当前只支持 WAV 输出')
    const model = findModel(request.manifest.models, request.modelId)
    const voice = findVoice(request.manifest.voices, request.voiceId)
    const ttsModelAsset = firstArtifact(model, 'tts-model')
    const tokenizerAsset = firstArtifact(model, 'speech-tokenizer')
    const speakerAsset = voice.files[0]
    if (!ttsModelAsset || !tokenizerAsset || !speakerAsset) {
      throw new Error('Qwen TTS 模型包缺少 TTS、语音解码器或音色资产')
    }
    const parameters = parseRuntimeParameters(model.parameters)
    const backend = 'cpu'
    const [ttsModelPath, tokenizerPath, speakerPath] = await Promise.all([
      request.resolveAssetPath(ttsModelAsset),
      request.resolveAssetPath(tokenizerAsset),
      request.resolveAssetPath(speakerAsset)
    ])
    const key = JSON.stringify([
      ttsModelPath,
      tokenizerPath,
      speakerPath,
      backend,
      parameters.threads,
      parameters.maxAudioTokens,
      parameters.topK,
      parameters.temperature,
      parameters.repetitionPenalty,
      parameters.lowMemory
    ])
    return this.enqueue(key, async () => {
      if (request.signal?.aborted) throw abortError()
      const session = await this.getSession(
        key,
        ttsModelPath,
        tokenizerPath,
        speakerPath,
        backend,
        parameters
      )
      return this.dispatch(session, request.text, parameters, request.signal)
    })
  }

  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(task)
    const tail = operation.then(
      () => undefined,
      () => undefined
    )
    this.queues.set(key, tail)
    void tail.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    })
    return operation
  }

  private getSession(
    key: string,
    ttsModelPath: string,
    tokenizerPath: string,
    speakerPath: string,
    backend: AIRouterQwenTtsBackend,
    parameters: QwenRuntimeParameters
  ): Promise<HelperSession> {
    const existing = this.sessions.get(key)
    if (existing) return existing
    const created = this.startSession(
      key,
      ttsModelPath,
      tokenizerPath,
      speakerPath,
      backend,
      parameters
    )
    this.sessions.set(key, created)
    void created.catch(() => {
      if (this.sessions.get(key) === created) this.sessions.delete(key)
    })
    return created
  }

  private async startSession(
    key: string,
    ttsModelPath: string,
    tokenizerPath: string,
    speakerPath: string,
    backend: AIRouterQwenTtsBackend,
    parameters: QwenRuntimeParameters
  ): Promise<HelperSession> {
    const helperPath = this.resolveHelperPath(backend)
    await assertExecutableExists(helperPath)
    const args = [
      '--backend',
      backend,
      '--tts-model',
      ttsModelPath,
      '--tokenizer-model',
      tokenizerPath,
      '--speaker',
      speakerPath,
      '--threads',
      String(parameters.threads),
      '--max-audio-tokens',
      String(parameters.maxAudioTokens),
      '--top-k',
      String(parameters.topK),
      '--temperature',
      String(parameters.temperature),
      '--repetition-penalty',
      String(parameters.repetitionPenalty)
    ]
    const child = this.spawnProcess(helperPath, args, {
      env: helperEnvironment(helperPath, {
        QWEN3_TTS_LOW_MEM: parameters.lowMemory ? '1' : '0'
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    let resolveReady: () => void = () => undefined
    let rejectReady: (error: unknown) => void = () => undefined
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const session: HelperSession = {
      key,
      process: child,
      pending: new Map(),
      ready,
      stderr: '',
      closed: false
    }
    const fail = (error: Error): void => {
      if (session.closed) return
      session.closed = true
      session.failure = error
      rejectReady(error)
      for (const pending of session.pending.values()) pending.reject(error)
      session.pending.clear()
      this.sessions.delete(key)
      this.activeSessions.delete(session)
      if (!child.killed) child.kill()
    }
    const decoder = new QwenTtsProtocolDecoder(
      (message) => this.handleMessage(session, message, resolveReady, fail),
      fail
    )
    child.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
    child.stdout.once('end', () => decoder.end())
    child.stderr.on('data', (chunk: Buffer) => {
      session.stderr = `${session.stderr}${chunk.toString('utf8')}`.slice(-16 * 1024)
    })
    child.once('error', (error) => fail(error))
    child.once('exit', (code, signal) => {
      const diagnostics = session.stderr.trim()
      fail(
        new Error(
          `Qwen TTS helper 退出（code=${code ?? 'null'}, signal=${signal ?? 'none'}）${diagnostics ? `：${diagnostics}` : ''}`
        )
      )
    })
    const timer = setTimeout(() => {
      fail(
        new Error(`Qwen TTS helper 启动超时（${Math.ceil(parameters.startupTimeoutMs / 1000)} 秒）`)
      )
    }, parameters.startupTimeoutMs)
    try {
      await ready
      if (session.failure) throw session.failure
      this.activeSessions.add(session)
      return session
    } finally {
      clearTimeout(timer)
    }
  }

  private resolveHelperPath(backend: AIRouterQwenTtsBackend): string {
    return (
      this.options.helperPaths?.[backend] ??
      (backend === 'cpu' ? this.options.helperPath : undefined) ??
      resolveHelperPath(backend)
    )
  }

  private handleMessage(
    session: HelperSession,
    message: QwenTtsProtocolMessage,
    resolveReady: () => void,
    fail: (error: Error) => void
  ): void {
    if (message.type === 'ready') {
      if (message.version !== PROTOCOL_VERSION) {
        fail(new Error(`Qwen TTS helper 协议版本不兼容：${message.version}`))
      } else {
        resolveReady()
      }
      return
    }
    const pending = session.pending.get(message.requestId)
    if (!pending) {
      fail(new Error(`Qwen TTS helper 返回了未知请求：${message.requestId}`))
      return
    }
    session.pending.delete(message.requestId)
    if (message.type === 'error') {
      pending.reject(new Error(message.message || 'Qwen TTS 合成失败'))
      return
    }
    if (!isWav(message.data)) {
      pending.reject(new Error('Qwen TTS helper 返回的音频不是有效 WAV'))
      return
    }
    pending.resolve({
      data: message.data,
      mediaType: 'audio/wav',
      format: 'wav',
      sampleRate: message.sampleRate,
      channels: 1,
      durationMs: wavDurationMs(message.data)
    })
  }

  private dispatch(
    session: HelperSession,
    text: string,
    parameters: QwenRuntimeParameters,
    signal?: AbortSignal
  ): Promise<AIRouterGeneratedAudio> {
    const bytes = Buffer.from(text, 'utf8')
    if (!bytes.byteLength || bytes.byteLength > MAX_TEXT_BYTES) {
      throw new Error(`Qwen TTS 文本必须为 1 到 ${MAX_TEXT_BYTES} 个 UTF-8 字节`)
    }
    const requestId = randomUUID().replaceAll('-', '')
    return new Promise<AIRouterGeneratedAudio>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        callback()
      }
      const abort = (): void => {
        finish(() => {
          session.pending.delete(requestId)
          this.stopSession(session)
          reject(abortError())
        })
      }
      const timer = setTimeout(() => {
        finish(() => {
          session.pending.delete(requestId)
          this.stopSession(session)
          reject(
            new Error(`Qwen TTS 合成超时（${Math.ceil(parameters.synthesisTimeoutMs / 1000)} 秒）`)
          )
        })
      }, parameters.synthesisTimeoutMs)
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener('abort', abort, { once: true })
      session.pending.set(requestId, {
        resolve: (audio) => finish(() => resolve(audio)),
        reject: (error) => finish(() => reject(error))
      })
      const header = Buffer.from(
        `SYNTHESIZE ${requestId} ${parameters.languageId} ${bytes.byteLength}\n`,
        'ascii'
      )
      session.process.stdin.write(Buffer.concat([header, bytes]), (error) => {
        if (!error) return
        const pending = session.pending.get(requestId)
        session.pending.delete(requestId)
        pending?.reject(error)
        this.stopSession(session)
      })
    })
  }

  private stopSession(session: HelperSession): void {
    if (session.closed) return
    session.closed = true
    const error = new Error('Qwen TTS helper 已终止')
    for (const pending of session.pending.values()) pending.reject(error)
    session.pending.clear()
    this.sessions.delete(session.key)
    this.activeSessions.delete(session)
    session.process.stdin.destroy()
    if (!session.process.killed) session.process.kill()
  }
}

function parseRuntimeParameters(parameters: Record<string, unknown>): QwenRuntimeParameters {
  const load = recordValue(parameters.load)
  const synthesis = recordValue(parameters.synthesis)
  return {
    threads: integerValue(synthesis.threads, 1, 256) ?? 4,
    maxAudioTokens: integerValue(synthesis.maxAudioTokens, 1, 8192) ?? 2048,
    topK: integerValue(synthesis.topK, 0, 2048) ?? 50,
    temperature: numberValue(synthesis.temperature, 0, 5) ?? 0.9,
    repetitionPenalty: numberValue(synthesis.repetitionPenalty, 0.1, 10) ?? 1.05,
    languageId: integerValue(synthesis.languageId, 1, 100000) ?? 2050,
    startupTimeoutMs:
      integerValue(synthesis.startupTimeoutMs, 1_000, 30 * 60_000) ?? DEFAULT_STARTUP_TIMEOUT_MS,
    synthesisTimeoutMs:
      integerValue(synthesis.synthesisTimeoutMs, 1_000, 60 * 60_000) ??
      DEFAULT_SYNTHESIS_TIMEOUT_MS,
    lowMemory: Boolean(load.lowMemory)
  }
}

function resolveHelperPath(backend: AIRouterQwenTtsBackend): string {
  const extension = process.platform === 'win32' ? '.exe' : ''
  const executable = `ls101-qwen-tts-helper-${backend}${extension}`
  const relative = path.join('qwen-tts', `${process.platform}-${process.arch}`, executable)
  const electronApp = app as typeof app & { isPackaged?: boolean; getAppPath?: () => string }
  return electronApp.isPackaged
    ? path.join(process.resourcesPath, relative)
    : path.join(
        electronApp.getAppPath?.() ?? process.cwd(),
        'externals',
        'ai',
        'qwen3-tts',
        'runtime',
        `${process.platform}-${process.arch}`,
        executable
      )
}

function helperEnvironment(
  helperPath: string,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  const pathKeys = Object.keys(environment).filter((key) => key.toLowerCase() === 'path')
  const pathKey = pathKeys[0] ?? 'PATH'
  for (const duplicateKey of pathKeys.slice(1)) delete environment[duplicateKey]
  environment[pathKey] = [path.dirname(helperPath), environment[pathKey]]
    .filter(Boolean)
    .join(path.delimiter)
  return { ...environment, ...overrides }
}

function parseCudaProbe(output: string): AIRouterQwenTtsCudaProbeResult | null {
  try {
    const value = JSON.parse(output.trim()) as Partial<AIRouterQwenTtsCudaProbeResult>
    if (typeof value.available !== 'boolean') return null
    return {
      available: value.available,
      device: typeof value.device === 'string' ? value.device : undefined,
      description: typeof value.description === 'string' ? value.description : undefined,
      memoryFree: typeof value.memoryFree === 'number' ? value.memoryFree : undefined,
      memoryTotal: typeof value.memoryTotal === 'number' ? value.memoryTotal : undefined,
      message: typeof value.message === 'string' ? value.message : undefined
    }
  } catch {
    return null
  }
}

async function assertExecutableExists(filePath: string): Promise<void> {
  const stats = await stat(filePath).catch(() => null)
  if (!stats?.isFile()) {
    throw new Error(`缺少 Qwen TTS 原生运行时：${filePath}；请先执行 yarn qwen-tts:build-runtime`)
  }
}

function findModel(
  models: AIRouterSpeechModelPackageModel[],
  id: string
): AIRouterSpeechModelPackageModel {
  const model = models.find((candidate) => candidate.id === id)
  if (!model) throw new Error('Qwen TTS 模型不存在')
  return model
}

function findVoice(
  voices: AIRouterSpeechModelPackageVoice[],
  id: string
): AIRouterSpeechModelPackageVoice {
  const voice = voices.find((candidate) => candidate.id === id)
  if (!voice) throw new Error('Qwen TTS 音色不存在')
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

function integerValue(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null
}

function numberValue(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function abortError(): DOMException {
  return new DOMException('Speech synthesis was aborted', 'AbortError')
}

function isWav(data: Uint8Array): boolean {
  if (data.byteLength < 44) return false
  const text = (offset: number): string => String.fromCharCode(...data.subarray(offset, offset + 4))
  return text(0) === 'RIFF' && text(8) === 'WAVE'
}

function wavDurationMs(data: Uint8Array): number | undefined {
  if (data.byteLength < 44) return undefined
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const byteRate = view.getUint32(28, true)
  const dataBytes = view.getUint32(40, true)
  return byteRate > 0 ? (dataBytes / byteRate) * 1000 : undefined
}
