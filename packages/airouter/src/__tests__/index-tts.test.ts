import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIRouterLocalSpeechRequest } from '../main/speech-service'

import { IndexTtsSynthesizer } from '../main/index-tts'

const PLATFORM_KEY = `${process.platform}-${process.arch}`
const HELPER_SHA256 = '1'.repeat(64)
const OTHER_SHA256 = '2'.repeat(64)

class FakeHelper extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false
  received: string[] = []
  requests: Array<Record<string, unknown>> = []
  private input = Buffer.alloc(0)

  constructor(
    private readonly respond = true,
    private readonly ready = true,
    private readonly payload: () => Buffer = createWav
  ) {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      this.input = Buffer.concat([this.input, chunk])
      this.drain()
    })
    if (this.ready) {
      queueMicrotask(() => this.stdout.write(Buffer.from('{"type":"ready","version":1}\n')))
    }
  }

  kill(): boolean {
    if (this.killed) return false
    this.killed = true
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'))
    return true
  }

  private drain(): void {
    const newline = this.input.indexOf(0x0a)
    if (newline < 0) return
    const header = JSON.parse(this.input.subarray(0, newline).toString('utf8')) as Record<
      string,
      unknown
    > & { id: string; textBytes: number }
    if (this.input.byteLength < newline + 1 + header.textBytes) return
    const text = this.input.subarray(newline + 1, newline + 1 + header.textBytes).toString('utf8')
    this.input = this.input.subarray(newline + 1 + header.textBytes)
    this.requests.push(header)
    this.received.push(text)
    if (this.respond) {
      const payload = this.payload()
      const response = Buffer.concat([
        Buffer.from(
          `{"type":"result","requestId":"${header.id}","sampleRate":22050,"size":${payload.byteLength}}\n`
        ),
        payload
      ])
      this.stdout.write(response.subarray(0, 23))
      this.stdout.write(response.subarray(23))
    }
    if (this.input.byteLength) this.drain()
  }
}

describe('IndexTtsSynthesizer', () => {
  let directory: string
  let runtimeRoot: string
  let helperPath: string
  let request: AIRouterLocalSpeechRequest

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'index-tts-test-'))
    runtimeRoot = await mkdtemp(path.join(tmpdir(), 'index-tts-runtime-'))
    helperPath = path.join(directory, 'helper')
    await Promise.all([
      writeFile(helperPath, 'mock'),
      writeFile(path.join(directory, 'index-tts-2.5.gguf'), 'model'),
      writeFile(path.join(directory, 'reference.wav'), Buffer.alloc(4100)),
      writeFile(path.join(directory, 'second.wav'), Buffer.alloc(4200))
    ])
    request = createRequest(directory)
  })

  afterEach(async () => {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(runtimeRoot, { recursive: true, force: true })
    ])
  })

  it('keeps one CPU helper alive for repeated synthesis with manifest parameters', async () => {
    const helper = new FakeHelper()
    const spawnProcess = vi.fn(
      (
        _command: string,
        _args: string[],
        _options?: { env?: Record<string, string | undefined> }
      ) => helper as unknown as ChildProcessWithoutNullStreams
    )
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    const first = await synthesizer.synthesize(request)
    const second = await synthesizer.synthesize({ ...request, text: 'Second request.' })

    expect(first).toMatchObject({
      format: 'wav',
      mediaType: 'audio/wav',
      sampleRate: 22050,
      channels: 1
    })
    expect(second.data).toHaveLength(48)
    expect(helper.received).toEqual(['Hello from IndexTTS.', 'Second request.'])
    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(spawnProcess).toHaveBeenCalledWith(
      helperPath,
      [
        '--backend',
        'cpu',
        '--model',
        path.join(directory, 'index-tts-2.5.gguf'),
        '--weight-type',
        'q8_0',
        '--language',
        'zh',
        '--threads',
        '6'
      ],
      expect.objectContaining({
        env: expect.objectContaining({
          OMP_NUM_THREADS: '6'
        })
      })
    )
    expect(helper.requests[0]).toMatchObject({
      op: 'synthesize',
      id: expect.stringMatching(/^[a-f0-9]{32}$/),
      textBytes: 20,
      voiceRef: path.join(directory, 'reference.wav'),
      emotionAlpha: 1.2,
      durationFactor: 0.9,
      numBeams: 4,
      doSample: false,
      temperature: 0.5,
      topK: 12,
      topP: 0.7,
      repetitionPenalty: 1.5,
      maxMelTokens: 900
    })
    const environment = spawnProcess.mock.calls[0][2]?.env
    const pathKey = Object.keys(environment ?? {}).find((key) => key.toLowerCase() === 'path')
    expect(pathKey).toBeDefined()
    expect(environment?.[pathKey!]?.split(path.delimiter)[0]).toBe(directory)
    expect(request.resolveAssetPath).toHaveBeenCalledWith('reference.wav')
    synthesizer.dispose()
    expect(helper.killed).toBe(true)
  })

  it('selects the CUDA helper from the provider backend', async () => {
    const helper = new FakeHelper()
    const cudaHelperPath = path.join(directory, 'helper-cuda')
    await writeFile(cudaHelperPath, 'mock')
    const spawnProcess = vi.fn(
      (
        _command: string,
        _args: string[],
        _options?: { env?: Record<string, string | undefined> }
      ) => helper as unknown as ChildProcessWithoutNullStreams
    )
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath, cuda: cudaHelperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await synthesizer.synthesize({
      ...request,
      provider: { ...request.provider, backend: 'cuda' }
    })

    expect(spawnProcess).toHaveBeenCalledWith(
      cudaHelperPath,
      expect.arrayContaining(['--backend', 'cuda']),
      expect.any(Object)
    )
    synthesizer.dispose()
  })

  it('uses the reference voice of the requested voice id', async () => {
    const helper = new FakeHelper()
    const spawnProcess = vi.fn(
      (
        _command: string,
        _args: string[],
        _options?: { env?: Record<string, string | undefined> }
      ) => helper as unknown as ChildProcessWithoutNullStreams
    )
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await synthesizer.synthesize({ ...request, voiceId: 'second-voice' })

    expect(request.resolveAssetPath).toHaveBeenCalledWith('second.wav')
    expect(helper.requests[0]).toMatchObject({ voiceRef: path.join(directory, 'second.wav') })
    expect(spawnProcess.mock.calls[0][1]).toEqual([
      '--backend',
      'cpu',
      '--model',
      path.join(directory, 'index-tts-2.5.gguf'),
      '--weight-type',
      'q8_0',
      '--language',
      'zh',
      '--threads',
      '6'
    ])
    synthesizer.dispose()
  })

  it('accepts the sample alias for doSample', async () => {
    const helper = new FakeHelper()
    const spawnProcess = vi.fn(() => helper as unknown as ChildProcessWithoutNullStreams)
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await synthesizer.synthesize({
      ...request,
      manifest: withSynthesisParameters(request, { sample: false })
    })

    expect(helper.requests[0]).toMatchObject({ doSample: false })
    synthesizer.dispose()
  })

  it('falls back to defaults for unknown synthesis parameters', async () => {
    const helper = new FakeHelper()
    const spawnProcess = vi.fn(
      (
        _command: string,
        _args: string[],
        _options?: { env?: Record<string, string | undefined> }
      ) => helper as unknown as ChildProcessWithoutNullStreams
    )
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await synthesizer.synthesize({
      ...request,
      manifest: withSynthesisParameters(request, {
        weightType: 'int4',
        language: '???',
        emotionAlpha: null,
        durationFactor: 99,
        numBeams: 99,
        doSample: 'yes',
        temperature: -1,
        topK: 1.5,
        topP: 2,
        repetitionPenalty: 0,
        maxMelTokens: 0,
        threads: 'many'
      })
    })

    expect(spawnProcess.mock.calls[0][1]).toEqual([
      '--backend',
      'cpu',
      '--model',
      path.join(directory, 'index-tts-2.5.gguf'),
      '--weight-type',
      'f32',
      '--language',
      'auto',
      '--threads',
      '4'
    ])
    expect(helper.requests[0]).toMatchObject({
      voiceRef: path.join(directory, 'reference.wav'),
      emotionAlpha: 1,
      durationFactor: 1,
      numBeams: 3,
      doSample: true,
      temperature: 0.8,
      topK: 30,
      topP: 0.8,
      repetitionPenalty: 10,
      maxMelTokens: 1500
    })
    synthesizer.dispose()
  })

  it('reuses one helper across alternating voices and per-request parameters', async () => {
    const helper = new FakeHelper()
    const spawnProcess = vi.fn(
      (
        _command: string,
        _args: string[],
        _options?: { env?: Record<string, string | undefined> }
      ) => helper as unknown as ChildProcessWithoutNullStreams
    )
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await synthesizer.synthesize({
      ...request,
      voiceId: 'voice',
      manifest: withSynthesisParameters(request, { durationFactor: 0.5 })
    })
    await synthesizer.synthesize({
      ...request,
      voiceId: 'second-voice',
      manifest: withSynthesisParameters(request, { durationFactor: 1.5 })
    })

    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(helper.requests).toHaveLength(2)
    expect(helper.requests[0]).toMatchObject({
      voiceRef: path.join(directory, 'reference.wav'),
      durationFactor: 0.5
    })
    expect(helper.requests[1]).toMatchObject({
      voiceRef: path.join(directory, 'second.wav'),
      durationFactor: 1.5
    })
    synthesizer.dispose()
  })

  it('spawns a new helper for a different model path or backend', async () => {
    const helpers: FakeHelper[] = []
    const cudaHelperPath = path.join(directory, 'helper-cuda')
    await writeFile(cudaHelperPath, 'mock')
    await writeFile(path.join(directory, 'index-tts-2.5-alt.gguf'), 'alt')
    const spawnProcess = vi.fn(
      (
        _command: string,
        _args: string[],
        _options?: { env?: Record<string, string | undefined> }
      ) => {
        const helper = new FakeHelper()
        helpers.push(helper)
        return helper as unknown as ChildProcessWithoutNullStreams
      }
    )
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath, cuda: cudaHelperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await synthesizer.synthesize(request)
    await synthesizer.synthesize({ ...request, text: 'Same session.' })
    expect(spawnProcess).toHaveBeenCalledOnce()

    await synthesizer.synthesize({
      ...request,
      provider: { ...request.provider, backend: 'cuda' }
    })
    expect(spawnProcess).toHaveBeenCalledTimes(2)

    await synthesizer.synthesize({
      ...request,
      manifest: withModelAsset(request, 'index-tts-2.5-alt.gguf')
    })
    expect(spawnProcess).toHaveBeenCalledTimes(3)

    expect(spawnProcess.mock.calls.map((call) => call[0])).toEqual([
      helperPath,
      cudaHelperPath,
      helperPath
    ])
    expect(spawnProcess.mock.calls[2][1]).toContain(path.join(directory, 'index-tts-2.5-alt.gguf'))
    synthesizer.dispose()
    expect(helpers).toHaveLength(3)
    expect(helpers.every((helper) => helper.killed)).toBe(true)
  })

  it('terminates the helper when synthesis is aborted', async () => {
    const helper = new FakeHelper(false)
    const spawnProcess = vi.fn(() => helper as unknown as ChildProcessWithoutNullStreams)
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })
    const controller = new AbortController()
    const pending = synthesizer.synthesize({ ...request, signal: controller.signal })
    await vi.waitFor(() => expect(helper.received).toHaveLength(1))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(helper.killed).toBe(true)
  })

  it('rejects output that is not a valid WAV', async () => {
    const helper = new FakeHelper(true, true, () => Buffer.alloc(48, 0x7f))
    const spawnProcess = vi.fn(() => helper as unknown as ChildProcessWithoutNullStreams)
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await expect(synthesizer.synthesize(request)).rejects.toThrow('返回的音频不是有效 WAV')
    synthesizer.dispose()
  })

  it('rejects a helper that never becomes ready', async () => {
    const helper = new FakeHelper(true, false)
    const spawnProcess = vi.fn(() => helper as unknown as ChildProcessWithoutNullStreams)
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      startupTimeoutMs: 20,
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await expect(synthesizer.synthesize(request)).rejects.toThrow('IndexTTS helper 启动超时')
    expect(helper.killed).toBe(true)
  })

  it('rejects a synthesis that outlives the per-request timeout', async () => {
    const helper = new FakeHelper(false)
    const spawnProcess = vi.fn(() => helper as unknown as ChildProcessWithoutNullStreams)
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      synthesisTimeoutMs: 20,
      spawnProcess: spawnProcess as unknown as typeof spawn
    })
    const pending = synthesizer.synthesize(request)
    const rejected = expect(pending).rejects.toThrow('IndexTTS 合成超时')
    await vi.waitFor(() => expect(helper.received).toHaveLength(1))

    await rejected
    expect(helper.killed).toBe(true)
  })

  it('validates the request before starting a helper', async () => {
    const spawnProcess = vi.fn()
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: helperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await expect(synthesizer.synthesize({ ...request, format: 'mp3' })).rejects.toThrow(
      '当前只支持 WAV'
    )
    await expect(synthesizer.synthesize({ ...request, modelId: 'missing-model' })).rejects.toThrow(
      '模型不存在'
    )
    await expect(synthesizer.synthesize({ ...request, voiceId: 'missing-voice' })).rejects.toThrow(
      '音色不存在'
    )
    await expect(
      synthesizer.synthesize({ ...request, text: 'x'.repeat(64 * 1024 + 1) })
    ).rejects.toThrow('文本必须为 1 到 65536 个 UTF-8 字节')
    await expect(
      synthesizer.synthesize({
        ...request,
        manifest: { ...request.manifest, runtime: { engine: 'qwen-tts', engineApiVersion: 1 } }
      })
    ).rejects.toThrow('模型包与本地 Provider 类型不匹配')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('reports a missing runtime with the build hint', async () => {
    const spawnProcess = vi.fn()
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cpu: path.join(directory, 'missing-helper') },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    const error = await synthesizer.synthesize(request).then(
      () => new Error('synthesis should not succeed'),
      (reason: Error) => reason
    )

    expect(error.message).toContain('缺少 IndexTTS 原生运行时')
    expect(error.message).toContain('yarn index-tts:build-runtime')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('reports a missing runtime declared by the model package', async () => {
    const spawnProcess = vi.fn()
    const asset = `${PLATFORM_KEY}-helper-cuda`
    const synthesizer = new IndexTtsSynthesizer({
      helperAllowlist: { [PLATFORM_KEY]: [HELPER_SHA256] },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    const error = await synthesizer
      .synthesize({
        ...request,
        provider: { ...request.provider, backend: 'cuda' },
        manifest: withHelperAssets(request, [{ path: asset }])
      })
      .then(
        () => new Error('synthesis should not succeed'),
        (reason: Error) => reason
      )

    expect(error.message).toContain(`缺少 IndexTTS 原生运行时：${path.join(directory, asset)}`)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('resolves the helper from the model package for the requested backend', async () => {
    const helpers: FakeHelper[] = []
    const spawnProcess = vi.fn((_command: string, _args: string[]) => {
      const helper = new FakeHelper()
      helpers.push(helper)
      return helper as unknown as ChildProcessWithoutNullStreams
    })
    const cudaAsset = `${PLATFORM_KEY}-helper-cuda`
    const cpuAsset = `${PLATFORM_KEY}-helper-cpu`
    const genericCudaAsset = 'helper-cuda'
    await Promise.all(
      [cudaAsset, cpuAsset, genericCudaAsset].map((asset) =>
        writeFile(path.join(directory, asset), 'mock')
      )
    )
    const manifest = withHelperAssets(request, [
      { path: cudaAsset, sha256: sha256('mock') },
      { path: cpuAsset, sha256: sha256('mock') },
      { path: genericCudaAsset, sha256: sha256('mock') }
    ])
    const synthesizer = new IndexTtsSynthesizer({
      runtimeRoot,
      helperAllowlist: { [PLATFORM_KEY]: [sha256('mock')] },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await synthesizer.synthesize({
      ...request,
      provider: { ...request.provider, backend: 'cuda' },
      manifest
    })
    await synthesizer.synthesize({
      ...request,
      provider: { ...request.provider, backend: 'cpu' },
      manifest
    })

    const stagingDirectory = path.join(runtimeRoot, PLATFORM_KEY, 'index-package-1.0.0')
    expect(spawnProcess.mock.calls.map((call) => call[0])).toEqual([
      path.join(stagingDirectory, cudaAsset),
      path.join(stagingDirectory, cpuAsset)
    ])
    expect(spawnProcess.mock.calls.map((call) => call[1][1])).toEqual(['cuda', 'cpu'])
    synthesizer.dispose()
    expect(helpers).toHaveLength(2)
    expect(helpers.every((helper) => helper.killed)).toBe(true)
  })

  it('rejects a helper that is not on the application allowlist before spawning', async () => {
    const spawnProcess = vi.fn()
    const asset = `${PLATFORM_KEY}-helper-cuda`
    await writeFile(path.join(directory, asset), 'mock')
    const synthesizer = new IndexTtsSynthesizer({
      helperAllowlist: { [PLATFORM_KEY]: [OTHER_SHA256] },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await expect(
      synthesizer.synthesize({
        ...request,
        provider: { ...request.provider, backend: 'cuda' },
        manifest: withHelperAssets(request, [{ path: asset }])
      })
    ).rejects.toThrow(`IndexTTS 运行时未通过白名单校验（${PLATFORM_KEY}）：${asset}`)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('rejects every package helper while the shipped allowlist is empty', async () => {
    const spawnProcess = vi.fn()
    const asset = `${PLATFORM_KEY}-helper-cuda`
    await writeFile(path.join(directory, asset), 'mock')
    const synthesizer = new IndexTtsSynthesizer({
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await expect(
      synthesizer.synthesize({
        ...request,
        provider: { ...request.provider, backend: 'cuda' },
        manifest: withHelperAssets(request, [{ path: asset }])
      })
    ).rejects.toThrow('IndexTTS 运行时未通过白名单校验')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('fails closed when the model package carries no runtime helper', async () => {
    const spawnProcess = vi.fn()
    const synthesizer = new IndexTtsSynthesizer({
      helperAllowlist: { [PLATFORM_KEY]: [HELPER_SHA256] },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await expect(
      synthesizer.synthesize({
        ...request,
        provider: { ...request.provider, backend: undefined }
      })
    ).rejects.toThrow(`IndexTTS 模型包未提供 ${PLATFORM_KEY} 的 CUDA 运行时`)
    await expect(
      synthesizer.synthesize({ ...request, provider: { ...request.provider, backend: 'cpu' } })
    ).rejects.toThrow(`IndexTTS 模型包未提供 ${PLATFORM_KEY} 的 CPU 运行时`)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('prefers the injectable helper override over the model package asset', async () => {
    const helper = new FakeHelper()
    const spawnProcess = vi.fn(
      (_command: string, _args: string[]) => helper as unknown as ChildProcessWithoutNullStreams
    )
    const asset = `${PLATFORM_KEY}-helper-cuda`
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cuda: helperPath },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await synthesizer.synthesize({
      ...request,
      provider: { ...request.provider, backend: 'cuda' },
      manifest: withHelperAssets(request, [{ path: asset, sha256: OTHER_SHA256 }])
    })

    expect(spawnProcess.mock.calls[0][0]).toBe(helperPath)
    expect(request.resolveAssetPath).not.toHaveBeenCalledWith(asset)
    synthesizer.dispose()
  })

  it('rejects a runtime library that is not on the application allowlist before spawning', async () => {
    const spawnProcess = vi.fn()
    const helperAsset = `${PLATFORM_KEY}-helper-cuda`
    const libraryAsset = 'libcublas.so.12'
    await Promise.all([
      writeFile(path.join(directory, helperAsset), 'mock'),
      writeFile(path.join(directory, libraryAsset), 'library')
    ])
    const helperDigest = sha256('mock')
    const libraryDigest = sha256('library')
    const synthesizer = new IndexTtsSynthesizer({
      runtimeRoot,
      helperAllowlist: { [PLATFORM_KEY]: [helperDigest] },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await expect(
      synthesizer.synthesize({
        ...request,
        provider: { ...request.provider, backend: 'cuda' },
        manifest: withRuntimeLibraries(
          withHelperAssets(request, [{ path: helperAsset, sha256: helperDigest }]),
          [{ path: libraryAsset, sha256: libraryDigest }]
        )
      })
    ).rejects.toThrow(`IndexTTS 运行时未通过白名单校验（${PLATFORM_KEY}）：${libraryAsset}`)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('rejects a runtime library whose copied bytes do not match the declared digest', async () => {
    const spawnProcess = vi.fn()
    const helperAsset = `${PLATFORM_KEY}-helper-cuda`
    const libraryAsset = 'libaudiocpp.so.0'
    await Promise.all([
      writeFile(path.join(directory, helperAsset), 'mock'),
      writeFile(path.join(directory, libraryAsset), 'trojanised')
    ])
    const helperDigest = sha256('mock')
    const declaredLibraryDigest = sha256('library')
    const synthesizer = new IndexTtsSynthesizer({
      runtimeRoot,
      helperAllowlist: { [PLATFORM_KEY]: [helperDigest, declaredLibraryDigest] },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await expect(
      synthesizer.synthesize({
        ...request,
        provider: { ...request.provider, backend: 'cuda' },
        manifest: withRuntimeLibraries(
          withHelperAssets(request, [{ path: helperAsset, sha256: helperDigest }]),
          [{ path: libraryAsset, sha256: declaredLibraryDigest }]
        )
      })
    ).rejects.toThrow(`IndexTTS 运行时文件校验失败：${libraryAsset}`)
    expect(spawnProcess).not.toHaveBeenCalled()
    await expect(
      stat(path.join(runtimeRoot, PLATFORM_KEY, 'index-package-1.0.0'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')(
    'stages an executable helper next to its libraries outside the blob store',
    async () => {
      const helper = new FakeHelper()
      const spawnProcess = vi.fn(
        (_command: string, _args: string[]) => helper as unknown as ChildProcessWithoutNullStreams
      )
      const helperAsset = `${PLATFORM_KEY}-helper-cuda`
      const sharedLibraryAsset = 'libaudiocpp.so.0'
      const dataLibraryAsset = 'cublas64_12.dll'
      const blobDirectory = path.join(directory, 'blobs', 'sha256', 'ab')
      const blobHelperPath = path.join(blobDirectory, 'cafebabe')
      await mkdir(blobDirectory, { recursive: true })
      await Promise.all([
        writeFile(blobHelperPath, 'mock'),
        writeFile(path.join(directory, sharedLibraryAsset), 'shared-library'),
        writeFile(path.join(directory, dataLibraryAsset), 'data-library')
      ])
      await chmod(blobHelperPath, 0o600)
      const helperDigest = sha256('mock')
      const sharedLibraryDigest = sha256('shared-library')
      const dataLibraryDigest = sha256('data-library')
      const synthesizer = new IndexTtsSynthesizer({
        runtimeRoot,
        helperAllowlist: {
          [PLATFORM_KEY]: [helperDigest, sharedLibraryDigest, dataLibraryDigest]
        },
        spawnProcess: spawnProcess as unknown as typeof spawn
      })

      await synthesizer.synthesize({
        ...request,
        provider: { ...request.provider, backend: 'cuda' },
        manifest: withRuntimeLibraries(
          withHelperAssets(request, [{ path: helperAsset, sha256: helperDigest }]),
          [
            { path: sharedLibraryAsset, sha256: sharedLibraryDigest },
            { path: dataLibraryAsset, sha256: dataLibraryDigest }
          ]
        ),
        resolveAssetPath: vi.fn(async (assetPath: string) =>
          assetPath === helperAsset ? blobHelperPath : path.join(directory, assetPath)
        )
      })

      const stagedDirectory = path.join(runtimeRoot, PLATFORM_KEY, 'index-package-1.0.0')
      const stagedHelper = path.join(stagedDirectory, helperAsset)
      expect(spawnProcess.mock.calls[0][0]).toBe(stagedHelper)
      expect(spawnProcess.mock.calls[0][0]).not.toBe(blobHelperPath)
      expect((await stat(stagedHelper)).mode & 0o777).toBe(0o755)
      expect((await stat(path.join(stagedDirectory, sharedLibraryAsset))).mode & 0o777).toBe(0o755)
      expect((await stat(path.join(stagedDirectory, dataLibraryAsset))).mode & 0o777).toBe(0o644)
      await expect(access(stagedHelper, constants.X_OK)).resolves.toBeUndefined()
      expect((await stat(blobHelperPath)).mode & 0o777).toBe(0o600)
      synthesizer.dispose()
    }
  )

  it('reuses the staged runtime and stages a different package version separately', async () => {
    const helperAsset = `${PLATFORM_KEY}-helper-cuda`
    await writeFile(path.join(directory, helperAsset), 'mock')
    const digest = sha256('mock')
    const manifest = withHelperAssets(request, [{ path: helperAsset, sha256: digest }])
    const spawnProcess = vi.fn(
      (_command: string, _args: string[]) =>
        new FakeHelper() as unknown as ChildProcessWithoutNullStreams
    )
    const synthesizer = new IndexTtsSynthesizer({
      runtimeRoot,
      helperAllowlist: { [PLATFORM_KEY]: [digest] },
      spawnProcess: spawnProcess as unknown as typeof spawn
    })
    const cudaRequest: AIRouterLocalSpeechRequest = {
      ...request,
      provider: { ...request.provider, backend: 'cuda' },
      manifest
    }

    await synthesizer.synthesize(cudaRequest)
    const stagedHelper = spawnProcess.mock.calls[0][0]
    const first = await stat(stagedHelper)
    synthesizer.dispose()

    await synthesizer.synthesize(cudaRequest)
    expect(spawnProcess.mock.calls[1][0]).toBe(stagedHelper)
    const second = await stat(stagedHelper)
    expect(second.ino).toBe(first.ino)
    expect(second.mtimeMs).toBe(first.mtimeMs)
    synthesizer.dispose()

    await synthesizer.synthesize({
      ...cudaRequest,
      manifest: { ...manifest, package: { ...manifest.package, version: '1.1.0' } }
    })
    expect(spawnProcess.mock.calls[2][0]).toBe(
      path.join(runtimeRoot, PLATFORM_KEY, 'index-package-1.1.0', helperAsset)
    )
    expect(spawnProcess).toHaveBeenCalledTimes(3)
    synthesizer.dispose()
  })
})

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
      voices: [{ id: 'voice', enabled: true }],
      backend: 'cpu'
    },
    manifest: {
      format: 'ls101.tts-model-package',
      formatVersion: 1,
      package: { id: 'index-package', version: '1.0.0', name: 'IndexTTS 2.5' },
      runtime: { engine: 'index-tts', engineApiVersion: 1 },
      assets: [],
      models: [
        {
          id: 'index-model',
          name: 'IndexTTS 2.5',
          artifacts: { 'tts-model': ['index-tts-2.5.gguf'] },
          parameters: {
            synthesis: {
              weightType: 'q8_0',
              language: 'zh',
              emotionAlpha: 1.2,
              durationFactor: 0.9,
              numBeams: 4,
              doSample: false,
              temperature: 0.5,
              topK: 12,
              topP: 0.7,
              repetitionPenalty: 1.5,
              maxMelTokens: 900,
              threads: 6
            }
          }
        }
      ],
      voices: [
        { id: 'voice', name: 'Voice', files: ['reference.wav'] },
        { id: 'second-voice', name: 'Second Voice', files: ['second.wav'] }
      ]
    },
    modelId: 'index-model',
    voiceId: 'voice',
    text: 'Hello from IndexTTS.',
    format: 'wav',
    resolveAssetPath: vi.fn(async (assetPath: string) => path.join(directory, assetPath))
  }
}

function withSynthesisParameters(
  request: AIRouterLocalSpeechRequest,
  synthesis: Record<string, unknown>
): AIRouterLocalSpeechRequest['manifest'] {
  return {
    ...request.manifest,
    models: request.manifest.models.map((model) => ({
      ...model,
      parameters: { synthesis }
    }))
  }
}

function withModelAsset(
  request: AIRouterLocalSpeechRequest,
  assetPath: string
): AIRouterLocalSpeechRequest['manifest'] {
  return {
    ...request.manifest,
    models: request.manifest.models.map((model) => ({
      ...model,
      artifacts: { 'tts-model': [assetPath] }
    }))
  }
}

function withHelperAssets(
  request: AIRouterLocalSpeechRequest,
  helpers: Array<{ path: string; sha256?: string }>
): AIRouterLocalSpeechRequest['manifest'] {
  return {
    ...request.manifest,
    assets: helpers.map((helper) => ({
      path: helper.path,
      kind: 'runtime-helper',
      size: 4,
      sha256: helper.sha256 ?? HELPER_SHA256
    })),
    models: request.manifest.models.map((model) => ({
      ...model,
      artifacts: { ...model.artifacts, 'runtime-helper': helpers.map((helper) => helper.path) }
    }))
  }
}

function withRuntimeLibraries(
  manifest: AIRouterLocalSpeechRequest['manifest'],
  libraries: Array<{ path: string; sha256: string }>
): AIRouterLocalSpeechRequest['manifest'] {
  return {
    ...manifest,
    assets: [
      ...manifest.assets,
      ...libraries.map((library) => ({
        path: library.path,
        kind: 'runtime-library',
        size: 4,
        sha256: library.sha256
      }))
    ]
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function createWav(): Buffer {
  const wav = Buffer.alloc(48)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(40, 4)
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
  wav.writeUInt32LE(4, 40)
  return wav
}
