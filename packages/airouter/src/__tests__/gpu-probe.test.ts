import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { probeNvidiaGpu } from '../main/gpu-probe'

interface FakeResult {
  stdout?: string
  code?: number
  error?: Error
}

function fakeSpawn(results: FakeResult[]): typeof import('node:child_process').spawn {
  let index = 0
  return ((_command: string, _args: string[]) => {
    const result = results[Math.min(index, results.length - 1)]
    index += 1
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      kill: () => void
    }
    child.stdout = new EventEmitter()
    child.kill = vi.fn()
    queueMicrotask(() => {
      if (result.error) {
        child.emit('error', result.error)
        return
      }
      if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout, 'utf8'))
      child.emit('close', result.code ?? 0)
    })
    return child
  }) as unknown as typeof import('node:child_process').spawn
}

describe('probeNvidiaGpu', () => {
  it('recommends CUDA with the fp16 package on a 16 GB Blackwell card', async () => {
    const result = await probeNvidiaGpu({
      spawnProcess: fakeSpawn([
        { stdout: 'NVIDIA GeForce RTX 5080, 12.0, 16376, 580.65\n' }
      ])
    })

    expect(result).toMatchObject({
      available: true,
      name: 'NVIDIA GeForce RTX 5080',
      computeCapability: '12.0',
      vramMiB: 16376,
      driverVersion: '580.65',
      recommendedBackend: 'cuda',
      recommendedWeightType: 'f16'
    })
    expect(result.summary).toContain('RTX 5080')
    expect(result.summary).toContain('4.55 GB')
    expect(result.summary).not.toContain('显存偏紧')
  })

  it('recommends CUDA on an 8 GB Ada card', async () => {
    const result = await probeNvidiaGpu({
      spawnProcess: fakeSpawn([{ stdout: 'NVIDIA GeForce RTX 4060, 8.9, 8188, 572.16\n' }])
    })

    expect(result.available).toBe(true)
    expect(result.recommendedBackend).toBe('cuda')
    expect(result.recommendedWeightType).toBe('f16')
    expect(result.summary).toContain('sm_89')
    expect(result.summary).toContain('8.0 GB')
  })

  it('warns about tight VRAM on small cards instead of switching precision', async () => {
    const result = await probeNvidiaGpu({
      spawnProcess: fakeSpawn([{ stdout: 'NVIDIA GeForce GTX 1660, 7.5, 6144, 572.16\n' }])
    })

    expect(result.recommendedBackend).toBe('cuda')
    expect(result.recommendedWeightType).toBe('f16')
    expect(result.summary).toContain('显存偏紧')
  })

  it('reports that CPU synthesis is unsupported when nvidia-smi is missing', async () => {
    const missing = Object.assign(new Error('spawn nvidia-smi ENOENT'), { code: 'ENOENT' })
    const result = await probeNvidiaGpu({
      spawnProcess: fakeSpawn([{ error: missing }, { error: missing }])
    })

    expect(result).toMatchObject({
      available: false,
      recommendedBackend: 'cpu',
      recommendedWeightType: 'f16'
    })
    expect(result.summary).toContain('未检测到')
    expect(result.summary).toContain('不在支持范围内')
  })

  it('refuses CUDA on drivers older than the CUDA 12.8 requirement', async () => {
    const result = await probeNvidiaGpu({
      spawnProcess: fakeSpawn([{ stdout: 'NVIDIA GeForce RTX 4060, 8.9, 8188, 550.54\n' }])
    })

    expect(result.available).toBe(false)
    expect(result.recommendedBackend).toBe('cpu')
    expect(result.summary).toContain('R570')
  })

  it('refuses CUDA on architectures below compute capability 7.5', async () => {
    const result = await probeNvidiaGpu({
      spawnProcess: fakeSpawn([{ stdout: 'NVIDIA GeForce GTX 1080 Ti, 6.1, 11264, 580.65\n' }])
    })

    expect(result.available).toBe(false)
    expect(result.recommendedBackend).toBe('cpu')
    expect(result.summary).toContain('低于')
  })

  it('falls back to the human-readable nvidia-smi table', async () => {
    const result = await probeNvidiaGpu({
      spawnProcess: fakeSpawn([
        { stdout: '', code: 1 },
        {
          stdout: [
            'Mon Oct  6 14:05:00 2026',
            '+-----------------------------------------------------------------------------------------+',
            '| NVIDIA-SMI 580.65       Driver Version: 580.65       CUDA Version: 13.0                 |',
            '|-----------------------------------------+------------------------+----------------------|',
            '|   0  NVIDIA GeForce RTX 5080        On  |   00000000:01:00.0  |              16376MiB |',
            '+-----------------------------------------+------------------------+----------------------+'
          ].join('\n')
        }
      ])
    })

    expect(result.available).toBe(true)
    expect(result.driverVersion).toBe('580.65')
    expect(result.cudaRuntimeVersion).toBe('13.0')
    expect(result.vramMiB).toBe(16376)
    expect(result.recommendedBackend).toBe('cuda')
  })
})
