import { describe, expect, it } from 'vitest'
import {
  assessCtcPronunciation,
  createPronunciationReferences
} from '../pronunciation'

describe('pronunciation assessment', () => {
  it('creates model-compatible IPA references from CMUdict', () => {
    const references = createPronunciationReferences('Three weather reports.')

    expect(references.length).toBeGreaterThan(0)
    expect(references[0].words.map((word) => word.text)).toEqual(['Three', 'weather', 'reports'])
    expect(references[0].words[0].phones).toEqual(['θ', 'ɹ', 'iː'])
    expect(references[0].phones).toContain('ð')
  })

  it('derives an auditable pronunciation for a missing y-suffix word', () => {
    const [reference] = createPronunciationReferences('slushy')

    expect(reference.words[0].phones).toEqual(['s', 'l', 'ʌ', 'ʃ', 'i'])
  })

  it('derives a plural pronunciation from a known singular compound', () => {
    const [reference] = createPronunciationReferences('schoolrooms')

    expect(reference.words[0].phones.at(-1)).toBe('z')
  })

  it('loads dictionary variants even when their numeric suffix skips one', () => {
    const references = createPronunciationReferences('to')

    expect(references.map((reference) => reference.phones)).toEqual([
      ['t', 'uː'],
      ['t', 'ɪ'],
      ['t', 'ə']
    ])
  })

  it('aligns expected phones and reports a confident substitution', () => {
    const vocabulary = { '<pad>': 0, 'θ': 1, 'ɹ': 2, 'iː': 3, s: 4 }
    const dominant = [0, 4, 0, 2, 0, 3, 0]
    const logits = syntheticLogits(dominant, Object.keys(vocabulary).length)

    const result = assessCtcPronunciation({
      logits,
      frameCount: dominant.length,
      vocabularySize: Object.keys(vocabulary).length,
      vocabulary,
      referenceText: 'three',
      durationMs: 700
    })

    expect(result.words).toHaveLength(1)
    expect(result.words[0].phones[0]).toMatchObject({
      expected: 'θ',
      observed: 's'
    })
    expect(result.words[0].phones[0].score).toBeLessThan(40)
    expect(result.feedbackMarkdown).toContain('three')
    expect(result.feedbackMarkdown).toContain('/θ/')
    expect(result.recognizedPhones).toEqual(['s', 'ɹ', 'iː'])
  })

  it('does not claim a pronunciation error for a matching path', () => {
    const vocabulary = { '<pad>': 0, 'θ': 1, 'ɹ': 2, 'iː': 3, s: 4 }
    const dominant = [0, 1, 0, 2, 0, 3, 0]

    const result = assessCtcPronunciation({
      logits: syntheticLogits(dominant, Object.keys(vocabulary).length),
      frameCount: dominant.length,
      vocabularySize: Object.keys(vocabulary).length,
      vocabulary,
      referenceText: 'three',
      durationMs: 700
    })

    expect(result.overallScore).toBeGreaterThan(90)
    expect(result.feedbackMarkdown).toContain('未发现高置信度')
  })
})

function syntheticLogits(dominantTokenIds: readonly number[], vocabularySize: number): Float32Array {
  const logits = new Float32Array(dominantTokenIds.length * vocabularySize).fill(-4)
  dominantTokenIds.forEach((tokenId, frame) => {
    logits[frame * vocabularySize + tokenId] = 4
  })
  return logits
}
