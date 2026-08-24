/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/tts/tts-worker.ts — Worker thread for TTS synthesis
import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

interface WorkerConfig {
  pttsWasmJsPath: string
  wasmBinaryPath: string
  assetsDir: string
}

const cfg: WorkerConfig = workerData as WorkerConfig

let wasmModule: typeof import('./ptts_wasm.js') | null = null

const SAMPLE_RATE = 24000
const MAX_TOKEN_PER_CHUNK = 50
const SILENCE_BETWEEN_CHUNKS = 0.2
const PAD_SHORT_INPUTS = false
const REMOVE_SEMICOLONS = false

const LOG_PREFIX = '[TTS-Worker]'
const log = {
  debug: (...args: unknown[]) => console.debug(LOG_PREFIX, ...args),
  info: (...args: unknown[]) => console.log(LOG_PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(LOG_PREFIX, ...args),
  error: (...args: unknown[]) => console.error(LOG_PREFIX, ...args)
}

function send(msg: Record<string, unknown>): void {
  parentPort!.postMessage(msg)
}

// ---------- 文本预处理 ----------
function preprocessText(text: string, padShort: boolean, removeSemicolons: boolean): string {
  let t = text.trim()
  if (!t) throw new Error('Text prompt cannot be empty')
  t = t.replace(/\n|\r/g, ' ').replace(/  +/g, ' ')
  if (removeSemicolons) t = t.replace(/;/g, ',')
  if (!/^[A-Z\u{00C0}-\u{024F}\u{0400}-\u{04FF}]/u.test(t[0])) {
    t = t[0].toLocaleUpperCase() + t.slice(1)
  }
  if (/[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF]$/.test(t)) t += '.'
  if (padShort && t.split(/\s+/).length < 5) {
    t = '        ' + t
  }
  return t
}

import { decodeSentencepieceModel, UnigramTokenizer } from './tokenizer'
import { encodeWav } from './wav-encoder'

// ---------- 分句 ----------
function splitIntoBestSentences(
  text: string,
  tokenizer: UnigramTokenizer,
  maxTokens: number
): string[] {
  const normalized = preprocessText(text, PAD_SHORT_INPUTS, REMOVE_SEMICOLONS)
  const rawSentences = normalized.split(/(?<=[.!?。！？])/).filter((s) => s.trim().length > 0)
  const sentencesWithTokens = rawSentences.map((s) => ({
    text: s.trim(),
    tokens: tokenizer.encode(s.trim()).length
  }))
  const refined: { text: string; tokens: number }[] = []
  for (const { text, tokens } of sentencesWithTokens) {
    if (tokens <= maxTokens) {
      refined.push({ text, tokens })
    } else {
      const subPieces = text.split(/(?<=[，,;；:：])/).filter((s) => s.trim().length > 0)
      if (subPieces.length > 1) {
        for (const piece of subPieces) {
          const tokCount = tokenizer.encode(piece.trim()).length
          refined.push({ text: piece.trim(), tokens: tokCount })
        }
      } else {
        const words = text.split(/(?<=\s)/)
        let tempText = '',
          tempTokens = 0
        for (const w of words) {
          const combined = tempText + w
          const combinedTokens = tokenizer.encode(combined).length
          if (tempTokens > 0 && tempTokens + tokenizer.encode(w).length > maxTokens) {
            refined.push({ text: tempText.trim(), tokens: tempTokens })
            tempText = w
            tempTokens = tokenizer.encode(w).length
          } else {
            tempText = combined
            tempTokens = combinedTokens
          }
        }
        if (tempText.trim()) {
          refined.push({ text: tempText.trim(), tokens: tempTokens })
        }
      }
    }
  }
  const chunks: string[] = []
  let currentText = '',
    currentTokens = 0
  for (const { text, tokens } of refined) {
    if (currentText === '') {
      currentText = text
      currentTokens = tokens
    } else if (currentTokens + tokens <= maxTokens) {
      currentText += ' ' + text
      currentTokens += tokens
    } else {
      chunks.push(currentText)
      currentText = text
      currentTokens = tokens
    }
  }
  if (currentText !== '') chunks.push(currentText)
  return chunks
}

// ---------- 引擎初始化 ----------
let model: InstanceType<typeof import('./ptts_wasm.js').Model> | null = null
let tokenizer: UnigramTokenizer | null = null
const voiceMap: Record<string, number> = {}

async function initEngine(): Promise<void> {
  const originalConsoleLog = console.log
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && (args[0].includes('wasm') || args[0].includes('WASM'))) {
      log.debug('wasm internal:', ...args)
    } else {
      originalConsoleLog.apply(console, args)
    }
  }

  log.info('Initializing TTS engine in worker...')

  const pttsUrl = pathToFileURL(cfg.pttsWasmJsPath).href
  log.debug('Loading ptts_wasm.js from', pttsUrl)
  wasmModule = await import(pttsUrl)
  if (!wasmModule) {
    throw new Error('Failed to import ptts_wasm.js')
  }

  const wasmBuffer = readFileSync(cfg.wasmBinaryPath)
  log.debug('Loading wasm binary from', cfg.wasmBinaryPath)
  wasmModule.initSync(wasmBuffer)

  const tokenizerPath = join(cfg.assetsDir, 'tokenizer.model')
  log.debug('Loading tokenizer from', tokenizerPath)
  const tokenizerData = readFileSync(tokenizerPath)
  const pieces = decodeSentencepieceModel(tokenizerData)
  tokenizer = new UnigramTokenizer(pieces)

  const modelPath = join(cfg.assetsDir, 'tts_b6369a24.safetensors')
  log.debug('Loading model weights from', modelPath)
  const modelWeights = readFileSync(modelPath)
  model = new wasmModule.Model(modelWeights, 'f32')

  const voiceNames = ['alba', 'marius', 'javert', 'fantine', 'cosette', 'eponine', 'azelma']
  const voicesDir = join(cfg.assetsDir, 'embeddings_v2')
  for (const name of voiceNames) {
    const voicePath = join(voicesDir, `${name}.safetensors`)
    log.debug('Loading voice', name, 'from', voicePath)
    const voiceData = readFileSync(voicePath)
    voiceMap[name] = model.add_voice(voiceData)
  }

  console.log = originalConsoleLog
  log.info('TTS engine initialized successfully in worker')
}

// ---------- 合成 ----------
async function synthesize(text: string, outFile: string): Promise<void> {
  if (!model || !tokenizer) {
    throw new Error('TTS engine not initialized')
  }

  const voiceName = 'alba'
  const temperature = 0.7
  const voiceIndex = voiceMap[voiceName]

  log.info('Synthesizing:', text.substring(0, 30) + '...')
  const chunks = splitIntoBestSentences(text, tokenizer, MAX_TOKEN_PER_CHUNK)
  log.debug('Text split into', chunks.length, 'chunks')

  const allChunkAudios: Float32Array[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    log.debug('Synthesizing chunk', i + 1, '/', chunks.length, '-', chunk.substring(0, 30))
    const [processed, framesEos] = model.prepare_text(chunk)
    const tokIds = tokenizer.encode(processed)
    if (tokIds.length === 0) continue

    model.start_generation(voiceIndex, tokIds, framesEos, temperature)

    const audioFrames: Float32Array[] = []
    while (true) {
      const frame = model.generation_step()
      if (!frame) break
      audioFrames.push(new Float32Array(frame))
    }

    const chunkSamples = new Float32Array(audioFrames.reduce((sum, f) => sum + f.length, 0))
    let off = 0
    for (const f of audioFrames) {
      chunkSamples.set(f, off)
      off += f.length
    }
    allChunkAudios.push(chunkSamples)

    if (i < chunks.length - 1) {
      const silence = Math.floor(SILENCE_BETWEEN_CHUNKS * SAMPLE_RATE)
      if (silence > 0) allChunkAudios.push(new Float32Array(silence))
    }
  }

  const totalSamples = allChunkAudios.reduce((sum, a) => sum + a.length, 0)
  const pcm = new Float32Array(totalSamples)
  let offset = 0
  for (const audio of allChunkAudios) {
    pcm.set(audio, offset)
    offset += audio.length
  }

  const wavData = encodeWav(pcm, SAMPLE_RATE)
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, wavData)
  log.info('Synthesis done ->', outFile)
}

// ---------- 消息处理 ----------
if (!parentPort) {
  console.error('[TTS-Worker] parentPort is null, cannot run as worker')
  process.exit(1)
}

initEngine()
  .then(() => {
    log.info('Worker ready')
    send({ type: 'ready' })
  })
  .catch((err: unknown) => {
    log.error('Worker init failed:', err)
    send({ type: 'init-error', error: String(err) })
    process.exit(1)
  })

parentPort.on(
  'message',
  async (msg: { type: string; requestId: number; text: string; outFile: string }) => {
    if (msg.type === 'synthesize') {
      try {
        await synthesize(msg.text, msg.outFile)
        send({ type: 'synthesize-done', requestId: msg.requestId })
      } catch (err: unknown) {
        log.error('Synthesis error:', err)
        send({ type: 'synthesize-error', requestId: msg.requestId, error: String(err) })
      }
    }
  }
)
