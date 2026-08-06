import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { decodeSentencepieceModel, UnigramTokenizer } from './tts/tokenizer'
import { encodeWav } from './tts/wav-encoder'

interface WorkerConfig {
  pttsWasmJsPath: string
  wasmBinaryPath: string
  modelPath: string
  tokenizerPath: string
  voices: Array<{ id: string; path: string }>
  quantization: string
  sampleRate: number
  maxTokensPerChunk: number
  silenceBetweenChunksMs: number
  temperature: number
  padShortInputs: boolean
  removeSemicolons: boolean
}

interface PocketModel {
  add_voice(data: Uint8Array): number
  generation_step(): Float32Array | undefined
  prepare_text(text: string): [string, number]
  start_generation(
    voiceIndex: number,
    tokenIds: Uint32Array,
    framesAfterEos: number,
    temperature: number
  ): void
  sample_rate(): number
}

interface PocketModule {
  Model: new (weights: Uint8Array, quantization: string) => PocketModel
  initSync(data: BufferSource | WebAssembly.Module): void
}

const config = workerData as WorkerConfig
let model: PocketModel | null = null
let tokenizer: UnigramTokenizer | null = null
const voiceMap = new Map<string, number>()

function send(message: Record<string, unknown>): void {
  parentPort?.postMessage(message)
}

async function initialize(): Promise<void> {
  const module = (await import(pathToFileURL(config.pttsWasmJsPath).href)) as PocketModule
  module.initSync(readFileSync(config.wasmBinaryPath))
  tokenizer = new UnigramTokenizer(
    decodeSentencepieceModel(new Uint8Array(readFileSync(config.tokenizerPath)))
  )
  model = new module.Model(new Uint8Array(readFileSync(config.modelPath)), config.quantization)
  for (const voice of config.voices) {
    voiceMap.set(voice.id, model.add_voice(new Uint8Array(readFileSync(voice.path))))
  }
}

function preprocessText(text: string): string {
  let normalized = text.trim()
  if (!normalized) throw new Error('Text prompt cannot be empty')
  normalized = normalized.replace(/\n|\r/g, ' ').replace(/  +/g, ' ')
  if (config.removeSemicolons) normalized = normalized.replace(/;/g, ',')
  if (!/^[A-Z\u{00C0}-\u{024F}\u{0400}-\u{04FF}]/u.test(normalized[0])) {
    normalized = normalized[0].toLocaleUpperCase() + normalized.slice(1)
  }
  if (/[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF]$/.test(normalized)) normalized += '.'
  if (config.padShortInputs && normalized.split(/\s+/).length < 5)
    normalized = `        ${normalized}`
  return normalized
}

function splitText(text: string): string[] {
  if (!tokenizer) throw new Error('TTS tokenizer is not initialized')
  const normalized = preprocessText(text)
  const rawSentences = normalized.split(/(?<=[.!?。！？])/).filter((item) => item.trim())
  const refined: Array<{ text: string; tokens: number }> = []

  for (const sentence of rawSentences) {
    const trimmed = sentence.trim()
    const tokens = tokenizer.encode(trimmed).length
    if (tokens <= config.maxTokensPerChunk) {
      refined.push({ text: trimmed, tokens })
      continue
    }
    const pieces = trimmed.split(/(?<=[，,;；:：])/).filter((item) => item.trim())
    if (pieces.length > 1) {
      for (const piece of pieces) {
        const value = piece.trim()
        refined.push({ text: value, tokens: tokenizer.encode(value).length })
      }
      continue
    }
    let current = ''
    let currentTokens = 0
    for (const word of trimmed.split(/(?<=\s)/)) {
      const wordTokens = tokenizer.encode(word).length
      if (current && currentTokens + wordTokens > config.maxTokensPerChunk) {
        refined.push({ text: current.trim(), tokens: currentTokens })
        current = word
        currentTokens = wordTokens
      } else {
        current += word
        currentTokens += wordTokens
      }
    }
    if (current.trim()) refined.push({ text: current.trim(), tokens: currentTokens })
  }

  const chunks: string[] = []
  let current = ''
  let currentTokens = 0
  for (const item of refined) {
    if (!current) {
      current = item.text
      currentTokens = item.tokens
    } else if (currentTokens + item.tokens <= config.maxTokensPerChunk) {
      current += ` ${item.text}`
      currentTokens += item.tokens
    } else {
      chunks.push(current)
      current = item.text
      currentTokens = item.tokens
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function synthesize(text: string, voiceId: string): Uint8Array {
  if (!model || !tokenizer) throw new Error('TTS engine is not initialized')
  const voiceIndex = voiceMap.get(voiceId)
  if (voiceIndex === undefined) throw new Error(`Unknown TTS voice: ${voiceId}`)
  const chunks = splitText(text)
  const audioChunks: Float32Array[] = []
  for (let index = 0; index < chunks.length; index++) {
    const [processedText, framesAfterEos] = model.prepare_text(chunks[index])
    const tokenIds = tokenizer.encode(processedText)
    if (tokenIds.length === 0) continue
    model.start_generation(voiceIndex, tokenIds, framesAfterEos, config.temperature)
    const frames: Float32Array[] = []
    while (true) {
      const frame = model.generation_step()
      if (!frame) break
      frames.push(new Float32Array(frame))
    }
    const chunkSamples = new Float32Array(frames.reduce((total, frame) => total + frame.length, 0))
    let offset = 0
    for (const frame of frames) {
      chunkSamples.set(frame, offset)
      offset += frame.length
    }
    audioChunks.push(chunkSamples)
    if (index < chunks.length - 1) {
      audioChunks.push(
        new Float32Array(Math.floor((config.silenceBetweenChunksMs / 1000) * config.sampleRate))
      )
    }
  }
  const totalSamples = audioChunks.reduce((total, chunk) => total + chunk.length, 0)
  const samples = new Float32Array(totalSamples)
  let offset = 0
  for (const chunk of audioChunks) {
    samples.set(chunk, offset)
    offset += chunk.length
  }
  return encodeWav(samples, config.sampleRate)
}

if (!parentPort) throw new Error('TTS worker parent port is unavailable')

void initialize()
  .then(() => send({ type: 'ready' }))
  .catch((error: unknown) => send({ type: 'init-error', message: errorMessage(error) }))

parentPort.on(
  'message',
  (message: { type?: unknown; requestId?: unknown; text?: unknown; voiceId?: unknown }) => {
    if (message.type !== 'synthesize' || typeof message.requestId !== 'string') return
    if (typeof message.text !== 'string' || typeof message.voiceId !== 'string') {
      send({ type: 'error', requestId: message.requestId, message: 'TTS 请求参数无效' })
      return
    }
    try {
      const data = synthesize(message.text, message.voiceId)
      send({ type: 'result', requestId: message.requestId, data })
    } catch (error) {
      send({ type: 'error', requestId: message.requestId, message: errorMessage(error) })
    }
  }
)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
