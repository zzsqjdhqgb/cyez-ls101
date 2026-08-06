import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { AIRouterLocalSpeechRequest } from '../main/speech-service'

interface WorkerMock extends EventEmitter {
  postMessage: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
}

const workerState = vi.hoisted(() => ({ workers: [] as WorkerMock[] }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/workspace' }
}))

vi.mock('node:worker_threads', async () => {
  const { EventEmitter: MockEventEmitter } = await import('node:events')
  return {
    Worker: class extends MockEventEmitter {
      postMessage = vi.fn()
      terminate = vi.fn().mockResolvedValue(1)

      constructor() {
        super()
        workerState.workers.push(this as WorkerMock)
        queueMicrotask(() => this.emit('message', { type: 'ready' }))
      }
    }
  }
})

import { PocketTtsSynthesizer } from '../main/pocket-tts'

describe('PocketTtsSynthesizer', () => {
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

function createRequest(text: string, signal?: AbortSignal): AIRouterLocalSpeechRequest {
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
      models: [
        {
          id: 'model',
          name: 'Model',
          artifacts: { weights: ['weights'], tokenizer: ['tokenizer'] },
          parameters: {}
        }
      ],
      voices: [{ id: 'voice', name: 'Voice', files: ['voice'] }]
    },
    modelId: 'model',
    voiceId: 'voice',
    text,
    format: 'wav',
    signal,
    resolveAssetPath: async (assetPath) => `/models/${assetPath}`
  }
}

function createWav(): Uint8Array {
  const data = new Uint8Array(46)
  data.set(new TextEncoder().encode('RIFF'), 0)
  data.set(new TextEncoder().encode('WAVE'), 8)
  return data
}
