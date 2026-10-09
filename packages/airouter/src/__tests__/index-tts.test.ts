import { EventEmitter } from 'node:events'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIRouterLocalSpeechRequest } from '../main/speech-service'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))
import { IndexTtsSynthesizer } from '../main/index-tts'

class Helper extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly requests: { id: string; voicePath: string; text: string; language: string }[] = []
  killed = false
  closed = false
  respond = true
  closeOnKill = true
  private bytes = Buffer.alloc(0)

  constructor(ready = true) {
    super()
    this.stdin.on('data', (bytes: Buffer) => {
      this.bytes = Buffer.concat([this.bytes, bytes])
      const newline = this.bytes.indexOf(10)
      if (newline < 0) return
      const fields = this.bytes.subarray(0, newline).toString().split(' ')
      const length = Number(fields[2])
      if (this.bytes.length < newline + 1 + length) return
      const payload = JSON.parse(this.bytes.subarray(newline + 1, newline + 1 + length).toString())
      this.bytes = this.bytes.subarray(newline + 1 + length)
      this.requests.push({ id: fields[1], ...payload })
      if (this.respond) queueMicrotask(() => this.result())
    })
    if (ready) queueMicrotask(() => this.stdout.write('READY 1\n'))
  }

  result(id = this.requests.at(-1)!.id, data = wav()): void {
    this.stdout.write(Buffer.concat([Buffer.from(`RESULT ${id} 24000 ${data.length}\n`), data]))
  }

  error(message = 'Bad reference'): void {
    this.stdout.write(`ERROR ${this.requests.at(-1)!.id} ${Buffer.byteLength(message)}\n${message}`)
  }

  kill(): boolean {
    this.killed = true
    if (this.closeOnKill) queueMicrotask(() => this.close())
    return true
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.emit('exit', null, 'SIGTERM')
    this.emit('close', null, 'SIGTERM')
  }
}

function wav(): Buffer {
  const out = Buffer.alloc(48)
  out.write('RIFF')
  out.writeUInt32LE(40, 4)
  out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(24000, 24)
  out.writeUInt32LE(48000, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(4, 40)
  return out
}

describe('IndexTtsSynthesizer', () => {
  let directory: string
  let request: AIRouterLocalSpeechRequest
  let synthesizer: IndexTtsSynthesizer
  let helpers: Helper[]
  let factory: () => Helper
  let spawnProcess: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'index-tts-'))
    await writeFile(path.join(directory, 'helper'), 'fixture')
    helpers = []
    factory = () => new Helper()
    spawnProcess = vi.fn(() => {
      expect(helpers.filter((helper) => !helper.closed)).toHaveLength(0)
      const helper = factory()
      helpers.push(helper)
      return helper as unknown as ChildProcessWithoutNullStreams
    })
    synthesizer = new IndexTtsSynthesizer({
      helperPath: path.join(directory, 'helper'),
      spawnProcess: spawnProcess as unknown as typeof spawn,
      shutdownTimeoutMs: 50
    })
    request = {
      provider: {
        id: 'one',
        name: 'Index',
        kind: 'local',
        type: 'index-tts',
        baseUrl: '',
        modelPackageId: 'package',
        modelPackageVersion: '1.0.0',
        models: [],
        voices: [],
        backend: 'cuda'
      },
      manifest: {
        format: 'ls101.tts-model-package',
        formatVersion: 1,
        package: { id: 'package', version: '1.0.0', name: 'Index' },
        runtime: { engine: 'index-tts', engineApiVersion: 1 },
        assets: [
          { path: 'model.gguf', kind: 'tts-model', size: 4, sha256: 'a'.repeat(64) },
          { path: 'a.wav', kind: 'speaker-reference', size: 48, sha256: 'b'.repeat(64) },
          { path: 'b.wav', kind: 'speaker-reference', size: 48, sha256: 'c'.repeat(64) }
        ],
        models: [
          { id: 'model', name: 'Index', artifacts: { 'tts-model': ['model.gguf'] }, parameters: {} }
        ],
        voices: [
          { id: 'a', name: 'A', files: ['a.wav'] },
          { id: 'b', name: 'B', files: ['b.wav'] }
        ]
      },
      modelId: 'model',
      voiceId: 'a',
      text: 'Hello',
      format: 'wav',
      resolveAssetPath: async (asset) => path.join(directory, asset)
    }
  })

  afterEach(async () => {
    for (const helper of helpers) helper.closeOnKill = true
    await synthesizer.dispose()
    await rm(directory, { recursive: true, force: true })
  })

  it('serializes A → B → A across providers while loading one model', async () => {
    const outputs = await Promise.all([
      synthesizer.synthesize(request),
      synthesizer.synthesize({
        ...request,
        voiceId: 'b',
        text: 'Second',
        provider: { ...request.provider, id: 'two' }
      }),
      synthesizer.synthesize({ ...request, text: 'Third' })
    ])
    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(
      helpers[0].requests.map(({ voicePath, text }) => [path.basename(voicePath), text])
    ).toEqual([
      ['a.wav', 'Hello'],
      ['b.wav', 'Second'],
      ['a.wav', 'Third']
    ])
    expect(spawnProcess.mock.calls[0][1]).not.toContain('--speaker')
    expect(spawnProcess.mock.calls[0][1]).toContain('cuda')
    expect(outputs.every((output) => output.format === 'wav' && output.channels === 1)).toBe(true)
  })

  it('waits for the old process to close before loading a different model', async () => {
    await synthesizer.synthesize(request)
    helpers[0].closeOnKill = false
    const pending = synthesizer.synthesize({
      ...request,
      resolveAssetPath: async (asset) => path.join(directory, 'other', asset)
    })
    await vi.waitFor(() => expect(helpers[0].killed).toBe(true))
    expect(spawnProcess).toHaveBeenCalledOnce()
    helpers[0].close()
    await pending
    expect(spawnProcess).toHaveBeenCalledTimes(2)
  })

  it('cancels a queued request immediately without stopping the active voice', async () => {
    factory = () => {
      const helper = new Helper()
      helper.respond = false
      return helper
    }
    const first = synthesizer.synthesize(request)
    const controller = new AbortController()
    const queued = expect(
      synthesizer.synthesize({ ...request, voiceId: 'b', signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(helpers[0].requests).toHaveLength(1))
    controller.abort()
    await queued
    expect(helpers[0].killed).toBe(false)
    helpers[0].result()
    await first
    expect(helpers[0].requests).toHaveLength(1)
  })

  it('cancels during model loading and recovers with a different voice', async () => {
    factory = () => new Helper(false)
    const controller = new AbortController()
    const pending = expect(
      synthesizer.synthesize({ ...request, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(helpers).toHaveLength(1))
    controller.abort()
    await pending
    expect(helpers[0].closed).toBe(true)
    factory = () => new Helper()
    await synthesizer.synthesize({ ...request, voiceId: 'b' })
    expect(helpers[1].requests[0].voicePath).toBe(path.join(directory, 'b.wav'))
  })

  it('surfaces startup diagnostics and recovers after helper failure', async () => {
    factory = () => new Helper(false)
    const pending = expect(synthesizer.synthesize(request)).rejects.toThrow(
      'CUDA backend requested but it is not registered'
    )
    await vi.waitFor(() => expect(helpers).toHaveLength(1))
    helpers[0].stderr.write('IndexTTS helper: CUDA backend requested but it is not registered\n')
    helpers[0].stdout.end()
    await pending
    expect(helpers[0].closed).toBe(true)
    factory = () => new Helper()
    await synthesizer.synthesize(request)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
  })

  it('bounds model loading time and waits for process cleanup', async () => {
    await synthesizer.dispose()
    synthesizer = new IndexTtsSynthesizer({
      helperPath: path.join(directory, 'helper'),
      spawnProcess: spawnProcess as unknown as typeof spawn,
      startupTimeoutMs: 15
    })
    factory = () => new Helper(false)
    await expect(synthesizer.synthesize(request)).rejects.toThrow('加载超时')
    expect(helpers[0].closed).toBe(true)
    factory = () => new Helper()
    await synthesizer.synthesize(request)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
  })

  it('cancels active inference, confirms exit, and reloads for the next request', async () => {
    factory = () => {
      const helper = new Helper()
      helper.respond = false
      return helper
    }
    const controller = new AbortController()
    const pending = expect(
      synthesizer.synthesize({ ...request, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(helpers[0].requests).toHaveLength(1))
    controller.abort()
    await pending
    factory = () => new Helper()
    await synthesizer.synthesize({ ...request, voiceId: 'b' })
    expect(spawnProcess).toHaveBeenCalledTimes(2)
  })

  it('recovers after an invalid reference without discarding the loaded model', async () => {
    factory = () => {
      const helper = new Helper()
      helper.respond = false
      return helper
    }
    const failure = expect(synthesizer.synthesize(request)).rejects.toThrow('Bad reference')
    await vi.waitFor(() => expect(helpers[0].requests).toHaveLength(1))
    helpers[0].error()
    await failure
    helpers[0].respond = true
    await synthesizer.synthesize({ ...request, voiceId: 'b' })
    expect(spawnProcess).toHaveBeenCalledOnce()
  })

  it('invalidates malformed output and ignores late events from the previous helper', async () => {
    factory = () => {
      const helper = new Helper()
      helper.respond = false
      return helper
    }
    const failure = expect(synthesizer.synthesize(request)).rejects.toThrow('未知请求')
    await vi.waitFor(() => expect(helpers[0].requests).toHaveLength(1))
    helpers[0].result('unknown')
    await failure
    factory = () => new Helper()
    const next = synthesizer.synthesize(request)
    helpers[0].result()
    await next
    expect(helpers).toHaveLength(2)
  })

  it('bounds synthesis time and restarts after timeout', async () => {
    await synthesizer.dispose()
    synthesizer = new IndexTtsSynthesizer({
      helperPath: path.join(directory, 'helper'),
      spawnProcess: spawnProcess as unknown as typeof spawn,
      synthesisTimeoutMs: 15
    })
    factory = () => {
      const helper = new Helper()
      helper.respond = false
      return helper
    }
    await expect(synthesizer.synthesize(request)).rejects.toThrow('推理超时')
    expect(helpers[0].closed).toBe(true)
    factory = () => new Helper()
    await synthesizer.synthesize(request)
  })

  it('holds package deletion until inference and process cleanup finish', async () => {
    factory = () => {
      const helper = new Helper()
      helper.respond = false
      return helper
    }
    const first = expect(synthesizer.synthesize(request)).rejects.toMatchObject({
      name: 'AbortError'
    })
    await vi.waitFor(() => expect(helpers[0].requests).toHaveLength(1))
    let finishDeletion!: () => void
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDeletion = resolve
        })
    )
    const deletion = synthesizer.releasePackage('package', '1.0.0', remove)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    expect(helpers[0].closed).toBe(true)
    await expect(synthesizer.synthesize(request)).rejects.toThrow('正在删除')
    finishDeletion()
    await Promise.all([deletion, first])
    factory = () => new Helper()
    await synthesizer.synthesize(request)
  })

  it('cancels all work for an import and keeps shutdown waiting for the file update', async () => {
    factory = () => {
      const helper = new Helper()
      helper.respond = false
      helper.closeOnKill = false
      return helper
    }
    const active = expect(synthesizer.synthesize(request)).rejects.toMatchObject({
      name: 'AbortError'
    })
    await vi.waitFor(() => expect(helpers[0].requests).toHaveLength(1))
    const queued = expect(synthesizer.synthesize({ ...request, voiceId: 'b' })).rejects.toThrow(
      '正在更新'
    )
    let finishUpdate!: (value: string) => void
    const update = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishUpdate = resolve
        })
    )
    const importing = synthesizer.releaseAssets(update)
    await vi.waitFor(() => expect(helpers[0].killed).toBe(true))
    expect(update).not.toHaveBeenCalled()
    helpers[0].close()
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    await expect(synthesizer.synthesize(request)).rejects.toThrow('正在更新')
    let disposed = false
    const shutdown = synthesizer.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    finishUpdate('imported')
    expect(await importing).toBe('imported')
    await Promise.all([shutdown, active, queued])
    await expect(synthesizer.synthesize(request)).rejects.toThrow('已关闭')
    expect(spawnProcess).toHaveBeenCalledOnce()
  })

  it('serializes file mutations and resumes inference after a failed import', async () => {
    let failImport!: (error: Error) => void
    const importing = expect(
      synthesizer.releaseAssets(
        () =>
          new Promise<void>((_resolve, reject) => {
            failImport = reject
          })
      )
    ).rejects.toThrow('invalid archive')
    const remove = vi.fn(async () => undefined)
    const deleting = synthesizer.releasePackage('package', '1.0.0', remove)
    await vi.waitFor(() => expect(failImport).toBeTypeOf('function'))
    expect(remove).not.toHaveBeenCalled()
    await expect(synthesizer.synthesize(request)).rejects.toThrow('正在删除')
    failImport(new Error('invalid archive'))
    await Promise.all([importing, deleting])
    expect(remove).toHaveBeenCalledOnce()
    await synthesizer.synthesize(request)
    expect(spawnProcess).toHaveBeenCalledOnce()
  })

  it('bounds the queue while an active request is waiting for inference', async () => {
    await synthesizer.dispose()
    synthesizer = new IndexTtsSynthesizer({
      helperPath: path.join(directory, 'helper'),
      spawnProcess: spawnProcess as unknown as typeof spawn,
      maxQueuedRequests: 1
    })
    factory = () => {
      const helper = new Helper()
      helper.respond = false
      return helper
    }
    const active = synthesizer.synthesize(request)
    await vi.waitFor(() => expect(helpers[0].requests).toHaveLength(1))
    const queued = synthesizer.synthesize({ ...request, voiceId: 'b' })
    await expect(synthesizer.synthesize(request)).rejects.toThrow('队列已满')
    helpers[0].respond = true
    helpers[0].result()
    await Promise.all([active, queued])
    expect(helpers[0].requests).toHaveLength(2)
  })

  it('releases idle processes, listeners and temporary files before restarting', async () => {
    await synthesizer.dispose()
    synthesizer = new IndexTtsSynthesizer({
      helperPath: path.join(directory, 'helper'),
      spawnProcess: spawnProcess as unknown as typeof spawn,
      idleTimeoutMs: 20
    })
    await synthesizer.synthesize(request)
    const temporaryDirectory = spawnProcess.mock.calls[0][2].env.TMPDIR as string
    expect((await stat(temporaryDirectory)).isDirectory()).toBe(true)
    await vi.waitFor(() => expect(helpers[0].closed).toBe(true))
    await expect(stat(temporaryDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(helpers[0].stdout.listenerCount('data')).toBe(0)
    expect(helpers[0].stderr.listenerCount('data')).toBe(0)
    expect(helpers[0].stdin.listenerCount('error')).toBe(0)
    await synthesizer.synthesize(request)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
  })

  it('refuses to load another model when the previous helper cannot exit', async () => {
    await synthesizer.dispose()
    synthesizer = new IndexTtsSynthesizer({
      helperPath: path.join(directory, 'helper'),
      spawnProcess: spawnProcess as unknown as typeof spawn,
      shutdownTimeoutMs: 5
    })
    await synthesizer.synthesize(request)
    helpers[0].closeOnKill = false
    const switching = expect(
      synthesizer.synthesize({
        ...request,
        resolveAssetPath: async (asset) => path.join(directory, 'other', asset)
      })
    ).rejects.toThrow('未能退出')
    const queued = expect(synthesizer.synthesize(request)).rejects.toThrow('未能退出')
    await Promise.all([switching, queued])
    await expect(synthesizer.synthesize(request)).rejects.toThrow('已关闭')
    expect(spawnProcess).toHaveBeenCalledOnce()
    helpers[0].close()
  })

  it('cancels an unresolved asset lookup without spawning', async () => {
    const controller = new AbortController()
    const resolving = vi.fn(() => new Promise<string>(() => undefined))
    const pending = expect(
      synthesizer.synthesize({
        ...request,
        signal: controller.signal,
        resolveAssetPath: resolving
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(resolving).toHaveBeenCalled()
    controller.abort()
    await pending
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('rejects oversized input and malformed package contracts before spawning', async () => {
    await expect(synthesizer.synthesize({ ...request, text: '中'.repeat(30000) })).rejects.toThrow(
      'UTF-8'
    )
    await expect(
      synthesizer.synthesize({
        ...request,
        manifest: { ...request.manifest, voices: [{ id: 'a', name: 'A', files: ['model.gguf'] }] }
      })
    ).rejects.toThrow('speaker-reference')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('disposes pending work and never spawns after disposal', async () => {
    factory = () => new Helper(false)
    const first = expect(synthesizer.synthesize(request)).rejects.toMatchObject({
      name: 'AbortError'
    })
    await vi.waitFor(() => expect(helpers).toHaveLength(1))
    const second = expect(synthesizer.synthesize(request)).rejects.toThrow('已关闭')
    await Promise.all([synthesizer.dispose(), synthesizer.dispose(), first, second])
    await expect(synthesizer.synthesize(request)).rejects.toThrow('已关闭')
    expect(spawnProcess).toHaveBeenCalledOnce()
  })
})
