import { describe, expect, it } from 'vitest'
import {
  assessCtcPronunciation,
  CMU_PHONE_TO_IPA,
  createPronunciationReferences,
  noDictionaryCoverageError,
  parseNoDictionaryCoverageError,
  resolveBlankTokenId
} from '../pronunciation'

describe('pronunciation GOP assessment', () => {
  it('resolves the CTC blank token for CMU and eSpeak vocabularies', () => {
    expect(resolveBlankTokenId({ '[PAD]': 41, '[SIL]': 0, AA: 1 })).toBe(41)
    expect(resolveBlankTokenId({ '<pad>': 0, AA: 1 })).toBe(0)
    expect(resolveBlankTokenId({ AA: 1 })).toBe(0)
    expect(resolveBlankTokenId({ '[PAD]': -1 })).toBe(0)
  })

  it('runs forced alignment against the pinned CMU-phone vocabulary layout', () => {
    const vocabulary = cmuTokenizerVocabulary()
    const dominant = ['[SIL]', 'B', '[SIL]', 'UH', '[SIL]', 'K', '[SIL]', 'S', '[SIL]']

    const result = assessCtcPronunciation({
      logits: syntheticLogits(dominant, vocabulary),
      frameCount: dominant.length,
      vocabularySize: Object.keys(vocabulary).length,
      vocabulary,
      referenceText: 'books',
      durationMs: 900,
      blankTokenId: resolveBlankTokenId(vocabulary)
    })

    expect(resolveBlankTokenId(vocabulary)).toBe(41)
    expect(result.acoustic_phone_inventory).toContain('uppercase ARPAbet')
    expect(result.recognized_phones).toEqual(['B', 'UH', 'K', 'S'])
  })

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

  it('skips dictionary-missing words from alignment and records them', () => {
    const vocabulary = pronunciationVocabulary('ipa')
    const dominant = ['<pad>', 'TH', '<pad>', 'R', '<pad>', 'IY', '<pad>']

    const result = assessCtcPronunciation({
      logits: syntheticLogits(dominant, vocabulary),
      frameCount: dominant.length,
      vocabularySize: Object.keys(vocabulary).length,
      vocabulary,
      referenceText: 'overweigh three',
      durationMs: 700
    })

    expect(result.uncovered_words).toEqual(['overweigh'])
    expect(result.reference_text).toBe('three')
    expect(result.words.map((word) => word.text)).toEqual(['three'])
  })

  it('throws a parseable marker error when no word is coverable', () => {
    const caught = captureError(() => createPronunciationReferences('overweigh flumberz'))
    expect(parseNoDictionaryCoverageError(caught)).toEqual({ words: ['overweigh', 'flumberz'] })
    expect(parseNoDictionaryCoverageError(new Error(noDictionaryCoverageError(['x']).message))).toEqual(
      { words: ['x'] }
    )
    expect(parseNoDictionaryCoverageError(new Error('普通模型错误'))).toBeNull()
    expect(parseNoDictionaryCoverageError(undefined)).toBeNull()
  })

  it('reports zero coverage with no words when the transcript has no English words', () => {
    const caught = captureError(() => createPronunciationReferences('123 456'))
    expect(parseNoDictionaryCoverageError(caught)).toEqual({ words: [] })
  })

  it('derives pronunciations for -es, -ed and -ing non-words', () => {
    const [slushed] = createPronunciationReferences('slushed')
    const [slushes] = createPronunciationReferences('slushes')
    const [schoolrooming] = createPronunciationReferences('schoolrooming')

    expect(slushed.words[0].phones).toEqual(['S', 'L', 'AH', 'SH', 'T'])
    expect(slushes.words[0].phones).toEqual(['S', 'L', 'AH', 'SH', 'IH', 'Z'])
    expect(schoolrooming.words[0].phones.slice(-2)).toEqual(['IH', 'NG'])
  })
})

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('expected action to throw')
}

function pronunciationVocabulary(mode: 'cmu' | 'ipa'): Record<string, number> {
  const tokens = Object.entries(CMU_PHONE_TO_IPA).map(([cmu, ipa]) => (mode === 'cmu' ? cmu : ipa))
  return Object.fromEntries(['<pad>', ...tokens].map((token, index) => [token, index]))
}

// charsiu/tokenizer_en_cmu 的真实标签顺序（39 个无重音 CMU 音素 + [SIL]/[UNK]/[PAD]）。
function cmuTokenizerVocabulary(): Record<string, number> {
  const tokens = [
    '[SIL]', 'NG', 'F', 'M', 'AE', 'R', 'UW', 'N', 'IY', 'AW', 'V', 'UH', 'OW', 'AA', 'ER',
    'HH', 'Z', 'K', 'CH', 'W', 'EY', 'ZH', 'T', 'EH', 'Y', 'AH', 'B', 'P', 'TH', 'DH', 'AO',
    'G', 'L', 'JH', 'OY', 'SH', 'D', 'AY', 'S', 'IH', '[UNK]', '[PAD]'
  ]
  return Object.fromEntries(tokens.map((token, index) => [token, index]))
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
