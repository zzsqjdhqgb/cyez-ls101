/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/tts/tts.ts — Thin wrapper: spawns worker thread for TTS synthesis
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { app } from 'electron'

const LOG_PREFIX = '[TTS]'
const log = {
  debug: (...args: unknown[]) => console.debug(LOG_PREFIX, ...args),
  info: (...args: unknown[]) => console.log(LOG_PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(LOG_PREFIX, ...args),
  error: (...args: unknown[]) => console.error(LOG_PREFIX, ...args)
}

interface SynthesizeApi {
  synthesize: (text: string, outFile: string) => Promise<void>
}

let _enginePromise: Promise<SynthesizeApi> | null = null
let _worker: Worker | null = null

function resolveWorkerPath(): {
  pttsWasmJsPath: string
  wasmBinaryPath: string
  assetsDir: string
} {
  const pttsWasmJsPath = app.isPackaged
    ? join(process.resourcesPath, 'tts', 'ptts_wasm.js')
    : join(app.getAppPath(), 'resources', 'tts', 'ptts_wasm.js')

  const wasmBinaryPath = app.isPackaged
    ? join(process.resourcesPath, 'tts', 'ptts_wasm_bg.wasm')
    : join(app.getAppPath(), 'resources', 'tts', 'ptts_wasm_bg.wasm')

  const assetsDir = app.isPackaged
    ? join(process.resourcesPath, 'assets')
    : join(app.getAppPath(), 'assets')

  return { pttsWasmJsPath, wasmBinaryPath, assetsDir }
}

export async function getTtsEngine(): Promise<SynthesizeApi> {
  if (_enginePromise) {
    log.debug('Reusing existing TTS engine')
    return _enginePromise
  }

  _enginePromise = new Promise<SynthesizeApi>((resolve, reject) => {
    const paths = resolveWorkerPath()
    const workerPath = join(__dirname, 'tts-worker.js')

    log.info('Spawning TTS worker...')
    const worker = new Worker(workerPath, {
      workerData: paths
    })
    _worker = worker

    const pendingRequests = new Map<number, { resolve: () => void; reject: (err: Error) => void }>()
    let requestId = 0

    worker.on('message', (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case 'ready':
          log.info('TTS worker ready')
          resolve({
            synthesize: (text: string, outFile: string): Promise<void> => {
              return new Promise<void>((res, rej) => {
                const id = ++requestId
                pendingRequests.set(id, { resolve: res, reject: rej })
                worker.postMessage({ type: 'synthesize', requestId: id, text, outFile })
              })
            }
          })
          break

        case 'init-error':
          log.error('TTS worker init failed:', msg.error)
          reject(new Error(String(msg.error)))
          break

        case 'synthesize-done': {
          const id = msg.requestId as number
          const pending = pendingRequests.get(id)
          if (pending) {
            pendingRequests.delete(id)
            pending.resolve()
          }
          break
        }

        case 'synthesize-error': {
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
      if (code !== 0) {
        const err = new Error(`TTS worker exited with code ${code}`)
        log.error(err.message)
        _enginePromise = null
        _worker = null
        reject(err)
      }
    })
  })

  return _enginePromise
}

export function terminateTtsWorker(): void {
  if (_worker) {
    _worker.terminate()
    _worker = null
    _enginePromise = null
    log.info('TTS worker terminated')
  }
}
