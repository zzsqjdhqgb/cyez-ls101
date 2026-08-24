import { describe, expect, it, vi } from 'vitest'
import {
  synthesizePocketTts,
  type PocketTtsModel,
  type PocketTtsRuntimeConfig
} from '../main/pocket-tts-runtime'
import type { PocketTtsTokenizer } from '../main/pocket-tts-text'

describe('Pocket TTS runtime synthesis', () => {
  it('calls the model once for every deterministic text chunk', () => {
    const tokenizer: PocketTtsTokenizer = {
      encode: (text) => new Uint32Array(text.trim() ? text.trim().split(/\s+/).length : 0)
    }
    let hasFrame = true
    const model: PocketTtsModel = {
      prepare_text: vi.fn((text: string) => [text, 0] as [string, number]),
      start_generation: vi.fn(),
      generation_step: vi.fn(() => {
        if (hasFrame) {
          hasFrame = false
          return new Float32Array([0.25])
        }
        hasFrame = true
        return undefined
      })
    }
    const config: PocketTtsRuntimeConfig = {
      maxTokensPerChunk: 4,
      silenceBetweenChunksMs: 0,
      sampleRate: 24_000,
      temperature: 0.7,
      maxFramesPerChunk: 1200,
      padShortInputs: false,
      removeSemicolons: false
    }

    const audio = synthesizePocketTts(
      'one two three. four five six. seven eight nine.',
      7,
      model,
      tokenizer,
      config
    )

    expect(model.start_generation).toHaveBeenCalledTimes(3)
    expect(model.start_generation.mock.calls.map(([voiceIndex]) => voiceIndex)).toEqual([7, 7, 7])
    expect(model.prepare_text).toHaveBeenCalledTimes(3)
    expect(audio.slice(0, 4)).toEqual(new Uint8Array([82, 73, 70, 70]))
  })

  it('stops generation when the model never emits an end frame', () => {
    const tokenizer: PocketTtsTokenizer = { encode: () => new Uint32Array([1]) }
    const model: PocketTtsModel = {
      prepare_text: vi.fn((text: string) => [text, 0] as [string, number]),
      start_generation: vi.fn(),
      generation_step: vi.fn(() => new Float32Array([0.1]))
    }
    expect(() =>
      synthesizePocketTts('hello', 0, model, tokenizer, {
        maxTokensPerChunk: 4,
        maxFramesPerChunk: 2,
        silenceBetweenChunksMs: 0,
        sampleRate: 24_000,
        temperature: 0.7,
        padShortInputs: false,
        removeSemicolons: false
      })
    ).toThrow('Pocket TTS 生成超过单段帧数限制（2）')
    expect(model.generation_step).toHaveBeenCalledTimes(3)
  })
})
