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
  maxFramesPerChunk: number
  onProgress?(message: string): void
}

export function synthesizePocketTts(
  text: string,
  voiceIndex: number,
  model: PocketTtsModel,
  tokenizer: PocketTtsTokenizer,
  config: PocketTtsRuntimeConfig
): Uint8Array {
  const chunks = splitText(text, tokenizer, config)
  config.onProgress?.(`split text into ${chunks.length} chunk(s)`)
  const audioChunks: Float32Array[] = []
  for (let index = 0; index < chunks.length; index++) {
    const chunkLabel = `chunk ${index + 1}/${chunks.length}`
    config.onProgress?.(`${chunkLabel}: preparing text`)
    const [processedText, framesAfterEos] = model.prepare_text(chunks[index])
    const tokenIds = tokenizer.encode(processedText)
    config.onProgress?.(
      `${chunkLabel}: prepared ${tokenIds.length} token(s), framesAfterEos=${framesAfterEos}`
    )
    if (tokenIds.length === 0) {
      config.onProgress?.(`${chunkLabel}: skipped empty token sequence`)
      continue
    }
    model.start_generation(voiceIndex, tokenIds, framesAfterEos, config.temperature)
    config.onProgress?.(`${chunkLabel}: generation loop started`)
    const frames: Float32Array[] = []
    while (true) {
      const frame = model.generation_step()
      if (!frame) break
      if (frames.length >= config.maxFramesPerChunk) {
        throw new Error(
          `Pocket TTS 生成超过单段帧数限制（${config.maxFramesPerChunk}），请检查文本语言或缩短文本`
        )
      }
      frames.push(new Float32Array(frame))
      if (frames.length === 1 || frames.length % 100 === 0) {
        config.onProgress?.(`${chunkLabel}: generated ${frames.length} frame(s)`)
      }
    }
    config.onProgress?.(`${chunkLabel}: generation completed with ${frames.length} frame(s)`)
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
  const wav = encodeWav(samples, config.sampleRate)
  config.onProgress?.(`encoded WAV with ${samples.length} sample(s), ${wav.byteLength} byte(s)`)
  return wav
}
