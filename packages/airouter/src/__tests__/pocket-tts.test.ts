import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIRouterLocalSpeechRequest } from '../main/speech-service'

interface WorkerMock extends EventEmitter {
  postMessage: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
}

const workerState = vi.hoisted(() => ({
  workers: [] as WorkerMock[],
  startup: 'ready' as 'ready' | 'init-error' | 'error' | 'exit',
  postMessageError: null as Error | null
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/workspace' }
}))

vi.mock('node:worker_threads', async () => {
  const { EventEmitter: MockEventEmitter } = await import('node:events')
  return {
    Worker: class extends MockEventEmitter {
      postMessage = vi.fn(() => {
        if (workerState.postMessageError) throw workerState.postMessageError
      })
      terminate = vi.fn().mockResolvedValue(1)

      constructor() {
        super()
        workerState.workers.push(this as WorkerMock)
        queueMicrotask(() => {
          if (workerState.startup === 'init-error') {
            this.emit('message', {
              type: 'init-error',
              message: 'mock worker initialization failed'
            })
          } else if (workerState.startup === 'error') {
            this.emit('error', new Error('mock worker crashed during startup'))
          } else if (workerState.startup === 'exit') {
            this.emit('exit', 17)
          } else {
            this.emit('message', { type: 'ready' })
          }
        })
      }
    }
  }
})

import { PocketTtsSynthesizer } from '../main/pocket-tts'

describe('PocketTtsSynthesizer', () => {
  beforeEach(() => {
    workerState.workers.length = 0
    workerState.startup = 'ready'
    workerState.postMessageError = null
  })

  it('rejects unsupported formats, missing model data, and missing assets', async () => {
    const synthesizer = new PocketTtsSynthesizer()

    await expect(synthesizer.synthesize(createRequest('text', undefined, 'mp3'))).rejects.toThrow(
      'Pocket TTS 当前只支持 WAV 输出'
    )
    await expect(
      synthesizer.synthesize(createRequest('text', undefined, 'wav', { modelId: 'missing' }))
    ).rejects.toThrow('Pocket TTS 模型不存在')
    await expect(
      synthesizer.synthesize(createRequest('text', undefined, 'wav', { voiceId: 'missing' }))
    ).rejects.toThrow('Pocket TTS 音色不存在')
    await expect(
      synthesizer.synthesize(
        createRequest('text', undefined, 'wav', {
          model: {
            id: 'model',
            name: 'Model',
            artifacts: { weights: [], tokenizer: [] },
            parameters: {}
          }
        })
      )
    ).rejects.toThrow('Pocket TTS 模型包缺少必要资产')
    expect(workerState.workers).toHaveLength(0)
  })

  it.each([
    ['init-error', 'mock worker initialization failed'],
    ['error', 'mock worker crashed during startup'],
    ['exit', 'Pocket TTS Worker 退出（17）']
  ] as const)('reports a Worker startup %s', async (startup, message) => {
    workerState.startup = startup

    await expect(new PocketTtsSynthesizer().synthesize(createRequest('text'))).rejects.toThrow(
      message
    )
    expect(workerState.workers[0].terminate).toHaveBeenCalledTimes(1)
  })

  it('propagates a Worker synthesis error and releases the session', async () => {
    const synthesizer = new PocketTtsSynthesizer()
    const pending = synthesizer.synthesize(createRequest('worker failure'))
    const worker = await readyWorker()
    const requestId = requestMessage(worker).requestId
    worker.emit('message', { type: 'error', requestId, message: 'mock synthesis failed' })

    await expect(pending).rejects.toThrow('mock synthesis failed')
    expect(worker.terminate).not.toHaveBeenCalled()

    const retry = synthesizer.synthesize(createRequest('retry after failure'))
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2))
    const retryMessage = worker.postMessage.mock.calls[1][0] as { requestId: string; text: string }
    expect(retryMessage.text).toBe('retry after failure')
    worker.emit('message', { type: 'result', requestId: retryMessage.requestId, data: createWav() })

    await expect(retry).resolves.toEqual(expect.objectContaining({ format: 'wav' }))
    expect(workerState.workers).toEqual([worker])
  })

  it('rejects pending synthesis when the Worker exits after initialization', async () => {
    const pending = new PocketTtsSynthesizer().synthesize(createRequest('worker exit'))
    const worker = await readyWorker()
    worker.emit('exit', 23)

    await expect(pending).rejects.toThrow('Pocket TTS Worker 退出（23）')
  })

  it('propagates postMessage failures', async () => {
    workerState.postMessageError = new Error('mock postMessage failed')

    await expect(
      new PocketTtsSynthesizer().synthesize(createRequest('post message failure'))
    ).rejects.toThrow('mock postMessage failed')
  })

  it('reuses an idle Worker and sends each request with its text and voice', async () => {
    const synthesizer = new PocketTtsSynthesizer()
    const first = synthesizer.synthesize(createRequest('first'))
    const worker = await readyWorker()
    const firstMessage = requestMessage(worker)
    worker.emit('message', { type: 'result', requestId: firstMessage.requestId, data: createWav() })
    await expect(first).resolves.toEqual(expect.objectContaining({ format: 'wav' }))

    const second = synthesizer.synthesize(createRequest('second'))
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2))
    const secondMessage = worker.postMessage.mock.calls[1][0] as {
      requestId: string
      text: string
      voiceId: string
    }
    expect(secondMessage).toMatchObject({ text: 'second', voiceId: 'voice' })
    worker.emit('message', {
      type: 'result',
      requestId: secondMessage.requestId,
      data: createWav()
    })
    await expect(second).resolves.toEqual(expect.objectContaining({ format: 'wav' }))
    expect(workerState.workers).toHaveLength(1)
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('aborts only the worker assigned to the cancelled concurrent request', async () => {
    const synthesizer = new PocketTtsSynthesizer()
    const firstController = new AbortController()
    const first = synthesizer.synthesize(createRequest('first', firstController.signal))
    const second = synthesizer.synthesize(createRequest('second'))

    await vi.waitFor(() => {
      expect(workerState.workers).toHaveLength(2)
      expect(
        workerState.workers.every((worker) => worker.postMessage.mock.calls.length === 1)
      ).toBe(true)
    })
    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })

    const secondMessage = workerState.workers[1].postMessage.mock.calls[0][0] as {
      requestId: string
    }
    workerState.workers[1].emit('message', {
      type: 'result',
      requestId: secondMessage.requestId,
      data: createWav()
    })

    await expect(second).resolves.toEqual(
      expect.objectContaining({ format: 'wav', mediaType: 'audio/wav' })
    )
    expect(workerState.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(workerState.workers[1].terminate).not.toHaveBeenCalled()
  })
})

function createRequest(
  text: string,
  signal?: AbortSignal,
  format: 'wav' | 'mp3' = 'wav',
  overrides: {
    modelId?: string
    voiceId?: string
    model?: AIRouterLocalSpeechRequest['manifest']['models'][number]
  } = {}
): AIRouterLocalSpeechRequest {
  const model = overrides.model ?? {
    id: 'model',
    name: 'Model',
    artifacts: { weights: ['weights'], tokenizer: ['tokenizer'] },
    parameters: {}
  }
  return {
    provider: {
      id: 'local',
      name: 'Local',
      kind: 'local',
      type: 'pocket-tts',
      baseUrl: '',
      modelPackageId: 'package',
      modelPackageVersion: '1.0.0',
      models: [{ id: 'model', enabled: true }],
      voices: [{ id: 'voice', enabled: true }]
    },
    manifest: {
      format: 'ls101.tts-model-package',
      formatVersion: 1,
      package: { id: 'package', version: '1.0.0', name: 'Package' },
      runtime: { engine: 'pocket-tts', engineApiVersion: 1 },
      assets: [],
      models: [model],
      voices: [{ id: 'voice', name: 'Voice', files: ['voice'] }]
    },
    modelId: overrides.modelId ?? 'model',
    voiceId: overrides.voiceId ?? 'voice',
    text,
    format,
    signal,
    resolveAssetPath: async (assetPath) => `/models/${assetPath}`
  }
}

async function readyWorker(): Promise<WorkerMock> {
  await vi.waitFor(() => expect(workerState.workers).toHaveLength(1))
  const worker = workerState.workers[0]
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1))
  return worker
}

function requestMessage(worker: WorkerMock): { requestId: string; text: string; voiceId: string } {
  return worker.postMessage.mock.calls[0][0] as {
    requestId: string
    text: string
    voiceId: string
  }
}

function createWav(): Uint8Array {
  const data = new Uint8Array(46)
  data.set(new TextEncoder().encode('RIFF'), 0)
  data.set(new TextEncoder().encode('WAVE'), 8)
  return data
}
