import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import type { AIRouterGeneratedAudio } from '../shared'
import type { AIRouterLocalSpeechRequest, AIRouterLocalSpeechSynthesizer } from './speech-service'
import {
  assertIndexTtsManifest,
  indexTtsParameters,
  type IndexTtsParameters
} from './index-tts-model'
import {
  INDEX_TTS_MAX_REQUEST_BYTES,
  INDEX_TTS_MAX_TEXT_BYTES,
  IndexTtsProtocolDecoder,
  type IndexTtsProtocolMessage
} from './index-tts-protocol'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

interface HelperSession {
  key: string
  child: ChildProcessWithoutNullStreams
  ready: Deferred<void>
  exited: Deferred<void>
  isReady: boolean
  closed: boolean
  stopped: boolean
  stderr: Buffer
  temporaryDirectory: string
  failure?: Error
  response?: Deferred<AIRouterGeneratedAudio> & { requestId: string }
}

interface Job extends Deferred<AIRouterGeneratedAudio> {
  packageKey: string
  controller: AbortController
  run: (signal: AbortSignal) => Promise<AIRouterGeneratedAudio>
  removeAbortListener: () => void
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

// One owner, queue and process for all providers and voices using this engine.
export class IndexTtsSynthesizer implements AIRouterLocalSpeechSynthesizer {
  private readonly queue: Job[] = []
  private readonly blockedPackages = new Map<string, number>()
  private active?: Job
  private session?: HelperSession
  private draining?: Promise<void>
  private idleTimer?: ReturnType<typeof setTimeout>
  private disposed = false
  private suspended = 0
  private disposal?: Promise<void>
  private assetMutation: Promise<void> = Promise.resolve()

  constructor(private readonly options: IndexTtsSynthesizerOptions = {}) {}

  async synthesize(request: AIRouterLocalSpeechRequest): Promise<AIRouterGeneratedAudio> {
    try {
      if (this.disposed) throw new Error('IndexTTS 已关闭')
      const packageKey = JSON.stringify([
        request.manifest.package.id,
        request.manifest.package.version
      ])
      if (this.blockedPackages.has(packageKey)) throw new Error('IndexTTS 模型包正在删除')
      if (this.suspended) throw new Error('IndexTTS 模型资源正在更新，请稍后重试')
      if (request.signal?.aborted) throw abortError()
      if (request.format !== 'wav') throw new Error('IndexTTS 当前只支持 WAV 输出')
      if (request.manifest.runtime.engine !== 'index-tts')
        throw new Error('IndexTTS 模型包引擎不匹配')
      assertIndexTtsManifest(request.manifest)
      const model = request.manifest.models.find((item) => item.id === request.modelId)
      const voice = request.manifest.voices.find((item) => item.id === request.voiceId)
      if (!model || !voice) throw new Error('IndexTTS 模型或音色不存在')
      const text = request.text.trim()
      if (!text || Buffer.byteLength(text, 'utf8') > INDEX_TTS_MAX_TEXT_BYTES) {
        throw new Error(`IndexTTS 文本必须为 1 到 ${INDEX_TTS_MAX_TEXT_BYTES} 个 UTF-8 字节`)
      }
      const parameters = indexTtsParameters(model.parameters)
      const modelAsset = model.artifacts['tts-model'][0]
      const voiceAsset = voice.files[0]
      return await this.enqueue(packageKey, request.signal, async (signal) => {
        const [modelPath, voicePath] = await cancellable(
          Promise.all([request.resolveAssetPath(modelAsset), request.resolveAssetPath(voiceAsset)]),
          signal
        )
        checkSignal(signal)
        if (this.disposed) throw new Error('IndexTTS 已关闭')
        const key = JSON.stringify([
          modelPath,
          parameters.device,
          parameters.threads,
          parameters.lowMemory
        ])
        try {
          const session = await this.getSession(key, modelPath, parameters, signal)
          return await this.dispatch(session, text, voicePath, parameters, signal)
        } catch (error) {
          if (signal.aborted || this.session?.failure) await this.stopSession()
          throw error
        }
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new Error(
        `IndexTTS 合成失败（模型 ${request.modelId}，音色 ${request.voiceId}）：${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
  }

  async releasePackage(id: string, version: string, remove: () => Promise<void>): Promise<void> {
    if (this.disposed) throw new Error('IndexTTS 已关闭')
    const key = JSON.stringify([id, version])
    this.blockedPackages.set(key, (this.blockedPackages.get(key) ?? 0) + 1)
    this.suspended += 1
    clearTimeout(this.idleTimer)
    try {
      await this.mutateAssets(async () => {
        for (const job of [...this.queue]) {
          if (job.packageKey === key) this.cancelQueued(job, new Error('IndexTTS 模型包正在删除'))
        }
        if (this.active?.packageKey === key) this.active.controller.abort()
        await this.draining
        await this.stopSession()
        await remove()
      })
    } finally {
      const remaining = (this.blockedPackages.get(key) ?? 1) - 1
      if (remaining) this.blockedPackages.set(key, remaining)
      else this.blockedPackages.delete(key)
      this.suspended -= 1
      this.pump()
    }
  }

  async releaseAssets<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('IndexTTS 已关闭')
    this.suspended += 1
    clearTimeout(this.idleTimer)
    try {
      return await this.mutateAssets(async () => {
        for (const job of [...this.queue])
          this.cancelQueued(job, new Error('IndexTTS 模型资源正在更新'))
        this.active?.controller.abort()
        await this.draining
        await this.stopSession()
        return operation()
      })
    } finally {
      this.suspended -= 1
      this.pump()
    }
  }

  private mutateAssets<T>(operation: () => Promise<T>): Promise<T> {
    const mutation = this.assetMutation.then(operation)
    this.assetMutation = mutation.then(
      () => undefined,
      () => undefined
    )
    return mutation
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    clearTimeout(this.idleTimer)
    for (const job of [...this.queue]) this.cancelQueued(job, new Error('IndexTTS 已关闭'))
    this.active?.controller.abort()
    this.disposal = (async () => {
      await this.assetMutation
      await this.draining
      await this.stopSession()
    })()
    return this.disposal
  }

  private enqueue(
    packageKey: string,
    signal: AbortSignal | undefined,
    run: Job['run']
  ): Promise<AIRouterGeneratedAudio> {
    if (this.queue.length >= (this.options.maxQueuedRequests ?? 32)) {
      throw new Error('IndexTTS 等待队列已满')
    }
    clearTimeout(this.idleTimer)
    const job: Job = {
      ...deferred<AIRouterGeneratedAudio>(),
      packageKey,
      controller: new AbortController(),
      run,
      removeAbortListener: () => undefined
    }
    const abort = (): void => {
      job.controller.abort()
      if (job !== this.active) this.cancelQueued(job, abortError())
    }
    signal?.addEventListener('abort', abort, { once: true })
    job.removeAbortListener = () => signal?.removeEventListener('abort', abort)
    this.queue.push(job)
    if (signal?.aborted) abort()
    this.pump()
    return job.promise
  }

  private cancelQueued(job: Job, error: Error): void {
    const index = this.queue.indexOf(job)
    if (index < 0) return
    this.queue.splice(index, 1)
    job.removeAbortListener()
    job.reject(error)
  }

  private pump(): void {
    if (this.draining || this.disposed || this.suspended) return
    this.draining = this.drain().finally(() => {
      this.draining = undefined
      if (this.queue.length && !this.disposed && !this.suspended) this.pump()
      else if (!this.disposed && !this.suspended && this.session) {
        this.idleTimer = setTimeout(
          () => {
            // Run disposal through the same queue to avoid overlapping a new spawn.
            if (!this.draining && !this.queue.length) {
              this.draining = this.stopSession()
                .catch(() => undefined)
                .finally(() => {
                  this.draining = undefined
                  this.pump()
                })
            }
          },
          this.options.idleTimeoutMs ?? 5 * 60_000
        )
        this.idleTimer.unref?.()
      }
    })
  }

  private async drain(): Promise<void> {
    while (this.queue.length && !this.disposed && !this.suspended) {
      const job = this.queue.shift()!
      this.active = job
      try {
        checkSignal(job.controller.signal)
        job.resolve(await job.run(job.controller.signal))
      } catch (error) {
        job.reject(error)
      } finally {
        job.removeAbortListener()
        this.active = undefined
      }
    }
  }

  private async getSession(
    key: string,
    modelPath: string,
    parameters: IndexTtsParameters,
    signal: AbortSignal
  ): Promise<HelperSession> {
    if (this.session && (this.session.key !== key || this.session.stopped)) await this.stopSession()
    checkSignal(signal)
    if (this.disposed) throw new Error('IndexTTS 已关闭')
    if (!this.session) {
      const helperPath = this.options.helperPath ?? resolveHelperPath()
      const details = await cancellable(
        stat(helperPath).catch(() => null),
        signal
      )
      if (!details?.isFile()) {
        throw new Error(
          `缺少 IndexTTS 原生运行时：${helperPath}；请先执行 yarn index-tts:build-runtime --backend cuda`
        )
      }
      checkSignal(signal)
      const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'ls101-index-tts-'))
      try {
        checkSignal(signal)
        this.session = this.startSession(key, helperPath, modelPath, parameters, temporaryDirectory)
      } catch (error) {
        await rm(temporaryDirectory, { recursive: true, force: true })
        throw error
      }
    }
    const session = this.session
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await cancellable(
        Promise.race([
          session.ready.promise,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              this.failSession(session, new Error('IndexTTS helper 模型加载超时'))
              reject(session.failure)
            }, this.options.startupTimeoutMs ?? 180_000)
          })
        ]),
        signal
      )
      if (session.failure || session.stopped)
        throw session.failure ?? new Error('IndexTTS helper 已终止')
      return session
    } finally {
      clearTimeout(timer)
    }
  }

  private startSession(
    key: string,
    helperPath: string,
    modelPath: string,
    parameters: IndexTtsParameters,
    temporaryDirectory: string
  ): HelperSession {
    const child = (this.options.spawnProcess ?? spawn)(
      helperPath,
      [
        '--backend',
        'cuda',
        '--model',
        modelPath,
        '--device',
        String(parameters.device),
        '--threads',
        String(parameters.threads),
        '--low-memory',
        parameters.lowMemory ? '1' : '0'
      ],
      {
        env: helperEnvironment(helperPath, temporaryDirectory),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    )
    const session: HelperSession = {
      key,
      child,
      ready: deferred<void>(),
      exited: deferred<void>(),
      isReady: false,
      closed: false,
      stopped: false,
      stderr: Buffer.alloc(0),
      temporaryDirectory
    }
    const decoder = new IndexTtsProtocolDecoder(
      (message) => this.handleMessage(session, message),
      (error) => this.failSession(session, error)
    )
    const stdout = (chunk: Buffer): void => decoder.push(chunk)
    const stderr = (chunk: Buffer): void => {
      session.stderr = Buffer.concat([session.stderr, chunk.subarray(-16 * 1024)]).subarray(
        -16 * 1024
      )
    }
    const failure = (error: Error): void => this.failSession(session, error)
    const end = (): void => {
      decoder.end()
      if (!session.stopped) this.failSession(session, new Error('IndexTTS helper 输出管道已关闭'))
    }
    child.stdout.on('data', stdout)
    child.stdout.on('error', failure)
    child.stderr.on('data', stderr)
    child.stderr.on('error', failure)
    child.stdout.once('end', end)
    child.stdin.on('error', failure)
    child.once('error', failure)
    child.once('exit', (code, signal) => {
      if (!session.stopped)
        this.failSession(
          session,
          new Error(`IndexTTS helper 退出（code=${code}, signal=${signal}）`)
        )
    })
    child.once('close', () => {
      session.closed = true
      if (!session.stopped) this.failSession(session, new Error('IndexTTS helper 已关闭'))
      child.stdout.removeListener('data', stdout)
      child.stdout.removeListener('error', failure)
      child.stdout.removeListener('end', end)
      child.stderr.removeListener('data', stderr)
      child.stderr.removeListener('error', failure)
      child.stdin.removeListener('error', failure)
      session.exited.resolve()
    })
    return session
  }

  private failSession(session: HelperSession, error: Error): void {
    if (session.stopped) return
    session.stopped = true
    const diagnostics = session.stderr.toString('utf8').trim()
    session.failure = diagnostics
      ? new Error(`${error.message}：${diagnostics}`, { cause: error })
      : error
    session.ready.reject(session.failure)
    session.response?.reject(session.failure)
    session.response = undefined
    if (!session.closed) session.child.kill()
  }

  private handleMessage(session: HelperSession, message: IndexTtsProtocolMessage): void {
    if (session.stopped) return
    if (message.type === 'ready') {
      if (message.version !== 1 || session.isReady) {
        this.failSession(session, new Error('IndexTTS helper 协议版本或就绪状态无效'))
      } else {
        session.isReady = true
        session.ready.resolve()
      }
      return
    }
    const response = session.response
    if (!session.isReady || response?.requestId !== message.requestId) {
      this.failSession(session, new Error('IndexTTS helper 返回了未知请求'))
      return
    }
    if (message.type === 'error') response.reject(new Error(message.message))
    else {
      try {
        response.resolve(validateWav(message.data, message.sampleRate))
      } catch (error) {
        this.failSession(session, error instanceof Error ? error : new Error(String(error)))
      }
    }
    session.response = undefined
  }

  private async dispatch(
    session: HelperSession,
    text: string,
    voicePath: string,
    parameters: IndexTtsParameters,
    signal: AbortSignal
  ): Promise<AIRouterGeneratedAudio> {
    checkSignal(signal)
    const payload = Buffer.from(
      JSON.stringify({
        text,
        voicePath,
        language: parameters.language,
        maxTokens: parameters.maxTokens,
        ...(parameters.seed === undefined ? {} : { seed: parameters.seed })
      }),
      'utf8'
    )
    if (payload.length > INDEX_TTS_MAX_REQUEST_BYTES) throw new Error('IndexTTS 请求大小超过限制')
    const response = {
      ...deferred<AIRouterGeneratedAudio>(),
      requestId: randomUUID().replaceAll('-', '')
    }
    session.response = response
    const timer = setTimeout(
      () => this.failSession(session, new Error('IndexTTS 推理超时')),
      this.options.synthesisTimeoutMs ?? 600_000
    )
    try {
      session.child.stdin.write(
        Buffer.concat([
          Buffer.from(`SYNTHESIZE ${response.requestId} ${payload.length}\n`, 'ascii'),
          payload
        ]),
        (error) => {
          if (error) this.failSession(session, error)
        }
      )
      return await cancellable(response.promise, signal)
    } finally {
      clearTimeout(timer)
    }
  }

  private async stopSession(): Promise<void> {
    const session = this.session
    if (!session) return
    this.failSession(session, new Error('IndexTTS helper 已终止'))
    const timeout = this.options.shutdownTimeoutMs ?? 5000
    if (!(await exitsWithin(session, timeout))) {
      session.child.kill('SIGKILL')
      if (!(await exitsWithin(session, timeout))) {
        this.disposed = true
        for (const job of [...this.queue])
          this.cancelQueued(job, new Error('IndexTTS helper 未能退出'))
        throw new Error('IndexTTS helper 未能退出，已停止后续加载')
      }
    }
    await rm(session.temporaryDirectory, { recursive: true, force: true })
    if (this.session === session) this.session = undefined
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

async function exitsWithin(session: HelperSession, timeout: number): Promise<boolean> {
  if (session.closed) return true
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      session.exited.promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeout)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort)
      reject(abortError())
    }
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
    if (signal.aborted) abort()
  })
}

function abortError(): DOMException {
  return new DOMException('Speech synthesis was aborted', 'AbortError')
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function resolveHelperPath(): string {
  const platform = `${process.platform}-${process.arch}`
  const filename = `ls101-index-tts-helper-cuda${process.platform === 'win32' ? '.exe' : ''}`
  return app.isPackaged
    ? path.join(process.resourcesPath, 'index-tts', platform, filename)
    : path.join(
        app.getAppPath?.() ?? process.cwd(),
        'externals',
        'ai',
        'index-tts',
        'runtime',
        platform,
        filename
      )
}

function helperEnvironment(helperPath: string, temporaryDirectory: string): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  const keys = Object.keys(environment).filter((key) => key.toLowerCase() === 'path')
  const key = keys[0] ?? 'PATH'
  for (const duplicate of keys.slice(1)) delete environment[duplicate]
  environment[key] = [path.dirname(helperPath), environment[key]]
    .filter(Boolean)
    .join(path.delimiter)
  // audio.cpp materializes embedded tokenizer/config data under the OS temp
  // directory. Give this process its own directory and clean it after exit.
  return {
    ...environment,
    ...(process.platform === 'linux'
      ? {
          LD_LIBRARY_PATH: [path.dirname(helperPath), environment.LD_LIBRARY_PATH]
            .filter(Boolean)
            .join(path.delimiter)
        }
      : {}),
    TMPDIR: temporaryDirectory,
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory
  }
}

function validateWav(data: Uint8Array, sampleRate: number): AIRouterGeneratedAudio {
  const wav = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  // The helper emits canonical mono PCM16; keep metadata and payload consistent.
  if (
    wav.length < 46 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE' ||
    wav.readUInt32LE(4) !== wav.length - 8 ||
    wav.toString('ascii', 12, 16) !== 'fmt ' ||
    wav.readUInt32LE(16) !== 16 ||
    wav.readUInt16LE(20) !== 1 ||
    wav.readUInt16LE(22) !== 1 ||
    wav.readUInt32LE(24) !== sampleRate ||
    wav.readUInt32LE(28) !== sampleRate * 2 ||
    wav.readUInt16LE(32) !== 2 ||
    wav.readUInt16LE(34) !== 16 ||
    wav.toString('ascii', 36, 40) !== 'data' ||
    wav.readUInt32LE(40) !== wav.length - 44 ||
    (wav.length - 44) % 2 !== 0
  ) {
    throw new Error('IndexTTS helper 返回的 WAV 格式或长度无效')
  }
  return {
    data,
    format: 'wav',
    mediaType: 'audio/wav',
    sampleRate,
    channels: 1,
    durationMs: ((wav.length - 44) / (sampleRate * 2)) * 1000
  }
}
