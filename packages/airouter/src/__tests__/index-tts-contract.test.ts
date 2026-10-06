/**
 * Contract test against a real helper process.
 *
 * The unit tests inject a fake child process; this one spawns an actual binary so the stdio
 * protocol, framing, WAV payload and shutdown path are exercised end to end. It is skipped
 * unless LS101_INDEX_TTS_STUB points at a compiled helper. Build the double with:
 *
 *   g++ -O2 -std=c++17 -o ls101-index-tts-helper-cuda native/index-tts/stub/helper-stub.cpp
 *   LS101_INDEX_TTS_STUB=$PWD/ls101-index-tts-helper-cuda yarn vitest run \
 *     packages/airouter/src/__tests__/index-tts-contract.test.ts
 */
import { describe, expect, it } from 'vitest'
import type { AIRouterLocalSpeechRequest } from '../main/speech-service'
import { IndexTtsSynthesizer } from '../main/index-tts'

const stubPath = process.env.LS101_INDEX_TTS_STUB
const describeWithStub = stubPath ? describe : describe.skip

function createRequest(): AIRouterLocalSpeechRequest {
  return {
    provider: {
      id: 'index-local',
      name: 'IndexTTS 本地语音',
      kind: 'local',
      type: 'index-tts',
      baseUrl: '',
      modelPackageId: 'index-package',
      modelPackageVersion: '1.0.0',
      models: [{ id: 'index-model', enabled: true }],
      voices: [{ id: 'voice', enabled: true }],
      backend: 'cuda'
    },
    manifest: {
      format: 'ls101.tts-model-package',
      formatVersion: 1,
      package: { id: 'index-package', version: '1.0.0', name: 'IndexTTS 2.5' },
      runtime: { engine: 'index-tts', engineApiVersion: 1 },
      assets: [],
      models: [
        {
          id: 'index-model',
          name: 'IndexTTS 2.5 fp16',
          artifacts: { 'tts-model': ['models/index-tts2_5-f16.gguf'] },
          parameters: { synthesis: { weightType: 'f16', threads: 4 } }
        }
      ],
      voices: [{ id: 'voice', name: 'Voice', files: ['voices/reference.wav'] }]
    },
    modelId: 'index-model',
    voiceId: 'voice',
    text: 'Hello from IndexTTS.',
    format: 'wav',
    async resolveAssetPath(assetPath: string) {
      return `/nonexistent/${assetPath}`
    }
  }
}

describeWithStub('IndexTtsSynthesizer contract (real helper process)', () => {
  it('returns a mono 22050 Hz PCM16 WAV delivered over the stdio protocol', async () => {
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cuda: stubPath as string },
      startupTimeoutMs: 10_000,
      synthesisTimeoutMs: 10_000
    })
    try {
      const audio = await synthesizer.synthesize(createRequest())
      expect(audio.mediaType).toBe('audio/wav')
      expect(audio.format).toBe('wav')
      expect(audio.channels).toBe(1)
      expect(audio.sampleRate).toBe(22050)

      const wav = Buffer.from(audio.data)
      expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
      expect(wav.readUInt16LE(22)).toBe(1) // mono
      expect(wav.readUInt32LE(24)).toBe(22050) // sample rate
      expect(wav.readUInt16LE(34)).toBe(16) // bits per sample
      expect(wav.readUInt32LE(40)).toBe(wav.byteLength - 44) // data chunk size
      expect(audio.durationMs).toBeGreaterThan(0)
    } finally {
      synthesizer.dispose()
    }
  })

  it('serializes many requests through one long-lived process', async () => {
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cuda: stubPath as string },
      startupTimeoutMs: 10_000,
      synthesisTimeoutMs: 10_000
    })
    try {
      const results = await Promise.all([
        synthesizer.synthesize(createRequest()),
        synthesizer.synthesize({ ...createRequest(), voiceId: 'voice', text: 'second request' }),
        synthesizer.synthesize({ ...createRequest(), text: 'third request' })
      ])
      for (const audio of results) {
        expect(Buffer.from(audio.data).subarray(0, 4).toString('ascii')).toBe('RIFF')
        expect(audio.sampleRate).toBe(22050)
      }
    } finally {
      synthesizer.dispose()
    }
  })

  it('surfaces a helper error frame as a Chinese synthesis failure', async () => {
    const previous = process.env.LS101_STUB_FAIL
    process.env.LS101_STUB_FAIL = '1'
    const synthesizer = new IndexTtsSynthesizer({
      helperPaths: { cuda: stubPath as string },
      startupTimeoutMs: 10_000,
      synthesisTimeoutMs: 10_000
    })
    try {
      await expect(synthesizer.synthesize(createRequest())).rejects.toThrow(/IndexTTS 合成失败/)
    } finally {
      synthesizer.dispose()
      if (previous === undefined) delete process.env.LS101_STUB_FAIL
      else process.env.LS101_STUB_FAIL = previous
    }
  })
})
