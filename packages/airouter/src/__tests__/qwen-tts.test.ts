import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIRouterLocalSpeechRequest } from '../main/speech-service'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getAppPath: () => process.cwd() } }))

import { QwenTtsSynthesizer } from '../main/qwen-tts'

class FakeHelper extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false
  received: string[] = []
  private input = Buffer.alloc(0)

  constructor(private readonly respond = true) {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      this.input = Buffer.concat([this.input, chunk])
      this.drain()
    })
    queueMicrotask(() => this.stdout.write(Buffer.from('READY 1\n')))
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
    const fields = this.input.subarray(0, newline).toString('ascii').split(' ')
    const size = Number(fields[3])
    if (this.input.byteLength < newline + 1 + size) return
    const text = this.input.subarray(newline + 1, newline + 1 + size).toString('utf8')
    this.input = this.input.subarray(newline + 1 + size)
    this.received.push(text)
    if (this.respond) {
      const wav = createWav()
      const response = Buffer.concat([
        Buffer.from(`RESULT ${fields[1]} 24000 ${wav.byteLength}\n`),
        wav
      ])
      this.stdout.write(response.subarray(0, 17))
      this.stdout.write(response.subarray(17))
    }
    if (this.input.byteLength) this.drain()
  }
}

describe('QwenTtsSynthesizer', () => {
  let directory: string
  let helperPath: string
  let request: AIRouterLocalSpeechRequest

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'qwen-tts-test-'))
    helperPath = path.join(directory, 'helper')
    await Promise.all([
      writeFile(helperPath, 'mock'),
      writeFile(path.join(directory, 'talker.gguf'), 'talker'),
      writeFile(path.join(directory, 'tokenizer.gguf'), 'tokenizer'),
      writeFile(path.join(directory, 'voice.spk'), Buffer.alloc(4100))
    ])
    request = createRequest(directory)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps one CPU helper alive for repeated synthesis', async () => {
    const helper = new FakeHelper()
    const spawnProcess = vi.fn(() => helper as unknown as ChildProcessWithoutNullStreams)
    const synthesizer = new QwenTtsSynthesizer({
      helperPath,
      runtimeRoot: path.join(directory, 'runtime'),
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    const first = await synthesizer.synthesize(request)
    const second = await synthesizer.synthesize({ ...request, text: 'Second request.' })

    expect(first).toMatchObject({ format: 'wav', mediaType: 'audio/wav', sampleRate: 24000 })
    expect(second.data).toHaveLength(48)
    expect(helper.received).toEqual(['Hello from Qwen.', 'Second request.'])
    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(spawnProcess.mock.calls[0][2]).toMatchObject({
      env: expect.objectContaining({ QWEN3_TTS_BACKEND: 'cpu' })
    })
    synthesizer.dispose()
    expect(helper.killed).toBe(true)
  })

  it('terminates the helper when synthesis is aborted', async () => {
    const helper = new FakeHelper(false)
    const spawnProcess = vi.fn(() => helper as unknown as ChildProcessWithoutNullStreams)
    const synthesizer = new QwenTtsSynthesizer({
      helperPath,
      runtimeRoot: path.join(directory, 'runtime'),
      spawnProcess: spawnProcess as unknown as typeof spawn
    })
    const controller = new AbortController()
    const pending = synthesizer.synthesize({ ...request, signal: controller.signal })
    await vi.waitFor(() => expect(helper.received).toHaveLength(1))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(helper.killed).toBe(true)
  })

  it('validates the package before starting a helper', async () => {
    const spawnProcess = vi.fn()
    const synthesizer = new QwenTtsSynthesizer({
      helperPath,
      runtimeRoot: path.join(directory, 'runtime'),
      spawnProcess: spawnProcess as unknown as typeof spawn
    })

    await expect(synthesizer.synthesize({ ...request, format: 'mp3' })).rejects.toThrow(
      '当前只支持 WAV'
    )
    await expect(synthesizer.synthesize({ ...request, modelId: 'missing-model' })).rejects.toThrow(
      '模型不存在'
    )
    expect(spawnProcess).not.toHaveBeenCalled()
  })
})

function createRequest(directory: string): AIRouterLocalSpeechRequest {
  return {
    provider: {
      id: 'provider',
      name: 'Qwen',
      kind: 'local',
      type: 'qwen-tts',
      baseUrl: '',
      modelPackageId: 'qwen-package',
      modelPackageVersion: '1.0.0',
      models: [{ id: 'qwen-model', enabled: true }],
      voices: [{ id: 'voice', enabled: true }]
    },
    manifest: {
      format: 'ls101.tts-model-package',
      formatVersion: 1,
      package: { id: 'qwen-package', version: '1.0.0', name: 'Qwen' },
      runtime: { engine: 'qwen-tts', engineApiVersion: 1 },
      assets: [],
      models: [
        {
          id: 'qwen-model',
          name: 'Qwen Base',
          artifacts: {
            'tts-model': ['talker.gguf'],
            'speech-tokenizer': ['tokenizer.gguf']
          },
          parameters: { load: { quantization: 'f16' }, synthesis: { languageId: 2050 } }
        }
      ],
      voices: [{ id: 'voice', name: 'Voice', files: ['voice.spk'] }]
    },
    modelId: 'qwen-model',
    voiceId: 'voice',
    text: 'Hello from Qwen.',
    format: 'wav',
    resolveAssetPath: async (assetPath) => path.join(directory, assetPath)
  }
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
  wav.writeUInt32LE(24000, 24)
  wav.writeUInt32LE(48000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(4, 40)
  return wav
}
