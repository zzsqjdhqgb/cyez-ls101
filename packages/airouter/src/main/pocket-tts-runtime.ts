import { encodeWav } from './tts/wav-encoder'
import { splitText, type PocketTtsTokenizer, type PocketTtsTextOptions } from './pocket-tts-text'

export interface PocketTtsModel {
  generation_step(): Float32Array | undefined
  prepare_text(text: string): [string, number]
  start_generation(
    voiceIndex: number,
    tokenIds: Uint32Array,
    framesAfterEos: number,
    temperature: number
  ): void
}

export interface PocketTtsRuntimeConfig extends PocketTtsTextOptions {
  sampleRate: number
  silenceBetweenChunksMs: number
  temperature: number
}

export function synthesizePocketTts(
  text: string,
  voiceIndex: number,
  model: PocketTtsModel,
  tokenizer: PocketTtsTokenizer,
  config: PocketTtsRuntimeConfig
): Uint8Array {
  const chunks = splitText(text, tokenizer, config)
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
