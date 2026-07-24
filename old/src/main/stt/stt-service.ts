/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'

const LOG_PREFIX = '[STT]'
const log = {
  debug: (...args: unknown[]): void => {
    console.debug(LOG_PREFIX, ...args)
  },
  info: (...args: unknown[]): void => {
    console.log(LOG_PREFIX, ...args)
  },
  warn: (...args: unknown[]): void => {
    console.warn(LOG_PREFIX, ...args)
  },
  error: (...args: unknown[]): void => {
    console.error(LOG_PREFIX, ...args)
  }
}

interface SttApi {
  transcribe: (audioPath: string) => Promise<string>
}

let _enginePromise: Promise<SttApi> | null = null
let _worker: Worker | null = null

function resolveAssetsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'assets') : join(app.getAppPath(), 'assets')
}

function resolveFfmpegBin(): string {
  if (!app.isPackaged) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('ffmpeg-static')
  }
  const ext = process.platform === 'win32' ? '.exe' : ''
  const asarUnpackedDir = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'ffmpeg-static'
  )
  const ffmpegBin = join(asarUnpackedDir, `ffmpeg${ext}`)
  if (!existsSync(ffmpegBin)) {
    log.error(`ffmpeg not found at ${ffmpegBin}`)
  }
  return ffmpegBin
}

export async function getSttEngine(): Promise<SttApi> {
  if (_enginePromise) {
    return _enginePromise
  }

  process.env.FFMPEG_BIN = resolveFfmpegBin()

  _enginePromise = new Promise<SttApi>((resolve, reject) => {
    const workerPath = join(__dirname, 'stt-worker.js')
    const assetsDir = resolveAssetsDir()

    log.info('Spawning STT worker...')
    const worker = new Worker(workerPath, {
      workerData: { assetsDir }
    })
    _worker = worker

    const pendingRequests = new Map<
      number,
      { resolve: (text: string) => void; reject: (err: Error) => void }
    >()
    let requestId = 0

    worker.on('message', (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case 'ready':
          log.info('STT worker ready')
          resolve({
            transcribe: (audioPath: string): Promise<string> => {
              return new Promise<string>((res, rej) => {
                const id = ++requestId
                pendingRequests.set(id, { resolve: res, reject: rej })
                worker.postMessage({ type: 'transcribe', requestId: id, audioPath })
              })
            }
          })
          break

        case 'init-error':
          log.error('STT worker init failed:', msg.error)
          reject(new Error(String(msg.error)))
          break

        case 'transcribe-done': {
          const id = msg.requestId as number
          const pending = pendingRequests.get(id)
          if (pending) {
            pendingRequests.delete(id)
            pending.resolve(msg.text as string)
          }
          break
        }

        case 'transcribe-error': {
          const id = msg.requestId as number
          const pending = pendingRequests.get(id)
          if (pending) {
            pendingRequests.delete(id)
            pending.reject(new Error(String(msg.error)))
          }
          break
        }

        default:
          log.warn('Unknown message from worker:', msg)
      }
    })

    worker.on('error', (err) => {
      log.error('Worker error:', err)
      _enginePromise = null
      _worker = null
      reject(err)
    })

    worker.on('exit', (code) => {
      if (code !== 0 && _enginePromise) {
        const err = new Error(`STT worker exited with code ${code}`)
        log.error(err.message)
        _enginePromise = null
        _worker = null
        reject(err)
      }
    })
  })

  return _enginePromise
}

export function terminateSttWorker(): void {
  if (_worker) {
    _worker.terminate()
    _worker = null
    _enginePromise = null
    log.info('STT worker terminated')
  }
}
