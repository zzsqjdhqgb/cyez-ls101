import { describe, expect, it } from 'vitest'
import { splitText, type PocketTtsTokenizer } from '../main/pocket-tts-text'

describe('Pocket TTS text chunking', () => {
  it('produces multiple chunks when the token budget is exceeded', () => {
    const tokenizer: PocketTtsTokenizer = {
      encode: (text) => new Uint32Array(text.trim() ? text.trim().split(/\s+/).length : 0)
    }

    const chunks = splitText('one two three. four five six. seven eight nine.', tokenizer, {
      maxTokensPerChunk: 4,
      padShortInputs: false,
      removeSemicolons: false
    })

    expect(chunks).toEqual(['One two three.', 'four five six.', 'seven eight nine.'])
    expect(chunks).toHaveLength(3)
  })
})
