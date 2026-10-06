import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AIRouterGeneratedAudio,
  AIRouterSpeechModelPackageModel,
  AIRouterSpeechModelPackageVoice
} from '../shared'
import type { AIRouterLocalSpeechRequest, AIRouterLocalSpeechSynthesizer } from './speech-service'
import { IndexTtsProtocolDecoder, type IndexTtsProtocolMessage } from './index-tts-protocol'
import {
  INDEX_TTS_HELPER_SHA256,
  isAllowedHelperDigest,
  runtimeAssetBasename,
  runtimeStagingDirectory,
  selectRuntimeAssets,
  type IndexTtsRuntimeAssetKind,
  type ResolvedIndexTtsRuntime
} from './index-tts-runtime'

export type AIRouterIndexTtsBackend = 'cpu' | 'cuda'

export interface IndexTtsSynthesizerOptions {
  spawnProcess?: typeof spawn
  helperPaths?: Partial<Record<AIRouterIndexTtsBackend, string>>
  helperAllowlist?: Record<string, readonly string[]>
  /** Writable root for the staged runtime; defaults to `os.tmpdir()/ls101-index-tts-runtime`. */
  runtimeRoot?: string
  startupTimeoutMs?: number
  synthesisTimeoutMs?: number
}

const PROTOCOL_VERSION = 1
const MAX_TEXT_BYTES = 64 * 1024
const DEFAULT_STARTUP_TIMEOUT_MS = 180_000
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 600_000
const DEFAULT_WEIGHT_TYPE = 'f32'
const DEFAULT_LANGUAGE = 'auto'
const HELPER_PLATFORM_KEY = `${process.platform}-${process.arch}`
const DEFAULT_RUNTIME_ROOT = path.join(os.tmpdir(), 'ls101-index-tts-runtime')
const VALID_WEIGHT_TYPES = new Set(['native', 'f32', 'f16', 'bf16', 'q8_0'])
const LANGUAGE_PATTERN = /^[a-z]{2,8}$/

interface IndexTtsRuntimeParameters {
  weightType: string
  language: string
  emotionAlpha: number
  durationFactor: number
  numBeams: number
  doSample: boolean
  temperature: number
  topK: number
  topP: number
  repetitionPenalty: number
  maxMelTokens: number
  threads: number
  startupTimeoutMs: number
  synthesisTimeoutMs: number
}

interface PendingRequest {
  resolve: (audio: AIRouterGeneratedAudio) => void
  reject: (error: unknown) => void
}

/** A resolved runtime asset: what the package declared plus where its bytes currently live. */
interface RuntimeSourceFile {
  assetPath: string
  kind: IndexTtsRuntimeAssetKind
  sha256: string
  name: string
  sourcePath: string
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

export class IndexTtsSynthesizer implements AIRouterLocalSpeechSynthesizer {
  private readonly sessions = new Map<string, Promise<HelperSession>>()
  private readonly activeSessions = new Set<HelperSession>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly stagingQueues = new Map<string, Promise<void>>()
  private readonly spawnProcess: typeof spawn
  private readonly runtimeRoot: string

  constructor(private readonly options: IndexTtsSynthesizerOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawn
    this.runtimeRoot = options.runtimeRoot ?? DEFAULT_RUNTIME_ROOT
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

  dispose(): void {
    for (const session of this.activeSessions) this.stopSession(session)
    for (const sessionPromise of this.sessions.values()) {
      void sessionPromise.then((session) => this.stopSession(session)).catch(() => undefined)
    }
    this.sessions.clear()
  }

  private async synthesizeRequest(
    request: AIRouterLocalSpeechRequest
  ): Promise<AIRouterGeneratedAudio> {
    if (request.format !== 'wav') throw new Error('IndexTTS 当前只支持 WAV 输出')
    if (request.manifest.runtime.engine !== 'index-tts') {
      throw new Error('模型包与本地 Provider 类型不匹配')
    }
    const bytes = Buffer.from(request.text, 'utf8')
    if (!bytes.byteLength || bytes.byteLength > MAX_TEXT_BYTES) {
      throw new Error(`IndexTTS 文本必须为 1 到 ${MAX_TEXT_BYTES} 个 UTF-8 字节`)
    }
    const model = findModel(request.manifest.models, request.modelId)
    const voice = findVoice(request.manifest.voices, request.voiceId)
    const modelAsset = firstArtifact(model, 'tts-model')
    const referenceAsset = voice.files[0]
    if (!modelAsset || !referenceAsset) {
      throw new Error('IndexTTS 模型包缺少 TTS 模型或音色参考音频')
    }
    const parameters = parseRuntimeParameters(model.parameters, this.options)
    const backend: AIRouterIndexTtsBackend = request.provider.backend === 'cpu' ? 'cpu' : 'cuda'
    const [modelPath, referencePath] = await Promise.all([
      request.resolveAssetPath(modelAsset),
      request.resolveAssetPath(referenceAsset)
    ])
    const key = sessionKey(modelPath, backend, parameters)
    return this.enqueue(key, async () => {
      if (request.signal?.aborted) throw abortError()
      const session = await this.getSession(key, modelPath, parameters, () =>
        this.stageRuntime(request, model.id, backend)
      )
      return this.dispatch(session, request.text, referencePath, parameters, request.signal)
    })
  }

  /**
   * Resolves and stages the runtime before anything is spawned. Every runtime asset travels inside
   * the model package, so its declared digest has to match the application-side allowlist and the
   * bytes copied into the staging directory have to match that digest before the helper may run.
   * The staged copy is what gets executed; the blob store's own permissions are never relied upon.
   */
  private async stageRuntime(
    request: AIRouterLocalSpeechRequest,
    modelId: string,
    backend: AIRouterIndexTtsBackend
  ): Promise<ResolvedIndexTtsRuntime> {
    const override = this.options.helperPaths?.[backend]
    if (override) return { backend, helperPath: override }
    const label = backend === 'cuda' ? 'CUDA' : 'CPU'
    const selected = selectRuntimeAssets(request.manifest, modelId, backend, HELPER_PLATFORM_KEY)
    if (!selected) {
      throw new Error(`IndexTTS 模型包未提供 ${HELPER_PLATFORM_KEY} 的 ${label} 运行时`)
    }
    const allowlist = this.options.helperAllowlist ?? INDEX_TTS_HELPER_SHA256
    for (const asset of selected) {
      if (!isAllowedHelperDigest(HELPER_PLATFORM_KEY, asset.sha256, allowlist)) {
        throw new Error(
          `IndexTTS 运行时未通过白名单校验（${HELPER_PLATFORM_KEY}）：${asset.assetPath}`
        )
      }
    }
    const files: RuntimeSourceFile[] = []
    const names = new Set<string>()
    for (const asset of selected) {
      const name = runtimeAssetBasename(asset.assetPath)
      if (!name) throw new Error(`IndexTTS 运行时资产路径无效：${asset.assetPath}`)
      if (names.has(name)) throw new Error(`IndexTTS 运行时资产重名：${name}`)
      names.add(name)
      const sourcePath = await request.resolveAssetPath(asset.assetPath)
      const stats = await stat(sourcePath).catch(() => null)
      if (!stats?.isFile()) {
        throw new Error(
          `缺少 IndexTTS 原生运行时：${sourcePath}；请先执行 yarn index-tts:build-runtime`
        )
      }
      files.push({ ...asset, name, sourcePath })
    }
    const stagingDirectory = runtimeStagingDirectory(
      this.runtimeRoot,
      HELPER_PLATFORM_KEY,
      request.manifest.package.id,
      request.manifest.package.version
    )
    return this.stageIntoDirectory(stagingDirectory, files, backend)
  }

  /**
   * Reuses the staging directory while every staged file still matches its declared digest and
   * mode, otherwise restages atomically: the files are copied and verified in a temporary sibling
   * directory that then replaces the target in one rename. Requests racing for the same directory
   * are serialised.
   */
  private async stageIntoDirectory(
    stagingDirectory: string,
    files: RuntimeSourceFile[],
    backend: AIRouterIndexTtsBackend
  ): Promise<ResolvedIndexTtsRuntime> {
    const helper = files.find((file) => file.kind === 'runtime-helper')
    if (!helper) throw new Error('IndexTTS 运行时缺少 helper 资产')
    return this.withStagingLock(stagingDirectory, async () => {
      if (!(await stagedRuntimeValid(stagingDirectory, files))) {
        await materializeRuntime(stagingDirectory, files)
      }
      return { backend, helperPath: path.join(stagingDirectory, helper.name) }
    })
  }

  private withStagingLock<T>(directory: string, task: () => Promise<T>): Promise<T> {
    const previous = this.stagingQueues.get(directory) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(task)
    const tail = operation.then(
      () => undefined,
      () => undefined
    )
    this.stagingQueues.set(directory, tail)
    void tail.finally(() => {
      if (this.stagingQueues.get(directory) === tail) this.stagingQueues.delete(directory)
    })
    return operation
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
    modelPath: string,
    parameters: IndexTtsRuntimeParameters,
    stage: () => Promise<ResolvedIndexTtsRuntime>
  ): Promise<HelperSession> {
    const existing = this.sessions.get(key)
    if (existing) return existing
    const created = this.startSession(key, modelPath, parameters, stage)
    this.sessions.set(key, created)
    void created.catch(() => {
      if (this.sessions.get(key) === created) this.sessions.delete(key)
    })
    return created
  }

  private async startSession(
    key: string,
    modelPath: string,
    parameters: IndexTtsRuntimeParameters,
    stage: () => Promise<ResolvedIndexTtsRuntime>
  ): Promise<HelperSession> {
    const runtime = await stage()
    const helperPath = runtime.helperPath
    await assertExecutableExists(helperPath)
    const args = [
      '--backend',
      runtime.backend,
      '--model',
      modelPath,
      '--weight-type',
      parameters.weightType,
      '--language',
      parameters.language,
      '--threads',
      String(parameters.threads)
    ]
    const child = this.spawnProcess(helperPath, args, {
      env: helperEnvironment(helperPath, { OMP_NUM_THREADS: String(parameters.threads) }),
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
    const decoder = new IndexTtsProtocolDecoder(
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
          `IndexTTS helper 退出（code=${code ?? 'null'}, signal=${signal ?? 'none'}）${diagnostics ? `：${diagnostics}` : ''}`
        )
      )
    })
    const timer = setTimeout(() => {
      fail(
        new Error(`IndexTTS helper 启动超时（${Math.ceil(parameters.startupTimeoutMs / 1000)} 秒）`)
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

  private handleMessage(
    session: HelperSession,
    message: IndexTtsProtocolMessage,
    resolveReady: () => void,
    fail: (error: Error) => void
  ): void {
    if (message.type === 'ready') {
      if (message.version !== PROTOCOL_VERSION) {
        fail(new Error(`IndexTTS helper 协议版本不兼容：${message.version}`))
      } else {
        resolveReady()
      }
      return
    }
    const pending = session.pending.get(message.requestId)
    if (!pending) {
      fail(new Error(`IndexTTS helper 返回了未知请求：${message.requestId}`))
      return
    }
    session.pending.delete(message.requestId)
    if (message.type === 'error') {
      pending.reject(new Error(message.message || 'IndexTTS 合成失败'))
      return
    }
    if (!isWav(message.data)) {
      pending.reject(new Error('IndexTTS helper 返回的音频不是有效 WAV'))
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
    referencePath: string,
    parameters: IndexTtsRuntimeParameters,
    signal?: AbortSignal
  ): Promise<AIRouterGeneratedAudio> {
    const bytes = Buffer.from(text, 'utf8')
    if (!bytes.byteLength || bytes.byteLength > MAX_TEXT_BYTES) {
      throw new Error(`IndexTTS 文本必须为 1 到 ${MAX_TEXT_BYTES} 个 UTF-8 字节`)
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
            new Error(`IndexTTS 合成超时（${Math.ceil(parameters.synthesisTimeoutMs / 1000)} 秒）`)
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
        `${JSON.stringify({
          op: 'synthesize',
          id: requestId,
          textBytes: bytes.byteLength,
          voiceRef: referencePath,
          emotionAlpha: parameters.emotionAlpha,
          durationFactor: parameters.durationFactor,
          numBeams: parameters.numBeams,
          doSample: parameters.doSample,
          temperature: parameters.temperature,
          topK: parameters.topK,
          topP: parameters.topP,
          repetitionPenalty: parameters.repetitionPenalty,
          maxMelTokens: parameters.maxMelTokens
        })}\n`,
        'utf8'
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
    const error = new Error('IndexTTS helper 已终止')
    for (const pending of session.pending.values()) pending.reject(error)
    session.pending.clear()
    this.sessions.delete(session.key)
    this.activeSessions.delete(session)
    session.process.stdin.destroy()
    if (!session.process.killed) session.process.kill()
  }
}

function parseRuntimeParameters(
  parameters: Record<string, unknown>,
  options: IndexTtsSynthesizerOptions
): IndexTtsRuntimeParameters {
  const synthesis = recordValue(parameters.synthesis)
  return {
    weightType: weightTypeValue(synthesis.weightType) ?? DEFAULT_WEIGHT_TYPE,
    language: languageValue(synthesis.language) ?? DEFAULT_LANGUAGE,
    emotionAlpha: numberValue(synthesis.emotionAlpha, 0, 10) ?? 1.0,
    durationFactor: numberValue(synthesis.durationFactor, 0.1, 10) ?? 1.0,
    numBeams: integerValue(synthesis.numBeams, 1, 16) ?? 3,
    doSample: booleanValue(synthesis.doSample) ?? booleanValue(synthesis.sample) ?? true,
    temperature: numberValue(synthesis.temperature, 0, 5) ?? 0.8,
    topK: integerValue(synthesis.topK, 0, 2048) ?? 30,
    topP: numberValue(synthesis.topP, 0, 1) ?? 0.8,
    repetitionPenalty: numberValue(synthesis.repetitionPenalty, 0.1, 10) ?? 10.0,
    maxMelTokens: integerValue(synthesis.maxMelTokens, 1, 8192) ?? 1500,
    threads: integerValue(synthesis.threads, 1, 256) ?? 4,
    startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    synthesisTimeoutMs: options.synthesisTimeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS
  }
}

function sessionKey(
  modelPath: string,
  backend: AIRouterIndexTtsBackend,
  parameters: IndexTtsRuntimeParameters
): string {
  return JSON.stringify([
    modelPath,
    backend,
    parameters.weightType,
    parameters.language,
    parameters.threads
  ])
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

async function assertExecutableExists(filePath: string): Promise<void> {
  const stats = await stat(filePath).catch(() => null)
  if (!stats?.isFile()) {
    throw new Error(`缺少 IndexTTS 原生运行时：${filePath}；请先执行 yarn index-tts:build-runtime`)
  }
}

/** Mode a staged runtime file gets on POSIX: helpers and shared objects are executable. */
function runtimeFileMode(kind: IndexTtsRuntimeAssetKind, name: string): number {
  if (kind === 'runtime-helper') return 0o755
  return /\.so(\.\d+)*$/i.test(name) ? 0o755 : 0o644
}

/** True while every staged file exists, still hashes to its declared digest and keeps its mode. */
async function stagedRuntimeValid(
  stagingDirectory: string,
  files: RuntimeSourceFile[]
): Promise<boolean> {
  for (const file of files) {
    const stagedPath = path.join(stagingDirectory, file.name)
    const stats = await stat(stagedPath).catch(() => null)
    if (!stats?.isFile()) return false
    if (process.platform !== 'win32') {
      const expectedMode = runtimeFileMode(file.kind, file.name)
      if ((stats.mode & 0o777) !== expectedMode) return false
    }
    if ((await sha256File(stagedPath)) !== file.sha256) return false
  }
  return true
}

/**
 * Copies the verified runtime into a temporary sibling directory and swaps it in with one rename,
 * so a reader never observes a half-copied helper or library.
 */
async function materializeRuntime(
  stagingDirectory: string,
  files: RuntimeSourceFile[]
): Promise<void> {
  const temporaryDirectory = `${stagingDirectory}.tmp-${randomUUID().replaceAll('-', '')}`
  await rm(temporaryDirectory, { recursive: true, force: true })
  await mkdir(temporaryDirectory, { recursive: true })
  try {
    for (const file of files) {
      const stagedPath = path.join(temporaryDirectory, file.name)
      await copyFile(file.sourcePath, stagedPath)
      if ((await sha256File(stagedPath)) !== file.sha256) {
        throw new Error(`IndexTTS 运行时文件校验失败：${file.assetPath}`)
      }
      if (process.platform !== 'win32') {
        await chmod(stagedPath, runtimeFileMode(file.kind, file.name))
      }
    }
    await mkdir(path.dirname(stagingDirectory), { recursive: true })
    try {
      await rename(temporaryDirectory, stagingDirectory)
    } catch {
      // The target exists and is not an empty directory: replace it, then rename.
      await rm(stagingDirectory, { recursive: true, force: true })
      await rename(temporaryDirectory, stagingDirectory)
    }
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

async function sha256File(filePath: string): Promise<string | null> {
  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  } catch {
    return null
  }
  return hash.digest('hex')
}

function findModel(
  models: AIRouterSpeechModelPackageModel[],
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

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function weightTypeValue(value: unknown): string | null {
  return typeof value === 'string' && VALID_WEIGHT_TYPES.has(value) ? value : null
}

function languageValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized === DEFAULT_LANGUAGE || LANGUAGE_PATTERN.test(normalized) ? normalized : null
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
