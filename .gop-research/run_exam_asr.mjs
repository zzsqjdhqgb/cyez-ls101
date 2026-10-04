import { readFile } from 'node:fs/promises'
import { AIRouterSpeechRecognitionService } from '../packages/airouter/dist/main/speech-recognition-service.js'

const audioPath = process.argv[2] ?? '/workspace/.gop-research/exam/recording-1.webm'
const audio = new Uint8Array(await readFile(audioPath))
const service = new AIRouterSpeechRecognitionService({
  assetsDir: '/workspace/externals/ai/stt/model',
  ffmpegPath: '/usr/bin/ffmpeg'
})

const result = await service.recognize({
  providerConfigId: 'builtin-qwen3-asr',
  modelId: 'qwen3-asr-0.6b',
  audio: {
    data: audio,
    mediaType: 'audio/webm;codecs=opus',
    filename: 'recording-1.webm'
  }
})

console.log(JSON.stringify({ audioPath, bytes: audio.byteLength, ...result }, null, 2))
process.exit(0)
