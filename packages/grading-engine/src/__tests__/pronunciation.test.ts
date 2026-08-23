import { describe, expect, it } from 'vitest'
import {
  assessCtcPronunciation,
  CMU_PHONE_TO_IPA,
  createPronunciationReferences
} from '../pronunciation'

describe('pronunciation GOP assessment', () => {
  it('creates complete CMU and IPA references from CMUdict', () => {
    const references = createPronunciationReferences('Three weather reports.')

    expect(references.length).toBeGreaterThan(0)
    expect(references[0].words.map((word) => word.text)).toEqual(['Three', 'weather', 'reports'])
    expect(references[0].words[0]).toMatchObject({
      phones: ['TH', 'R', 'IY'],
      ipaPhones: ['θ', 'ɹ', 'iː']
    })
    expect(references[0].phones).toContain('DH')
    expect(references[0].ipaPhones).toContain('ð')
  })

  it('derives auditable pronunciations for supported word suffixes', () => {
    const [slushy] = createPronunciationReferences('slushy')
    const [schoolrooms] = createPronunciationReferences('schoolrooms')

    expect(slushy.words[0]).toMatchObject({
      phones: ['S', 'L', 'AH', 'SH', 'IY'],
      ipaPhones: ['s', 'l', 'ʌ', 'ʃ', 'i']
    })
    expect(schoolrooms.words[0].phones.at(-1)).toBe('Z')
  })

  it('loads dictionary variants even when their numeric suffix skips one', () => {
    const references = createPronunciationReferences('to')

    expect(references.map((reference) => reference.phones)).toEqual([
      ['T', 'UW'],
      ['T', 'IH'],
      ['T', 'AH']
    ])
  })

  it('emits a complete low-GOP row for a forced-alignment substitution', () => {
    const vocabulary = pronunciationVocabulary('ipa')
    const dominant = ['<pad>', 'S', '<pad>', 'R', '<pad>', 'IY', '<pad>']
    const logits = syntheticLogits(dominant, vocabulary)

    const result = assessCtcPronunciation({
      logits,
      frameCount: dominant.length,
      vocabularySize: Object.keys(vocabulary).length,
      vocabulary,
      referenceText: 'three',
      durationMs: 700
    })

    expect(result).toMatchObject({
      schema_version: 2,
      reference_text: 'three',
      recognized_phones: ['S', 'R', 'IY'],
      gop_method: 'viterbi'
    })
    expect(result.phones).toHaveLength(3)
    expect(result.words[0]).toMatchObject({
      word_index: 0,
      text: 'three',
      expected_arpabet: ['TH', 'R', 'IY'],
      expected_ipa: ['θ', 'ɹ', 'iː']
    })
    expect(result.phones[0]).toMatchObject({
      index: 0,
      word_index: 0,
      phone_index: 0,
      word: 'three',
      expected: 'TH',
      expected_ipa: 'θ',
      acoustic_winner: 'S',
      acoustic_winner_ipa: 's',
      best_alternative: 'S',
      best_alternative_ipa: 's',
      start_ms: 100,
      end_ms: 200
    })
    expect(result.phones[0].expected_log_p).toBeLessThan(result.phones[0].alternative_log_p)
    expect(result.phones[0].gop_log_ratio).toBeLessThanOrEqual(-0.35)
    expect(result.phones[0].confidence).toBe(1)
  })

  it('keeps a matching phone above the frozen low-GOP threshold', () => {
    const vocabulary = pronunciationVocabulary('ipa')
    const dominant = ['<pad>', 'TH', '<pad>', 'R', '<pad>', 'IY', '<pad>']

    const result = assessCtcPronunciation({
      logits: syntheticLogits(dominant, vocabulary),
      frameCount: dominant.length,
      vocabularySize: Object.keys(vocabulary).length,
      vocabulary,
      referenceText: 'three',
      durationMs: 700
    })

    expect(result.phones.every((phone) => phone.gop_log_ratio > -0.35)).toBe(true)
    expect(result.phones[0].acoustic_winner).toBe('TH')
  })

  it('supports a native uppercase CMU-phone model vocabulary', () => {
    const vocabulary = pronunciationVocabulary('cmu')
    const dominant = ['<pad>', 'B', '<pad>', 'UH', '<pad>', 'K', '<pad>', 'S', '<pad>']

    const result = assessCtcPronunciation({
      logits: syntheticLogits(dominant, vocabulary),
      frameCount: dominant.length,
      vocabularySize: Object.keys(vocabulary).length,
      vocabulary,
      referenceText: 'books',
      durationMs: 900
    })

    expect(result.acoustic_phone_inventory).toContain('uppercase ARPAbet')
    expect(result.recognized_phones).toEqual(['B', 'UH', 'K', 'S'])
    expect(result.words[0].expected_arpabet).toEqual(['B', 'UH', 'K', 'S'])
  })
})

function pronunciationVocabulary(mode: 'cmu' | 'ipa'): Record<string, number> {
  const tokens = Object.entries(CMU_PHONE_TO_IPA).map(([cmu, ipa]) => (mode === 'cmu' ? cmu : ipa))
  return Object.fromEntries(['<pad>', ...tokens].map((token, index) => [token, index]))
}

function syntheticLogits(
  dominantPhones: readonly string[],
  vocabulary: Readonly<Record<string, number>>
): Float32Array {
  const vocabularySize = Object.keys(vocabulary).length
  const logits = new Float32Array(dominantPhones.length * vocabularySize).fill(-4)
  dominantPhones.forEach((phone, frame) => {
    const token = phone === '<pad>' ? phone : (CMU_PHONE_TO_IPA[phone] ?? phone)
    const tokenId = vocabulary[token] ?? vocabulary[phone]
    if (tokenId === undefined) throw new Error(`missing synthetic token ${phone}`)
    logits[frame * vocabularySize + tokenId] = 4
  })
  return logits
}
