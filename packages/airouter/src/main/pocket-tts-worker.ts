import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { synthesizePocketTts, type PocketTtsModel } from './pocket-tts-runtime'
import { decodeSentencepieceModel, UnigramTokenizer } from './tts/tokenizer'

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

interface PocketModel extends PocketTtsModel {
  add_voice(data: Uint8Array): number
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

function synthesize(text: string, voiceId: string): Uint8Array {
  if (!model || !tokenizer) throw new Error('TTS engine is not initialized')
  const voiceIndex = voiceMap.get(voiceId)
  if (voiceIndex === undefined) throw new Error(`Unknown TTS voice: ${voiceId}`)
  return synthesizePocketTts(text, voiceIndex, model, tokenizer, config)
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
