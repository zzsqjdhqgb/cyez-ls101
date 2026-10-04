import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { assessCtcPronunciation } from './pronunciation-engine.mjs'

const audioPath = process.argv[2] ?? '/workspace/.gop-research/exam/recording-11.webm'
const referenceText =
  "I do believe that e-books over weigh paper books when, in terms of the preferences for reading. The three reasons include: the e-books large capacity of storage, its convenience, and also its easy access to any material worldwide, including both the latest papers in the top notch journals and also some of the best sellers. That hasn't been printed in paper books. But if you want me to say some advantages of paper books, I do believe that reading paper books is like sipping a cup of tea. Because if you have the leisure, if you have the convenience, and if you do have time, or if you just want to read one book, then you can take one and sit by the window and read it, enjoy it."
const modelDir = '/workspace/externals/ai/pronunciation/model/facebook-wav2vec2-lv-60-espeak-cv-ft-int8'

const converted = spawnSync('/usr/bin/ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ar', '16000', '-ac', '1',
  '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'
], { input: readFileSync(audioPath), maxBuffer: 256 * 1024 * 1024 })
if (converted.status !== 0) throw new Error(converted.stderr.toString())
const bytes = converted.stdout
const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
let mean = 0
for (const sample of samples) mean += sample
mean /= samples.length
let variance = 0
for (const sample of samples) variance += (sample - mean) ** 2
variance /= samples.length
const scale = Math.sqrt(variance + 1e-7)
for (let index = 0; index < samples.length; index += 1) samples[index] = (samples[index] - mean) / scale

const vocabulary = JSON.parse(readFileSync(`${modelDir}/vocab.json`, 'utf8'))
const session = await InferenceSession.create(`${modelDir}/onnx/model_quantized.onnx`, {
  executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: 2, interOpNumThreads: 1
})
const output = await session.run({ input_values: new Tensor('float32', samples, [1, samples.length]) })
const logits = output.logits
if (!logits || !(logits.data instanceof Float32Array)) throw new Error('invalid logits')
const result = assessCtcPronunciation({
  logits: logits.data,
  frameCount: Number(logits.dims[1]),
  vocabularySize: Number(logits.dims[2]),
  vocabulary,
  referenceText,
  durationMs: samples.length / 16000 * 1000,
  blankTokenId: vocabulary['<pad>'] ?? 0
})
console.log(JSON.stringify({ audioPath, ...result }, null, 2))
