import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeProcess extends EventEmitter {
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { transcodeWav } from '../main/speech-audio-transcoder'

describe('transcodeWav', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('rejects non-WAV input before starting FFmpeg', async () => {
    await expect(
      transcodeWav(
        {
          data: new Uint8Array([1]),
          mediaType: 'audio/mpeg',
          format: 'mp3'
        },
        'opus'
      )
    ).rejects.toThrow('音频转码输入必须是 WAV')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects an already-aborted request before starting FFmpeg', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      transcodeWav(
        {
          data: new Uint8Array([1]),
          mediaType: 'audio/wav',
          format: 'wav'
        },
        'mp3',
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('propagates FFmpeg process errors and stderr on nonzero exit', async () => {
    const process = createProcess()
    spawnMock.mockReturnValueOnce(process)
    const pending = transcodeWav(createWav(), 'mp3')
    process.stderr.emit('data', Buffer.from('encoder unavailable\n'))
    process.emit('close', 1)

    await expect(pending).rejects.toThrow('encoder unavailable')
  })

  it('propagates an FFmpeg process error event', async () => {
    const process = createProcess()
    spawnMock.mockReturnValueOnce(process)
    const pending = transcodeWav(createWav(), 'mp3')
    const error = new Error('FFmpeg could not start')
    process.emit('error', error)

    await expect(pending).rejects.toThrow('FFmpeg could not start')
  })

  it('pipes WAV input through FFmpeg and returns stdout with the requested format', async () => {
    const process = createProcess()
    const audio = createWav()
    const output = Buffer.from([1, 2, 3, 4])
    spawnMock.mockReturnValueOnce(process)
    const pending = transcodeWav(audio, 'opus')

    expect(process.stdin.end).toHaveBeenCalledWith(audio.data)
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'wav',
        '-i',
        'pipe:0',
        '-map_metadata',
        '-1',
        '-vn',
        '-codec:a',
        'libopus',
        '-f',
        'opus',
        'pipe:1'
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    process.stdout.emit('data', output)
    process.emit('close', 0)

    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        data: new Uint8Array(output),
        mediaType: 'audio/opus',
        format: 'opus',
        sampleRate: 24000,
        channels: 1
      })
    )
    expect(process.kill).not.toHaveBeenCalled()
  })

  it('rejects when FFmpeg exits successfully without producing audio', async () => {
    const process = createProcess()
    spawnMock.mockReturnValueOnce(process)
    const pending = transcodeWav(createWav(), 'opus')
    process.emit('close', 0)

    await expect(pending).rejects.toThrow('FFmpeg 未生成音频数据')
  })

  it('kills FFmpeg and rejects with AbortError when cancelled', async () => {
    const process = createProcess()
    spawnMock.mockReturnValueOnce(process)
    const controller = new AbortController()
    const pending = transcodeWav(createWav(), 'pcm-s16le', controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(process.kill).toHaveBeenCalledTimes(1)
  })
})

function createProcess(): FakeProcess {
  const process = new EventEmitter() as FakeProcess
  process.stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  process.stdout = new EventEmitter()
  process.stderr = new EventEmitter()
  process.kill = vi.fn()
  return process
}

function createWav(): {
  data: Uint8Array
  mediaType: 'audio/wav'
  format: 'wav'
  sampleRate: number
  channels: number
} {
  return {
    data: new Uint8Array([82, 73, 70, 70]),
    mediaType: 'audio/wav',
    format: 'wav',
    sampleRate: 24000,
    channels: 1
  }
}
