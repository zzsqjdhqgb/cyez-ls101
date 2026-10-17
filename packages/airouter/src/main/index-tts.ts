import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import type {
  AIRouterGeneratedAudio,
  AIRouterSpeechModelPackageManifest,
  AIRouterSpeechModelPackageModel,
  AIRouterSpeechModelPackageVoice
} from '../shared'
import type { AIRouterLocalSpeechRequest, AIRouterLocalSpeechSynthesizer } from './speech-service'
import { IndexTtsProtocolDecoder, type IndexTtsProtocolMessage } from './index-tts-protocol'
import { INDEX_TTS_MAX_REQUEST_BYTES, INDEX_TTS_MAX_TEXT_BYTES } from './index-tts-protocol'
import {
  assertIndexTtsManifest,
  indexTtsParameters,
  type IndexTtsParameters
} from './index-tts-model'

const PROTOCOL_VERSION = 1
const DEFAULT_STARTUP_TIMEOUT_MS = 180_000
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 600_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
const DEFAULT_IDLE_TIMEOUT_MS = 300_000
const DEFAULT_MAX_QUEUED_REQUESTS = 32
const KILL_GRACE_MS = 5_000
const MAX_STDERR_BYTES = 16 * 1024

type MaintenanceKind = 'package' | 'assets'

interface PendingRequest {
  resolve: (audio: AIRouterGeneratedAudio) => void
  reject: (error: unknown) => void
}

interface HelperSession {
  key: string
  process: ChildProcessWithoutNullStreams
  decoder: IndexTtsProtocolDecoder
  pending: Map<string, PendingRequest>
  ready: Promise<void>
  rejectReady: (error: unknown) => void
  readyResolved: boolean
  stderr: string
  closed: boolean
  failure?: Error
  temporaryDirectory: string
  exited: Promise<void>
  spawned: Promise<void>
  terminating?: Promise<void>
}

interface QueueMeta {
  packageId: string
  packageVersion: string
  signal?: AbortSignal
}

interface QueueEntry {
  meta: QueueMeta
  cancelled: boolean
  reject: (error: unknown) => void
}

interface SynthesisJob {
  key: string
  modelPath: string
  voicePath: string
  text: string
  parameters: IndexTtsParameters
  signal?: AbortSignal
}

export interface IndexTtsSynthesizerOptions {
  helperPath?: string
  spawnProcess?: typeof spawn
  startupTimeoutMs?: number
  synthesisTimeoutMs?: number
  shutdownTimeoutMs?: number
  idleTimeoutMs?: number
  maxQueuedRequests?: number
}

export class IndexTtsSynthesizer implements AIRouterLocalSpeechSynthesizer {
  private readonly spawnProcess: typeof spawn
  private readonly startupTimeoutMs: number
  private readonly synthesisTimeoutMs: number
  private readonly shutdownTimeoutMs: number
  private readonly idleTimeoutMs: number
  private readonly maxQueuedRequests: number

  private currentSession: HelperSession | null = null
  private readonly queuedEntries: QueueEntry[] = []
  private ownerTail: Promise<void> = Promise.resolve()
  private maintenanceTail: Promise<void> = Promise.resolve()
  private maintenance: MaintenanceKind | null = null
  private busyCount = 0
  private idleTimer: NodeJS.Timeout | null = null
  private disposed = false
  private disposeCompletion: Promise<void> | null = null
  private exitFailure: Error | null = null

  constructor(private readonly options: IndexTtsSynthesizerOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawn
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    this.synthesisTimeoutMs = options.synthesisTimeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.maxQueuedRequests = options.maxQueuedRequests ?? DEFAULT_MAX_QUEUED_REQUESTS
  }

  async synthesize(request: AIRouterLocalSpeechRequest): Promise<AIRouterGeneratedAudio> {
    try {
      return await this.synthesizeRequest(request)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `IndexTTS 合成失败（模型 ${request.modelId}，音色 ${request.voiceId}，文本“${summarizeText(request.text)}”）：${message}`,
        { cause: error }
      )
    }
  }

  /**
   * Coordinates a model-package deletion with synthesis: queued requests that
   * reference the package are cancelled, in-flight inference finishes, the
   * helper process and its temporary directory are released, and only then does
   * the file operation run. File operations are serialized with each other.
   */
  releasePackage(id: string, version: string, remove: () => Promise<void>): Promise<void> {
    const message = new Error('IndexTTS 模型包正在删除')
    return this.runMaintenance('package', message, async () => {
      this.cancelQueued(
        (entry) => entry.meta.packageId === id && entry.meta.packageVersion === version,
        message
      )
      await remove()
    })
  }

  /**
   * Coordinates an asset-level change (model-package import) with synthesis:
   * every queued request is cancelled, in-flight inference finishes, the helper
   * process is released, and the operation runs while new requests are refused.
   */
  releaseAssets<T>(operation: () => Promise<T>): Promise<T> {
    const message = new Error('IndexTTS 模型资源正在更新，请稍后重试')
    return this.runMaintenance('assets', message, async () => {
      this.cancelQueued(() => true, message)
      return operation()
    })
  }

  dispose(): Promise<void> {
    if (this.disposeCompletion) return this.disposeCompletion
    this.disposed = true
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.disposeCompletion = (async () => {
      this.cancelQueued(() => true, new Error('IndexTTS 已关闭'))
      await this.ownerTail.catch(() => undefined)
      const session = this.currentSession
      if (session) await this.terminateSession(session)
    })()
    return this.disposeCompletion
  }

  private async synthesizeRequest(
    request: AIRouterLocalSpeechRequest
  ): Promise<AIRouterGeneratedAudio> {
    if (this.disposed) throw new Error('IndexTTS 已关闭')
    if (request.format !== 'wav') throw new Error('IndexTTS 当前只支持 WAV 输出')
    assertIndexTtsManifest(request.manifest)
    const model = findModel(request.manifest.models, request.modelId)
    const voice = findVoice(request.manifest.voices, request.voiceId)
    const modelAsset = model.artifacts['tts-model']?.[0] ?? null
    const voiceAsset = voice.files[0] ?? null
    if (!modelAsset || !voiceAsset) {
      throw new Error('IndexTTS 模型包缺少 TTS 模型或参考音频资产')
    }
    const parameters = indexTtsParameters(model.parameters)
    const text = request.text.trim()
    const textBytes = Buffer.from(text, 'utf8')
    if (!textBytes.byteLength || textBytes.byteLength > INDEX_TTS_MAX_TEXT_BYTES) {
      throw new Error(`IndexTTS 文本必须为 1 到 ${INDEX_TTS_MAX_TEXT_BYTES} 个 UTF-8 字节`)
    }

    // Asset resolution happens before any spawn and stays abortable.
    const modelPath = await abortable(request.resolveAssetPath(modelAsset), request.signal)
    const voicePath = await abortable(request.resolveAssetPath(voiceAsset), request.signal)
    const key = JSON.stringify([
      modelPath,
      parameters.load.device,
      parameters.load.threads,
      parameters.load.lowMemory
    ])
    const job: SynthesisJob = {
      key,
      modelPath,
      voicePath,
      text,
      parameters,
      signal: request.signal
    }
    const meta: QueueMeta = {
      packageId: request.provider.modelPackageId,
      packageVersion: request.provider.modelPackageVersion,
      signal: request.signal
    }
    return this.schedule(meta, () => this.runSynthesis(job))
  }

  private schedule(
    meta: QueueMeta,
    task: () => Promise<AIRouterGeneratedAudio>
  ): Promise<AIRouterGeneratedAudio> {
    if (this.disposed) return Promise.reject(new Error('IndexTTS 已关闭'))
    if (this.maintenance === 'package') {
      return Promise.reject(new Error('IndexTTS 模型包正在删除'))
    }
    if (this.maintenance === 'assets') {
      return Promise.reject(new Error('IndexTTS 模型资源正在更新，请稍后重试'))
    }
    if (this.exitFailure) return Promise.reject(this.exitFailure)
    if (this.queuedEntries.length >= this.maxQueuedRequests) {
      return Promise.reject(new Error('IndexTTS 等待队列已满'))
    }
    this.enterBusy()
    let resolveOuter: (audio: AIRouterGeneratedAudio) => void = () => undefined
    let rejectOuter: (error: unknown) => void = () => undefined
    const result = new Promise<AIRouterGeneratedAudio>((resolve, reject) => {
      resolveOuter = resolve
      rejectOuter = reject
    })
    const entry: QueueEntry = { meta, cancelled: false, reject: rejectOuter }
    this.queuedEntries.push(entry)
    const onAbort = (): void => {
      if (entry.cancelled) return
      entry.cancelled = true
      this.removeQueued(entry)
      this.exitBusy()
      rejectOuter(abortError())
    }
    meta.signal?.addEventListener('abort', onAbort, { once: true })
    const previous = this.ownerTail
    this.ownerTail = (async () => {
      await previous.catch(() => undefined)
      meta.signal?.removeEventListener('abort', onAbort)
      if (entry.cancelled) return
      this.removeQueued(entry)
      entry.cancelled = true
      try {
        resolveOuter(await task())
      } catch (error) {
        rejectOuter(error)
      } finally {
        this.exitBusy()
      }
    })()
    return result
  }

  private removeQueued(entry: QueueEntry): void {
    const index = this.queuedEntries.indexOf(entry)
    if (index >= 0) this.queuedEntries.splice(index, 1)
  }

  private cancelQueued(match: (entry: QueueEntry) => boolean, error: Error): void {
    for (const entry of [...this.queuedEntries]) {
      if (!match(entry)) continue
      this.removeQueued(entry)
      if (entry.cancelled) continue
      entry.cancelled = true
      this.exitBusy()
      entry.reject(error)
    }
  }

  private enterBusy(): void {
    this.busyCount += 1
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private exitBusy(): void {
    this.busyCount = Math.max(0, this.busyCount - 1)
    if (this.busyCount === 0) this.scheduleIdleReclaim()
  }

  private scheduleIdleReclaim(): void {
    if (this.disposed || this.maintenance) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      const session = this.currentSession
      if (session && !session.closed && this.busyCount === 0) {
        void this.terminateSession(session)
      }
    }, this.idleTimeoutMs)
    this.idleTimer.unref()
  }

  private async runMaintenance<T>(
    kind: MaintenanceKind,
    message: Error,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.maintenanceTail
    let release: () => void = () => undefined
    this.maintenanceTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous.catch(() => undefined)
    if (this.disposed) {
      release()
      return operation()
    }
    this.maintenance = kind
    try {
      await this.ownerTail.catch(() => undefined)
      const session = this.currentSession
      if (session) await this.terminateSession(session)
      return await operation()
    } finally {
      this.maintenance = null
      release()
    }
  }

  private async runSynthesis(job: SynthesisJob): Promise<AIRouterGeneratedAudio> {
    if (job.signal?.aborted) throw abortError()
    const session = await this.acquireSession(job)
    if (job.signal?.aborted) {
      this.failSession(session, new Error('IndexTTS 合成已中止'))
      throw abortError()
    }
    return this.dispatch(session, job)
  }

  private async acquireSession(job: SynthesisJob): Promise<HelperSession> {
    const current = this.currentSession
    if (current && !current.closed && current.key === job.key) return current
    if (current) await this.terminateSession(current)
    if (this.exitFailure) throw this.exitFailure
    if (this.disposed) throw new Error('IndexTTS 已关闭')
    await assertExecutableExists(this.resolveHelperPath())

    const session = this.spawnSession(job)
    this.currentSession = session
    const timer = setTimeout(() => {
      this.failSession(
        session,
        new Error(`IndexTTS helper 启动超时（${Math.ceil(this.startupTimeoutMs / 1000)} 秒）`)
      )
    }, this.startupTimeoutMs)
    try {
      await abortable(session.ready, job.signal)
      if (session.failure) throw session.failure
    } catch (error) {
      // An abort while the model is loading stops the load itself; later
      // requests spawn a fresh process and recover.
      this.failSession(
        session,
        error instanceof Error ? error : new Error('IndexTTS 模型加载已中止')
      )
      throw error
    } finally {
      clearTimeout(timer)
    }
    return session
  }

  private spawnSession(job: SynthesisJob): HelperSession {
    const helperPath = this.resolveHelperPath()
    const args = [
      '--backend',
      'cpu',
      '--model',
      job.modelPath,
      '--device',
      String(job.parameters.load.device),
      '--threads',
      String(job.parameters.load.threads),
      '--low-memory',
      job.parameters.load.lowMemory ? '1' : '0'
    ]
    let resolveReady: () => void = () => undefined
    let rejectReady: (error: unknown) => void = () => undefined
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    let resolveExited: () => void = () => undefined
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve
    })
    let resolveSpawned: () => void = () => undefined
    const spawned = new Promise<void>((resolve) => {
      resolveSpawned = resolve
    })
    const session: HelperSession = {
      key: job.key,
      process: null as unknown as ChildProcessWithoutNullStreams,
      decoder: null as unknown as IndexTtsProtocolDecoder,
      pending: new Map(),
      ready,
      rejectReady,
      readyResolved: false,
      stderr: '',
      closed: false,
      temporaryDirectory: '',
      exited,
      spawned
    }
    void (async () => {
      session.temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'index-tts-'))
      const child = this.spawnProcess(helperPath, args, {
        env: helperEnvironment(helperPath, session.temporaryDirectory),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      session.process = child
      resolveSpawned()
      const release = (): void => {
        rm(session.temporaryDirectory, { recursive: true, force: true })
          .catch(() => undefined)
          .finally(() => resolveExited())
      }
      child.once('exit', release)
      child.once('error', release)
      const fail = (error: Error): void => this.failSession(session, error)
      const decoder = new IndexTtsProtocolDecoder(
        (message) => this.handleMessage(session, message, resolveReady, fail),
        fail
      )
      session.decoder = decoder
      child.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
      child.stdout.once('end', () => decoder.end())
      child.stdout.once('close', () => {
        if (!session.closed) {
          fail(withStderr(session, new Error('IndexTTS helper stdout 管道已关闭')))
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        session.stderr = `${session.stderr}${chunk.toString('utf8')}`.slice(-MAX_STDERR_BYTES)
      })
      child.once('error', (error) => fail(error as Error))
      child.once('exit', (code, signal) => {
        if (session.closed) return
        const diagnostics = session.stderr.trim()
        fail(
          new Error(
            `IndexTTS helper 退出（code=${code ?? 'null'}, signal=${signal ?? 'none'}）${diagnostics ? `：${diagnostics}` : ''}`
          )
        )
      })
    })()
    return session
  }

  private handleMessage(
    session: HelperSession,
    message: IndexTtsProtocolMessage,
    resolveReady: () => void,
    fail: (error: Error) => void
  ): void {
    // Events that arrive after a session failed or was replaced are ignored so
    // they cannot disturb a freshly started session.
    if (session.closed) return
    if (message.type === 'ready') {
      if (session.readyResolved) {
        fail(withStderr(session, new Error('IndexTTS helper 重复发送 READY')))
        return
      }
      if (message.version !== PROTOCOL_VERSION) {
        fail(new Error(`IndexTTS helper 协议版本不兼容：${message.version}`))
        return
      }
      session.readyResolved = true
      resolveReady()
      return
    }
    const pending = session.pending.get(message.requestId)
    if (!pending) {
      fail(withStderr(session, new Error(`IndexTTS helper 返回了未知请求：${message.requestId}`)))
      return
    }
    session.pending.delete(message.requestId)
    if (message.type === 'error') {
      // A per-request failure keeps the loaded model and the session alive.
      pending.reject(new Error(message.message || 'IndexTTS 合成失败'))
      return
    }
    const wav = parseWav(message.data, message.sampleRate)
    if (!wav) {
      const error = withStderr(session, new Error('IndexTTS helper 返回的音频不是有效 WAV'))
      pending.reject(error)
      fail(error)
      return
    }
    pending.resolve({
      data: message.data,
      mediaType: 'audio/wav',
      format: 'wav',
      sampleRate: message.sampleRate,
      channels: 1,
      durationMs: wav.durationMs
    })
  }

  private dispatch(session: HelperSession, job: SynthesisJob): Promise<AIRouterGeneratedAudio> {
    const payload: Record<string, unknown> = {
      text: job.text,
      voicePath: job.voicePath,
      language: job.parameters.synthesis.language,
      maxTokens: job.parameters.synthesis.maxTokens
    }
    if (job.parameters.synthesis.seed !== undefined) {
      payload.seed = job.parameters.synthesis.seed
    }
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8')
    if (bytes.byteLength > INDEX_TTS_MAX_REQUEST_BYTES) {
      throw new Error(`IndexTTS 请求载荷超过 ${INDEX_TTS_MAX_REQUEST_BYTES} 字节限制`)
    }
    const requestId = randomUUID().replaceAll('-', '')
    return new Promise<AIRouterGeneratedAudio>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        job.signal?.removeEventListener('abort', abort)
        callback()
      }
      // Cancelling during inference aborts the request and treats the process
      // as failed, so the next request restarts the helper.
      const abort = (): void => {
        finish(() => {
          session.pending.delete(requestId)
          this.failSession(session, new Error('IndexTTS 合成已中止'))
          reject(abortError())
        })
      }
      const timer = setTimeout(() => {
        finish(() => {
          session.pending.delete(requestId)
          this.failSession(
            session,
            new Error(`IndexTTS 合成超时（${Math.ceil(this.synthesisTimeoutMs / 1000)} 秒）`)
          )
          reject(new Error(`IndexTTS 合成超时（${Math.ceil(this.synthesisTimeoutMs / 1000)} 秒）`))
        })
      }, this.synthesisTimeoutMs)
      if (job.signal?.aborted) {
        abort()
        return
      }
      job.signal?.addEventListener('abort', abort, { once: true })
      session.pending.set(requestId, {
        resolve: (audio) => finish(() => resolve(audio)),
        reject: (error) => finish(() => reject(error))
      })
      const header = Buffer.from(`SYNTHESIZE ${requestId} ${bytes.byteLength}\n`, 'ascii')
      session.process.stdin.write(Buffer.concat([header, bytes]), (error) => {
        if (!error) return
        const pending = session.pending.get(requestId)
        session.pending.delete(requestId)
        pending?.reject(error)
        this.failSession(session, error as Error)
      })
    })
  }

  private failSession(session: HelperSession, error: Error): void {
    if (session.closed) return
    session.closed = true
    session.failure = error
    // Anyone still waiting for READY (startup timeout, protocol failure before
    // READY, or an abort during load) must observe the failure.
    session.rejectReady(error)
    for (const pending of session.pending.values()) pending.reject(error)
    session.pending.clear()
    // currentSession intentionally keeps pointing at the failed session: the
    // next load must await its full teardown before spawning a replacement.
    this.killSessionProcess(session)
  }

  private killSessionProcess(session: HelperSession): void {
    const process = session.process
    if (!process) return
    if (!process.killed) process.kill()
  }

  private async terminateSession(session: HelperSession): Promise<void> {
    if (session.terminating) return session.terminating
    session.terminating = (async () => {
      this.failSession(session, session.failure ?? new Error('IndexTTS helper 已终止'))
      this.killSessionProcess(session)
      // The spawn itself is asynchronous: wait until the child exists (and has
      // therefore registered its exit listener) before waiting for the exit.
      await session.spawned
      if (await resolvesWithin(session.exited, this.shutdownTimeoutMs)) return
      try {
        session.process?.kill('SIGKILL')
      } catch {
        // The process may already be gone between the check and the kill.
      }
      if (await resolvesWithin(session.exited, KILL_GRACE_MS)) return
      this.exitFailure = new Error('IndexTTS helper 未能退出，已停止后续加载')
    })()
    return session.terminating
  }

  private resolveHelperPath(): string {
    return this.options.helperPath ?? resolveHelperPath()
  }
}

function resolvesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    timer.unref?.()
    void promise.then(
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      () => {
        clearTimeout(timer)
        resolve(true)
      }
    )
  })
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) throw abortError()
  const aborted = new Promise<never>((_, reject) => {
    const listener = (): void => reject(abortError())
    signal.addEventListener('abort', listener, { once: true })
    void promise.then(
      () => signal.removeEventListener('abort', listener),
      () => signal.removeEventListener('abort', listener)
    )
  })
  return Promise.race([promise, aborted])
}

function resolveHelperPath(): string {
  const extension = process.platform === 'win32' ? '.exe' : ''
  const executable = `ls101-index-tts-helper-cpu${extension}`
  const electronApp = app as typeof app & { isPackaged?: boolean; getAppPath?: () => string }
  return electronApp.isPackaged
    ? path.join(
        process.resourcesPath,
        'index-tts',
        `${process.platform}-${process.arch}`,
        executable
      )
    : path.join(
        electronApp.getAppPath?.() ?? process.cwd(),
        'externals',
        'ai',
        'index-tts',
        'runtime',
        `${process.platform}-${process.arch}`,
        executable
      )
}

function helperEnvironment(helperPath: string, temporaryDirectory: string): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  const pathKeys = Object.keys(environment).filter((key) => key.toLowerCase() === 'path')
  const pathKey = pathKeys[0] ?? 'PATH'
  for (const duplicateKey of pathKeys.slice(1)) delete environment[duplicateKey]
  environment[pathKey] = [path.dirname(helperPath), environment[pathKey]]
    .filter(Boolean)
    .join(path.delimiter)
  // The helper materializes embedded tokenizer data; keep it inside a private
  // temporary directory that is removed once the process exits.
  environment.TMPDIR = temporaryDirectory
  environment.TEMP = temporaryDirectory
  environment.TMP = temporaryDirectory
  return environment
}

async function assertExecutableExists(filePath: string): Promise<void> {
  const stats = await stat(filePath).catch(() => null)
  if (!stats?.isFile()) {
    throw new Error(`缺少 IndexTTS 原生运行时：${filePath}；请先执行 yarn index-tts:build-runtime`)
  }
}

function findModel(
  models: AIRouterSpeechModelPackageManifest['models'],
  id: string
): AIRouterSpeechModelPackageModel {
  const model = models.find((candidate) => candidate.id === id)
  if (!model) throw new Error('IndexTTS 模型不存在')
  return model
}

function findVoice(
  voices: AIRouterSpeechModelPackageVoice[],
  id: string
): AIRouterSpeechModelPackageVoice {
  const voice = voices.find((candidate) => candidate.id === id)
  if (!voice) throw new Error('IndexTTS 音色不存在')
  return voice
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function abortError(): DOMException {
  return new DOMException('Speech synthesis was aborted', 'AbortError')
}

function withStderr(session: HelperSession, error: Error): Error {
  const diagnostics = session.stderr.trim()
  return diagnostics ? new Error(`${error.message}：${diagnostics}`) : error
}

interface ParsedWav {
  durationMs: number
}

function parseWav(data: Uint8Array, sampleRate: number): ParsedWav | null {
  if (data.byteLength < 44) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const text = (offset: number): string => String.fromCharCode(...data.subarray(offset, offset + 4))
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE') return null
  if (view.getUint32(4, true) !== data.byteLength - 8) return null
  if (text(12) !== 'fmt ' || view.getUint32(16, true) !== 16) return null
  if (view.getUint16(20, true) !== 1) return null
  if (view.getUint16(22, true) !== 1) return null
  if (view.getUint32(24, true) !== sampleRate) return null
  if (view.getUint32(28, true) !== sampleRate * 2) return null
  if (view.getUint16(32, true) !== 2) return null
  if (view.getUint16(34, true) !== 16) return null
  if (text(36) !== 'data') return null
  const dataBytes = view.getUint32(40, true)
  if (dataBytes !== data.byteLength - 44 || dataBytes % 2 !== 0) return null
  return { durationMs: (dataBytes / (sampleRate * 2)) * 1000 }
}
