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

  it('splits long text without whitespace, including Chinese template text', () => {
    const tokenizer: PocketTtsTokenizer = {
      encode: (text) => new Uint32Array(Array.from(text.trim()).length)
    }

    const chunks = splitText('这是一个很长的中文听力提示文本。', tokenizer, {
      maxTokensPerChunk: 6,
      padShortInputs: false,
      removeSemicolons: false
    })

    expect(chunks).toEqual(['这是一个很长', '的中文听力提', '示文本。'])
    expect(chunks.every((chunk) => tokenizer.encode(chunk).length <= 6)).toBe(true)
  })
})
