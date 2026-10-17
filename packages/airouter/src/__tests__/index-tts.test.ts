import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIRouterLocalSpeechRequest } from '../main/speech-service'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getAppPath: () => process.cwd() } }))

import { IndexTtsSynthesizer } from '../main/index-tts'

type Respond = (request: {
  id: string
  payload: Record<string, unknown>
}) => 'result' | 'error' | 'silence'

/**
 * Protocol double: speaks the helper's wire protocol. Instances are handed out
 * one per spawn so tests can model process replacement, and each can be
 * configured per request through the `respond` callback to emit results,
 * per-request errors, or nothing at all.
 */
class FakeHelper extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false
  killCount = 0
  sigkills = 0
  received: Array<{ id: string; payload: Record<string, unknown> }> = []
  private input = Buffer.alloc(0)

  constructor(
    private readonly respond: Respond = () => 'result',
    private readonly options: {
      readyVersion?: number
      duplicateReady?: boolean
      neverReady?: boolean
    } = {}
  ) {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      this.input = Buffer.concat([this.input, chunk])
      this.drain()
    })
    if (!options.neverReady) {
      queueMicrotask(() => {
        this.stdout.write(Buffer.from(`READY ${this.options.readyVersion ?? 1}\n`))
        if (this.options.duplicateReady) {
          this.stdout.write(Buffer.from('READY 1\n'))
        }
      })
    }
  }

  kill(signal?: string): boolean {
    this.killCount += 1
    if (signal === 'SIGKILL') this.sigkills += 1
    if (this.killed) return false
    this.killed = true
    queueMicrotask(() => {
      this.stdout.end()
      this.stderr.end()
      this.emit('exit', 0, signal ?? 'SIGTERM')
    })
    return true
  }

  answer(id: string, kind: 'result' | 'error', message?: string): void {
    if (kind === 'error') {
      const bytes = Buffer.from(message ?? 'synthesis failed', 'utf8')
      this.stdout.write(Buffer.concat([Buffer.from(`ERROR ${id} ${bytes.byteLength}\n`), bytes]))
      return
    }
    const wav = createWav()
    this.stdout.write(
      Buffer.concat([
        Buffer.from(`RESULT ${id} 22050 ${wav.byteLength}\n`),
        wav.subarray(0, 17),
        wav.subarray(17)
      ])
    )
  }

  private drain(): void {
    const newline = this.input.indexOf(0x0a)
    if (newline < 0) return
    const fields = this.input.subarray(0, newline).toString('ascii').split(' ')
    const size = Number(fields[2])
    if (this.input.byteLength < newline + 1 + size) return
    const payload = JSON.parse(
      this.input.subarray(newline + 1, newline + 1 + size).toString('utf8')
    ) as Record<string, unknown>
    this.input = this.input.subarray(newline + 1 + size)
    const id = fields[1]
    this.received.push({ id, payload })
    const behavior = this.respond({ id, payload })
    if (behavior === 'result') this.answer(id, 'result')
    else if (behavior === 'error') this.answer(id, 'error', 'invalid reference audio')
    if (this.input.byteLength) this.drain()
  }
}

/** A spawn double that hands out one fake helper per spawn. */
class HelperSpawner {
  readonly helpers: FakeHelper[] = []
  readonly spawnProcess = vi.fn(
    (
      _command: string,
      _args: string[],
      options?: { env?: Record<string, string | undefined> }
    ) => {
      const environment = options?.env ?? {}
      expect(environment.TMPDIR).toMatch(/index-tts-/)
      expect(environment.TEMP).toBe(environment.TMPDIR)
      expect(environment.TMP).toBe(environment.TMPDIR)
      const helper = this.helpers.shift()
      if (!helper) throw new Error('unexpected spawn: no helper left in the queue')
      return helper as unknown as ChildProcessWithoutNullStreams
    }
  )

  constructor(...helpers: FakeHelper[]) {
    this.helpers.push(...helpers)
  }

  get spawn(): typeof spawn {
    return this.spawnProcess as unknown as typeof spawn
  }
}

describe('IndexTtsSynthesizer', () => {
  let directory: string
  let helperPath: string
  let request: AIRouterLocalSpeechRequest

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'index-tts-test-'))
    helperPath = path.join(directory, 'helper')
    await Promise.all([
      writeFile(helperPath, 'mock'),
      writeFile(path.join(directory, 'model.gguf'), 'model'),
      writeFile(path.join(directory, 'other.gguf'), 'other'),
      writeFile(path.join(directory, 'voice.wav'), 'voice')
    ])
    request = createRequest(directory)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('serializes requests through one helper process and passes voices per request', async () => {
    // Invariant 1 + 2: single process, strictly serial dispatch; the session
    // key excludes the voice so switching voices reuses the process.
    const helper = new FakeHelper()
    const spawner = new HelperSpawner(helper)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    const otherVoice = { ...request, voiceId: 'american-man' }

    const first = await synthesizer.synthesize(request)
    const second = await synthesizer.synthesize(otherVoice)

    expect(first).toMatchObject({ format: 'wav', mediaType: 'audio/wav', sampleRate: 22050 })
    expect(second.durationMs).toBeGreaterThan(0)
    expect(spawner.spawnProcess).toHaveBeenCalledOnce()
    expect(helper.received.map((entry) => entry.payload.voicePath)).toEqual([
      path.join(directory, 'voice.wav'),
      path.join(directory, 'voice.wav')
    ])
    expect(helper.received.map((entry) => entry.payload.language)).toEqual(['en', 'en'])
    expect(helper.received.map((entry) => entry.payload.maxTokens)).toEqual([1500, 1500])
    await synthesizer.dispose()
    expect(helper.killed).toBe(true)
  })

  it('spawns the CPU helper with the documented arguments and private temp dir', async () => {
    const helper = new FakeHelper()
    const spawner = new HelperSpawner(helper)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    await synthesizer.synthesize(request)

    expect(spawner.spawnProcess).toHaveBeenCalledWith(
      helperPath,
      [
        '--backend',
        'cpu',
        '--model',
        path.join(directory, 'model.gguf'),
        '--device',
        '0',
        '--threads',
        '4',
        '--low-memory',
        '1'
      ],
      expect.objectContaining({ windowsHide: true })
    )
    const environment = spawner.spawnProcess.mock.calls[0][2]?.env
    const pathKey = Object.keys(environment ?? {}).find((key) => key.toLowerCase() === 'path')
    expect(pathKey).toBeDefined()
    expect(environment?.[pathKey!]?.split(path.delimiter)[0]).toBe(directory)
    await synthesizer.dispose()
  })

  it('restarts the process when the model path changes and waits for the old exit', async () => {
    // Invariant 3: a key change fully tears down the previous process first.
    const first = new FakeHelper()
    const second = new FakeHelper()
    const spawner = new HelperSpawner(first, second)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    await synthesizer.synthesize(request)
    expect(first.killed).toBe(false)
    const replaced = await synthesizer.synthesize(
      requestWithModelPath(request, 'models/other.gguf')
    )
    expect(replaced.format).toBe('wav')
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(2)
    expect(first.killed).toBe(true)
    expect(second.received).toHaveLength(1)
    expect(second.received[0].payload.voicePath).toBe(path.join(directory, 'voice.wav'))
    await synthesizer.dispose()
    expect(second.killed).toBe(true)
  })

  it('escalates to SIGKILL and refuses further loads when a helper will not exit', async () => {
    // Invariant 3: SIGTERM grace, then SIGKILL, then permanent failure.
    const stubborn = new FakeHelper()
    stubborn.kill = () => true // ignores SIGTERM and SIGKILL alike
    const spawner = new HelperSpawner(stubborn)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn,
      shutdownTimeoutMs: 30
    })
    await synthesizer.synthesize(request)
    await expect(
      synthesizer.synthesize(requestWithModelPath(request, 'models/other.gguf'))
    ).rejects.toThrow('未能退出')
    await expect(synthesizer.synthesize(request)).rejects.toThrow('未能退出')
    expect(spawner.spawnProcess).toHaveBeenCalledOnce()
    await synthesizer.dispose()
  }, 20_000)

  it('rejects a queued request immediately on abort without disturbing the active one', async () => {
    // Invariant 4 (queued cancellation).
    const helper = new FakeHelper(() => 'silence')
    const spawner = new HelperSpawner(helper)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    const activeController = new AbortController()
    const active = synthesizer.synthesize({ ...request, signal: activeController.signal })
    await vi.waitFor(() => expect(helper.received).toHaveLength(1))
    const queuedController = new AbortController()
    const queued = synthesizer.synthesize({ ...request, signal: queuedController.signal })
    queuedController.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(activeController.signal.aborted).toBe(false)
    helper.answer(helper.received[0].id, 'result')
    await expect(active).resolves.toMatchObject({ format: 'wav' })
    await synthesizer.dispose()
  })

  it('aborts a loading session and lets later requests recover', async () => {
    // Invariant 4 (loading cancellation): the load is stopped and the next
    // request spawns a fresh process.
    // neverReady keeps the session in the model-loading phase forever, which
    // is exactly the window an abort during load has to interrupt.
    const loading = new FakeHelper(() => 'result', { neverReady: true })
    const recovered = new FakeHelper()
    const spawner = new HelperSpawner(loading, recovered)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn,
      startupTimeoutMs: 60_000
    })
    const controller = new AbortController()
    const pending = synthesizer.synthesize({ ...request, signal: controller.signal })
    // Abort once the helper has spawned and is busy loading the model.
    await vi.waitFor(() => expect(spawner.spawnProcess).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(loading.killed).toBe(true))
    const audio = await synthesizer.synthesize(request)
    expect(audio.format).toBe('wav')
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(2)
    expect(recovered.received).toHaveLength(1)
    await synthesizer.dispose()
  })

  it('aborts an in-flight request, treats the process as failed, and restarts for the next one', async () => {
    // Invariant 4 (inference cancellation).
    const first = new FakeHelper(() => 'silence')
    const second = new FakeHelper()
    const spawner = new HelperSpawner(first, second)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    const controller = new AbortController()
    const pending = synthesizer.synthesize({ ...request, signal: controller.signal })
    await vi.waitFor(() => expect(first.received).toHaveLength(1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(first.killed).toBe(true))
    const next = await synthesizer.synthesize(request)
    expect(next.format).toBe('wav')
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(2)
    await synthesizer.dispose()
  })

  it('recovers from a startup timeout and a synthesis timeout through a restart', async () => {
    // Invariant 5: both timeout kinds invalidate the session and the next
    // request recovers by spawning a new process.
    // Helper #1 never reports READY (startup timeout). Helper #2 answers, so
    // the same request then succeeds without a new spawn. Helper #3 accepts the
    // request but never answers (synthesis timeout). Helper #4 recovers again.
    const neverReady = new FakeHelper(() => 'result', { neverReady: true })
    const recoveredOnce = new FakeHelper()
    const neverAnswers = new FakeHelper(() => 'silence')
    const recoveredTwice = new FakeHelper()
    const spawner = new HelperSpawner(neverReady, recoveredOnce, neverAnswers, recoveredTwice)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn,
      startupTimeoutMs: 40,
      synthesisTimeoutMs: 80
    })
    await expect(synthesizer.synthesize(request)).rejects.toThrow('启动超时')
    expect(spawner.spawnProcess).toHaveBeenCalledOnce()
    // The next request spawns a fresh process and succeeds, then keeps serving
    // on that same process.
    const audio = await synthesizer.synthesize(request)
    expect(audio.format).toBe('wav')
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(2)
    expect(recoveredOnce.received).toHaveLength(1)
    // Forcing a different model path retires the live session, so the request
    // lands on neverAnswers and hits the synthesis timeout.
    await expect(
      synthesizer.synthesize(requestWithModelPath(request, 'models/other.gguf'))
    ).rejects.toThrow('合成超时')
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(3)
    const after = await synthesizer.synthesize(request)
    expect(after.format).toBe('wav')
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(4)
    expect(recoveredTwice.received).toHaveLength(1)
    await synthesizer.dispose()
  })

  it('keeps the session alive after a per-request ERROR', async () => {
    // Invariant 6.
    let failures = 0
    const helper = new FakeHelper(() => (failures++ === 0 ? 'error' : 'result'))
    const spawner = new HelperSpawner(helper)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    await expect(synthesizer.synthesize(request)).rejects.toThrow('invalid reference audio')
    const second = await synthesizer.synthesize(request)
    expect(second.format).toBe('wav')
    expect(spawner.spawnProcess).toHaveBeenCalledOnce()
    expect(helper.killed).toBe(false)
    await synthesizer.dispose()
    expect(helper.killed).toBe(true)
  })

  it('invalidates the session on protocol malformation and ignores late events', async () => {
    // Invariant 7: unknown requestId, duplicate READY, invalid WAV all fail
    // the session; stale frames afterwards must not disturb a new session.
    const first = new FakeHelper(() => 'silence')
    const duplicateReady = new FakeHelper(() => 'silence', { duplicateReady: true })
    const invalidWav = new FakeHelper(() => 'silence')
    const recovered = new FakeHelper()
    const spawner = new HelperSpawner(first, duplicateReady, invalidWav, recovered)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })

    const unknown = synthesizer.synthesize(request)
    await vi.waitFor(() => expect(first.received).toHaveLength(1))
    first.stdout.write(Buffer.from('RESULT nosuchrequest 22050 44\n'))
    first.stdout.write(createWav())
    await expect(unknown).rejects.toThrow('未知请求')

    await expect(synthesizer.synthesize(request)).rejects.toThrow('READY')

    const badPayload = synthesizer.synthesize(request)
    await vi.waitFor(() => expect(invalidWav.received).toHaveLength(1))
    const junk = Buffer.alloc(64, 1)
    invalidWav.stdout.write(
      Buffer.concat([
        Buffer.from(`RESULT ${invalidWav.received[0].id} 22050 ${junk.byteLength}\n`),
        junk
      ])
    )
    await expect(badPayload).rejects.toThrow('WAV')

    // A late frame from the dead first helper must not disturb the new session.
    first.stdout.write(Buffer.from(`RESULT ${first.received[0].id} 22050 44\n`))
    first.stdout.write(createWav())
    const next = await synthesizer.synthesize(request)
    expect(next.format).toBe('wav')
    expect(recovered.received).toHaveLength(1)
    await synthesizer.dispose()
  })

  it('invalidates the session when the helper exits non-zero and appends stderr', async () => {
    // Invariant 7: a non-zero exit fails the session with the stderr tail.
    const helper = new FakeHelper(() => 'silence')
    const replacement = new FakeHelper()
    const spawner = new HelperSpawner(helper, replacement)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    const pending = synthesizer.synthesize(request)
    await vi.waitFor(() => expect(helper.received).toHaveLength(1))
    helper.stderr.write(Buffer.from('engine exploded while decoding'))
    helper.emit('exit', 3, null)
    await expect(pending).rejects.toThrow(/退出（code=3.*engine exploded/s)
    const after = await synthesizer.synthesize(request)
    expect(after.format).toBe('wav')
    await synthesizer.dispose()
  })

  it('coordinates package deletion and asset updates with synthesis', async () => {
    // Invariant 8.
    const helper = new FakeHelper(() => 'silence')
    const replacement = new FakeHelper()
    const spawner = new HelperSpawner(helper, replacement)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    const active = synthesizer.synthesize(request)
    await vi.waitFor(() => expect(helper.received).toHaveLength(1))
    const queued = synthesizer.synthesize(request)

    let removed = false
    const deletion = synthesizer.releasePackage('index-package', '1.0.0', async () => {
      removed = true
      expect(helper.killed).toBe(true)
    })
    await expect(queued).rejects.toThrow('IndexTTS 模型包正在删除')
    helper.answer(helper.received[0].id, 'result')
    await expect(active).resolves.toMatchObject({ format: 'wav' })
    await deletion
    expect(removed).toBe(true)

    // While an asset update runs, new requests are refused and the operation
    // sees a released helper process.
    const replacementSession = synthesizer.synthesize(request)
    await vi.waitFor(() => expect(replacement.received).toHaveLength(1))
    replacement.answer(replacement.received[0].id, 'result')
    await replacementSession
    let observedKilled = false
    await synthesizer.releaseAssets(async () => {
      observedKilled = replacement.killed
    })
    expect(observedKilled).toBe(true)
    const second = new FakeHelper()
    spawner.helpers.push(second)
    await expect(synthesizer.synthesize(request)).resolves.toMatchObject({ format: 'wav' })
    await synthesizer.dispose()
  })

  it('serializes coordinated file operations with each other', async () => {
    // Invariant 8: the remove callbacks never overlap.
    const helper = new FakeHelper()
    const spawner = new HelperSpawner(helper)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    const order: string[] = []
    const first = synthesizer.releasePackage('a', '1', async () => {
      order.push('a-start')
      await new Promise((resolve) => setTimeout(resolve, 30))
      order.push('a-end')
    })
    const second = synthesizer.releaseAssets(async () => {
      order.push('b-start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('b-end')
    })
    await Promise.all([first, second])
    expect(order.indexOf('a-end')).toBeLessThan(order.indexOf('b-start'))
    await synthesizer.dispose()
  })

  it('releases the process after the idle timeout', async () => {
    // Invariant 9.
    const helper = new FakeHelper()
    const replacement = new FakeHelper()
    const spawner = new HelperSpawner(helper, replacement)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn,
      idleTimeoutMs: 1_000
    })
    await synthesizer.synthesize(request)
    expect(helper.killed).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 1_400))
    expect(helper.killed).toBe(true)
    const reused = await synthesizer.synthesize(request)
    expect(reused.format).toBe('wav')
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(2)
    await synthesizer.dispose()
  }, 10_000)

  it('rejects queued requests and never spawns again after dispose', async () => {
    // Invariant 10.
    const helper = new FakeHelper(() => 'silence')
    const spawner = new HelperSpawner(helper)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    const active = synthesizer.synthesize(request)
    await vi.waitFor(() => expect(helper.received).toHaveLength(1))
    const queued = synthesizer.synthesize(request)
    const disposal = synthesizer.dispose()
    await expect(queued).rejects.toThrow('IndexTTS 已关闭')
    helper.answer(helper.received[0].id, 'result')
    await expect(active).resolves.toMatchObject({ format: 'wav' })
    await disposal
    await synthesizer.dispose()
    await expect(synthesizer.synthesize(request)).rejects.toThrow('IndexTTS 已关闭')
    expect(spawner.spawnProcess).toHaveBeenCalledOnce()
  })

  it('validates the request before spawning a helper', async () => {
    // Invariant 11.
    const spawner = new HelperSpawner()
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    await expect(synthesizer.synthesize({ ...request, format: 'mp3' })).rejects.toThrow(
      'IndexTTS 当前只支持 WAV 输出'
    )
    await expect(synthesizer.synthesize({ ...request, text: '   ' })).rejects.toThrow('UTF-8 字节')
    await expect(
      synthesizer.synthesize({ ...request, text: 'x'.repeat(70_000) })
    ).rejects.toThrow('UTF-8 字节')
    await expect(synthesizer.synthesize({ ...request, modelId: 'missing' })).rejects.toThrow(
      '模型不存在'
    )
    await expect(synthesizer.synthesize({ ...request, voiceId: 'missing' })).rejects.toThrow(
      '音色不存在'
    )
    const badManifest = {
      ...request.manifest,
      models: [{ ...request.manifest.models[0], artifacts: { 'tts-model': [] } }]
    }
    await expect(synthesizer.synthesize({ ...request, manifest: badManifest })).rejects.toThrow(
      'tts-model'
    )
    const controller = new AbortController()
    controller.abort()
    await expect(
      synthesizer.synthesize({ ...request, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawner.spawnProcess).not.toHaveBeenCalled()
    await synthesizer.dispose()
  })

  it('rejects a missing helper runtime with an actionable message', async () => {
    const synthesizer = new IndexTtsSynthesizer({
      helperPath: path.join(directory, 'missing-helper'),
      spawnProcess: vi.fn() as unknown as typeof spawn
    })
    await expect(synthesizer.synthesize(request)).rejects.toThrow('缺少 IndexTTS 原生运行时')
    await synthesizer.dispose()
  })

  it('validates the returned WAV field by field', async () => {
    // Invariant 12: the RESULT payload is validated against a canonical
    // mono PCM16 WAV header before it is returned.
    const helper = new FakeHelper()
    const spawner = new HelperSpawner(helper)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    const audio = await synthesizer.synthesize(request)
    expect(audio.channels).toBe(1)
    expect(audio.sampleRate).toBe(22050)
    expect(audio.durationMs).toBe(2_000)
    expect(audio.data.byteLength).toBe(44 + 44_100 * 2)
    expect(audio.mediaType).toBe('audio/wav')
    await synthesizer.dispose()
  })

  it('rejects more than the configured queued requests', async () => {
    // Invariant 2: the queue cap.
    const helper = new FakeHelper(() => 'silence')
    const replacement = new FakeHelper()
    const spawner = new HelperSpawner(helper, replacement)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn,
      maxQueuedRequests: 2
    })
    const active = synthesizer.synthesize(request)
    await vi.waitFor(() => expect(helper.received).toHaveLength(1))
    const queued = [synthesizer.synthesize(request), synthesizer.synthesize(request)]
    await expect(synthesizer.synthesize(request)).rejects.toThrow('IndexTTS 等待队列已满')
    helper.answer(helper.received[0].id, 'result')
    await expect(active).resolves.toMatchObject({ format: 'wav' })
    // The queue drains strictly one at a time, so each queued request is
    // answered as soon as the helper reports receiving it.
    for (const pending of queued) {
      await vi.waitFor(() => expect(helper.received.length).toBeGreaterThan(0))
      // Requests are serialized: answer the newest one and drop it from the list.
      const entry = helper.received.at(-1)!
      helper.answer(entry.id, 'result')
      await expect(pending).resolves.toMatchObject({ format: 'wav' })
    }
    await synthesizer.dispose()
  })

  it('passes load parameters from the package manifest into the spawn arguments', async () => {
    const helper = new FakeHelper()
    const spawner = new HelperSpawner(helper)
    const synthesizer = new IndexTtsSynthesizer({
      helperPath,
      spawnProcess: spawner.spawn
    })
    const tuned = {
      ...request,
      manifest: {
        ...request.manifest,
        models: [
          {
            ...request.manifest.models[0],
            parameters: {
              load: { threads: 12, device: 2, lowMemory: false },
              synthesis: { language: 'zh', maxTokens: 8192, seed: 20260918 }
            }
          }
        ]
      }
    }
    await synthesizer.synthesize(tuned)
    expect(spawner.spawnProcess).toHaveBeenCalledWith(
      helperPath,
      expect.arrayContaining(['--threads', '12', '--device', '2', '--low-memory', '0']),
      expect.any(Object)
    )
    expect(helper.received[0].payload).toMatchObject({
      language: 'zh',
      maxTokens: 8192,
      seed: 20260918
    })
    await synthesizer.dispose()
  })
})

function requestWithModelPath(
  base: AIRouterLocalSpeechRequest,
  assetPath: string
): AIRouterLocalSpeechRequest {
  return {
    ...base,
    manifest: {
      ...base.manifest,
      assets: [
        { path: assetPath, kind: 'tts-model', size: 5, sha256: 'a'.repeat(64) },
        ...base.manifest.assets.filter((asset) => asset.kind !== 'tts-model')
      ],
      models: [{ ...base.manifest.models[0], artifacts: { 'tts-model': [assetPath] } }]
    }
  }
}

function createRequest(directory: string): AIRouterLocalSpeechRequest {
  return {
    provider: {
      id: 'provider',
      name: 'IndexTTS',
      kind: 'local',
      type: 'index-tts',
      baseUrl: '',
      modelPackageId: 'index-package',
      modelPackageVersion: '1.0.0',
      models: [{ id: 'index-model', enabled: true }],
      voices: [
        { id: 'american-woman', enabled: true },
        { id: 'american-man', enabled: true }
      ]
    },
    manifest: {
      format: 'ls101.tts-model-package',
      formatVersion: 1,
      package: { id: 'index-package', version: '1.0.0', name: 'IndexTTS' },
      runtime: { engine: 'index-tts', engineApiVersion: 1 },
      assets: [
        {
          path: 'models/model.gguf',
          kind: 'tts-model',
          size: 5,
          sha256: 'a'.repeat(64)
        },
        {
          path: 'voices/voice.wav',
          kind: 'speaker-reference',
          size: 522_284,
          sha256: 'b'.repeat(64)
        }
      ],
      models: [
        {
          id: 'index-model',
          name: 'IndexTTS 2.5',
          artifacts: { 'tts-model': ['models/model.gguf'] },
          parameters: { load: {}, synthesis: { language: 'en', maxTokens: 1500 } }
        }
      ],
      voices: [
        { id: 'american-woman', name: 'Voice', files: ['voices/voice.wav'] },
        { id: 'american-man', name: 'Man', files: ['voices/voice.wav'] }
      ]
    },
    modelId: 'index-model',
    voiceId: 'american-woman',
    text: 'Hello from IndexTTS.',
    format: 'wav',
    resolveAssetPath: async (assetPath) => path.join(directory, assetPath.split('/').pop()!)
  }
}

function createWav(): Buffer {
  const samples = 44_100 // two seconds of mono 16-bit audio at 22050 Hz
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + samples * 2, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(22050, 24)
  wav.writeUInt32LE(44100, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index += 1) {
    wav.writeInt16LE(Math.round(8000 * Math.sin(index / 20)), 44 + index * 2)
  }
  return wav
}
