import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import type { AIRouterGeneratedAudio, AIRouterSpeechAudioFormat } from '../shared'

const MAX_AUDIO_BYTES = 100 * 1024 * 1024
const require = createRequire(import.meta.url)

export async function transcodeWav(
  audio: AIRouterGeneratedAudio,
  format: Exclude<AIRouterSpeechAudioFormat, 'wav'>,
  signal?: AbortSignal
): Promise<AIRouterGeneratedAudio> {
  if (audio.format !== 'wav') throw new Error('音频转码输入必须是 WAV')
  if (signal?.aborted) throw abortError()

  const ffmpegPath = require('ffmpeg-static') as unknown
  if (typeof ffmpegPath !== 'string' || !ffmpegPath) throw new Error('FFmpeg 不可用')
  const process = spawn(
    ffmpegPath,
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
      ...outputArguments(format),
      'pipe:1'
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )

  return new Promise<AIRouterGeneratedAudio>((resolve, reject) => {
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let outputBytes = 0
    let settled = false

    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      operation()
    }
    const abort = (): void => {
      process.kill()
      finish(() => reject(abortError()))
    }

    signal?.addEventListener('abort', abort, { once: true })
    process.once('error', (error) => finish(() => reject(error)))
    process.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_AUDIO_BYTES) {
        process.kill()
        finish(() => reject(new Error('语音合成结果超过大小限制')))
      } else output.push(chunk)
    })
    process.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    process.once('close', (code) => {
      if (signal?.aborted) {
        finish(() => reject(abortError()))
        return
      }
      if (code !== 0) {
        const message = Buffer.concat(errors).toString('utf8').trim()
        finish(() => reject(new Error(message || `FFmpeg 转码失败（${code ?? 'unknown'}）`)))
        return
      }
      const data = new Uint8Array(Buffer.concat(output))
      if (!data.byteLength) {
        finish(() => reject(new Error('FFmpeg 未生成音频数据')))
        return
      }
      finish(() =>
        resolve({
          data,
          mediaType: mediaTypeFor(format),
          format,
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          durationMs: audio.durationMs
        })
      )
    })
    process.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') finish(() => reject(error))
    })
    process.stdin.end(audio.data)
  })
}

function outputArguments(format: Exclude<AIRouterSpeechAudioFormat, 'wav'>): string[] {
  if (format === 'mp3') return ['-codec:a', 'libmp3lame', '-f', 'mp3']
  if (format === 'opus') return ['-codec:a', 'libopus', '-f', 'opus']
  return ['-codec:a', 'pcm_s16le', '-f', 's16le']
}

function mediaTypeFor(format: Exclude<AIRouterSpeechAudioFormat, 'wav'>): string {
  if (format === 'mp3') return 'audio/mpeg'
  if (format === 'opus') return 'audio/opus'
  return 'audio/pcm'
}

function abortError(): DOMException {
  return new DOMException('Speech synthesis was aborted', 'AbortError')
}
