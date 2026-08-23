import { dictionary } from 'cmu-pronouncing-dictionary'

const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY
const MAX_REFERENCE_CANDIDATES = 32
const ALIGNMENT_REFERENCE_CANDIDATES = 8

export const CMU_PHONE_TO_IPA: Readonly<Record<string, string>> = {
  AA: 'ɑː',
  AE: 'æ',
  AH: 'ʌ',
  AO: 'ɔː',
  AW: 'aʊ',
  AY: 'aɪ',
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  EH: 'ɛ',
  ER: 'ɚ',
  EY: 'eɪ',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  IH: 'ɪ',
  IY: 'iː',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  OW: 'oʊ',
  OY: 'ɔɪ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  UH: 'ʊ',
  UW: 'uː',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ'
}

const STRESS_SENSITIVE_ARPABET_TO_IPA: Readonly<Record<string, string>> = {
  AH0: 'ə',
  AH1: 'ʌ',
  AH2: 'ʌ',
  IY0: 'i',
  IY1: 'iː',
  IY2: 'iː',
  UW0: 'u',
  UW1: 'uː',
  UW2: 'uː'
}

export interface PronunciationReferenceWord {
  text: string
  phones: string[]
  ipaPhones: string[]
}

export interface PronunciationReference {
  text: string
  words: PronunciationReferenceWord[]
  phones: string[]
  ipaPhones: string[]
}

export interface PronunciationPhoneAssessment {
  index: number
  word_index: number
  phone_index: number
  word: string
  expected: string
  expected_ipa: string
  acoustic_winner: string
  acoustic_winner_ipa: string
  best_alternative: string
  best_alternative_ipa: string
  expected_log_p: number
  alternative_log_p: number
  gop_log_ratio: number
  confidence: number
  start_ms: number
  end_ms: number
}

export interface PronunciationWordAssessment {
  word_index: number
  text: string
  expected_arpabet: string[]
  expected_ipa: string[]
  start_ms: number
  end_ms: number
  phones: PronunciationPhoneAssessment[]
}

export interface PronunciationAssessmentResult {
  schema_version: 2
  reference_text: string
  audio_duration_ms: number
  frame_count: number
  recognized_phones: string[]
  recognized_phones_ipa: string[]
  gop_method: 'viterbi'
  alignment_path_score: number
  acoustic_model: string
  acoustic_phone_inventory: string
  reference_source: string
  dictionary_source: string
  phones: PronunciationPhoneAssessment[]
  words: PronunciationWordAssessment[]
}

export interface CtcPronunciationInput {
  logits: Float32Array
  frameCount: number
  vocabularySize: number
  vocabulary: Readonly<Record<string, number>>
  referenceText: string
  durationMs: number
  blankTokenId?: number
}

interface CtcAlignment {
  pathScore: number
  states: Int32Array
  spans: Array<{ startFrame: number; endFrame: number }>
}

interface CandidateAssessment {
  reference: PronunciationReference
  alignment: CtcAlignment
}

interface AcousticPhoneToken {
  cmu: string
  token: string
  tokenId: number
}

interface AcousticPhoneInventory {
  description: string
  phones: AcousticPhoneToken[]
  byCmu: ReadonlyMap<string, AcousticPhoneToken>
  byTokenId: ReadonlyMap<number, AcousticPhoneToken>
}

interface AlignedPhoneEvidence {
  expected: string
  expected_ipa: string
  acoustic_winner: string
  acoustic_winner_ipa: string
  best_alternative: string
  best_alternative_ipa: string
  expected_log_p: number
  alternative_log_p: number
  gop_log_ratio: number
  confidence: number
  start_ms: number
  end_ms: number
}

export function createPronunciationReferences(
  referenceText: string,
  maxCandidates = MAX_REFERENCE_CANDIDATES
): PronunciationReference[] {
  if (typeof referenceText !== 'string' || !referenceText.trim()) {
    throw new Error('参考文本不能为空')
  }
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates <= 0) {
    throw new Error('发音候选数量无效')
  }
  const { normalizedText, variantsByWord } = referenceWordVariants(referenceText)

  let candidates: PronunciationReferenceWord[][] = [[]]
  for (const variants of variantsByWord) {
    const next: PronunciationReferenceWord[][] = []
    for (const candidate of candidates) {
      for (const variant of variants) {
        next.push([...candidate, variant])
        if (next.length >= maxCandidates) break
      }
      if (next.length >= maxCandidates) break
    }
    candidates = next
  }
  return candidates.map((words) => referenceFromWords(normalizedText, words))
}

export function assessCtcPronunciation(
  input: CtcPronunciationInput
): PronunciationAssessmentResult {
  validateCtcInput(input)
  const blankTokenId = input.blankTokenId ?? 0
  const inventory = resolveAcousticPhoneInventory(
    input.vocabulary,
    input.vocabularySize,
    blankTokenId
  )
  const recognizedPhones = greedyDecode(
    input.logits,
    input.frameCount,
    input.vocabularySize,
    inventory,
    blankTokenId
  )
  const evidenceReference = createEvidenceSelectedReference(input.referenceText, recognizedPhones)
  const references = [evidenceReference, ...createPronunciationReferences(input.referenceText)]
    .filter(
      (reference, index, values) =>
        values.findIndex((candidate) => samePhones(candidate.phones, reference.phones)) === index
    )
    .map((reference) => ({
      reference,
      distance: phoneEditDistance(reference.phones, recognizedPhones)
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, ALIGNMENT_REFERENCE_CANDIDATES)
    .map((candidate) => candidate.reference)
  const logProbabilities = computeLogProbabilities(
    input.logits,
    input.frameCount,
    input.vocabularySize
  )
  let best: CandidateAssessment | undefined

  for (const reference of references) {
    const tokenIds = reference.phones.map((phone) => {
      const tokenId = inventory.byCmu.get(phone)?.tokenId
      if (!Number.isSafeInteger(tokenId)) {
        throw new Error(`音素模型词表不包含 CMU 音素“${phone}”`)
      }
      return tokenId
    })
    if (tokenIds.length > input.frameCount) continue
    const alignment = alignCtc(
      logProbabilities,
      input.frameCount,
      input.vocabularySize,
      tokenIds,
      blankTokenId
    )
    if (!alignment) continue
    if (!best || alignment.pathScore > best.alignment.pathScore) {
      best = { reference, alignment }
    }
  }
  if (!best) throw new Error('录音帧数不足以对齐参考文本')

  const alignedPhones = assessAlignedPhones(
    logProbabilities,
    input.frameCount,
    input.vocabularySize,
    best.reference.phones,
    best.alignment.spans,
    inventory,
    input.durationMs
  )
  const { phones, words } = groupPhonesByWord(best.reference, alignedPhones)
  return {
    schema_version: 2,
    reference_text: best.reference.text,
    audio_duration_ms: Math.round(input.durationMs),
    frame_count: input.frameCount,
    recognized_phones: recognizedPhones,
    recognized_phones_ipa: recognizedPhones.map(cmuPhoneToIpa),
    gop_method: 'viterbi',
    alignment_path_score: round(best.alignment.pathScore, 6),
    acoustic_model: 'facebook/wav2vec2-lv-60-espeak-cv-ft ONNX INT8',
    acoustic_phone_inventory: inventory.description,
    reference_source: 'CMUdict; selected legal variant using acoustic evidence',
    dictionary_source: 'cmu-pronouncing-dictionary',
    phones,
    words
  }
}

function referenceWordVariants(referenceText: string): {
  normalizedText: string
  variantsByWord: PronunciationReferenceWord[][]
} {
  const normalizedText = referenceText.normalize('NFKC').replace(/[‘’]/g, "'")
  const surfaceWords = normalizedText.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) ?? []
  if (surfaceWords.length === 0) throw new Error('参考文本中没有可评测的英文单词')
  return {
    normalizedText,
    variantsByWord: surfaceWords.map((surfaceWord) => {
      const variants = dictionaryPronunciations(surfaceWord.toLowerCase())
      if (variants.length === 0) throw new Error(`CMUdict 中没有单词“${surfaceWord}”`)
      return variants.map((variant) => ({ text: surfaceWord, ...variant }))
    })
  }
}

function dictionaryPronunciations(word: string): Array<{ phones: string[]; ipaPhones: string[] }> {
  const values = rawDictionaryPronunciations(word)
  if (values.length === 0 && word.endsWith('y')) {
    for (const value of rawDictionaryPronunciations(word.slice(0, -1))) values.push(`${value} IY0`)
  }
  if (values.length === 0 && word.endsWith("'s")) {
    for (const value of rawDictionaryPronunciations(word.slice(0, -2))) values.push(`${value} Z`)
  }
  if (values.length === 0 && word.endsWith('s')) {
    for (const value of rawDictionaryPronunciations(word.slice(0, -1))) {
      values.push(`${value} ${pluralSuffix(value)}`)
    }
  }

  const unique = new Map<string, { phones: string[]; ipaPhones: string[] }>()
  for (const value of values) {
    const rawPhones = value.trim().split(/\s+/)
    const phones = rawPhones.map(stripStress)
    const key = phones.join(' ')
    if (!key || unique.has(key)) continue
    unique.set(key, { phones, ipaPhones: rawPhones.map(arpabetPhoneToIpa) })
  }
  return [...unique.values()]
}

function createEvidenceSelectedReference(
  referenceText: string,
  recognizedPhones: readonly string[]
): PronunciationReference {
  const { normalizedText, variantsByWord } = referenceWordVariants(referenceText)
  const primaryWords = variantsByWord.map((variants) => variants[0])
  const primaryPhones = primaryWords.flatMap((word) => word.phones)
  const observedByExpected = alignPhoneSequences(primaryPhones, recognizedPhones)
  let phoneOffset = 0
  const words = variantsByWord.map((variants) => {
    const primaryLength = variants[0].phones.length
    const observedIndexes = observedByExpected
      .slice(phoneOffset, phoneOffset + primaryLength)
      .flat()
      .sort((left, right) => left - right)
    phoneOffset += primaryLength
    if (observedIndexes.length === 0) return variants[0]
    const observed = recognizedPhones.slice(observedIndexes[0], observedIndexes.at(-1)! + 1)
    return variants.reduce((best, variant) =>
      phoneEditDistance(variant.phones, observed) < phoneEditDistance(best.phones, observed)
        ? variant
        : best
    )
  })
  return referenceFromWords(normalizedText, words)
}

function referenceFromWords(
  text: string,
  words: readonly PronunciationReferenceWord[]
): PronunciationReference {
  return {
    text,
    words: words.map((word) => ({
      text: word.text,
      phones: [...word.phones],
      ipaPhones: [...word.ipaPhones]
    })),
    phones: words.flatMap((word) => word.phones),
    ipaPhones: words.flatMap((word) => word.ipaPhones)
  }
}

function rawDictionaryPronunciations(word: string): string[] {
  const values: string[] = []
  const primary = dictionary[word]
  if (primary) values.push(primary)
  for (let index = 1; index <= 20; index += 1) {
    const value = dictionary[`${word}(${index})`]
    if (value) values.push(value)
  }
  return values
}

function pluralSuffix(pronunciation: string): string {
  const finalPhone = pronunciation.trim().split(/\s+/).at(-1)
  const final = finalPhone ? stripStress(finalPhone) : ''
  if (['S', 'Z', 'SH', 'ZH', 'CH', 'JH'].includes(final)) return 'IH0 Z'
  if (['P', 'T', 'K', 'F', 'TH'].includes(final)) return 'S'
  return 'Z'
}

function stripStress(phone: string): string {
  return phone.toUpperCase().replace(/[012]$/, '')
}

function arpabetPhoneToIpa(phone: string): string {
  const stressSensitive = STRESS_SENSITIVE_ARPABET_TO_IPA[phone.toUpperCase()]
  return stressSensitive ?? cmuPhoneToIpa(stripStress(phone))
}

function cmuPhoneToIpa(phone: string): string {
  const ipa = CMU_PHONE_TO_IPA[phone]
  if (!ipa) throw new Error(`不支持的 CMU 音素：${phone}`)
  return ipa
}

function resolveAcousticPhoneInventory(
  vocabulary: Readonly<Record<string, number>>,
  vocabularySize: number,
  blankTokenId: number
): AcousticPhoneInventory {
  const cmuPhones = Object.keys(CMU_PHONE_TO_IPA)
  const modes: Array<{ description: string; token(phone: string): string }> = [
    { description: '39 CMU phones from uppercase ARPAbet model tokens', token: (phone) => phone },
    {
      description: '39 CMU phones from lowercase ARPAbet model tokens',
      token: (phone) => phone.toLowerCase()
    },
    {
      description: '39 CMU phones mapped one-to-one to canonical IPA model tokens',
      token: cmuPhoneToIpa
    }
  ]

  for (const mode of modes) {
    const phones = cmuPhones.map((cmu) => ({
      cmu,
      token: mode.token(cmu),
      tokenId: vocabulary[mode.token(cmu)]
    }))
    if (
      phones.every(
        ({ tokenId }) =>
          Number.isSafeInteger(tokenId) &&
          tokenId >= 0 &&
          tokenId < vocabularySize &&
          tokenId !== blankTokenId
      ) &&
      new Set(phones.map(({ tokenId }) => tokenId)).size === cmuPhones.length
    ) {
      return {
        description: mode.description,
        phones,
        byCmu: new Map(phones.map((phone) => [phone.cmu, phone])),
        byTokenId: new Map(phones.map((phone) => [phone.tokenId, phone]))
      }
    }
  }
  throw new Error('音素模型词表不能提供与 39 个 CMU 音素一一对应的声学 token')
}

function validateCtcInput(input: CtcPronunciationInput): void {
  if (!(input.logits instanceof Float32Array)) throw new Error('音素 logits 必须是 Float32Array')
  if (!Number.isSafeInteger(input.frameCount) || input.frameCount <= 0) {
    throw new Error('音素帧数无效')
  }
  if (!Number.isSafeInteger(input.vocabularySize) || input.vocabularySize <= 1) {
    throw new Error('音素词表大小无效')
  }
  if (input.logits.length !== input.frameCount * input.vocabularySize) {
    throw new Error('音素 logits 尺寸与帧数不匹配')
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    throw new Error('录音时长无效')
  }
  const blankTokenId = input.blankTokenId ?? 0
  if (
    !Number.isSafeInteger(blankTokenId) ||
    blankTokenId < 0 ||
    blankTokenId >= input.vocabularySize
  ) {
    throw new Error('CTC 空白 token 无效')
  }
  for (const value of input.logits) {
    if (!Number.isFinite(value)) throw new Error('音素 logits 必须是有限数值')
  }
}

function computeLogProbabilities(
  logits: Float32Array,
  frameCount: number,
  vocabularySize: number
): Float64Array {
  const result = new Float64Array(logits.length)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * vocabularySize
    let maximum = NEGATIVE_INFINITY
    for (let tokenId = 0; tokenId < vocabularySize; tokenId += 1) {
      maximum = Math.max(maximum, logits[offset + tokenId])
    }
    let sum = 0
    for (let tokenId = 0; tokenId < vocabularySize; tokenId += 1) {
      sum += Math.exp(logits[offset + tokenId] - maximum)
    }
    const normalization = maximum + Math.log(sum)
    for (let tokenId = 0; tokenId < vocabularySize; tokenId += 1) {
      result[offset + tokenId] = logits[offset + tokenId] - normalization
    }
  }
  return result
}

function alignCtc(
  logProbabilities: Float64Array,
  frameCount: number,
  vocabularySize: number,
  tokenIds: readonly number[],
  blankTokenId: number
): CtcAlignment | null {
  const stateCount = tokenIds.length * 2 + 1
  const backPointers = new Int32Array(frameCount * stateCount).fill(-1)
  let previous = new Float64Array(stateCount).fill(NEGATIVE_INFINITY)
  previous[0] = logProbabilities[blankTokenId]
  if (tokenIds.length > 0) previous[1] = logProbabilities[tokenIds[0]]

  for (let frame = 1; frame < frameCount; frame += 1) {
    const current = new Float64Array(stateCount).fill(NEGATIVE_INFINITY)
    for (let state = 0; state < stateCount; state += 1) {
      let bestState = state
      let bestScore = previous[state]
      if (state > 0 && previous[state - 1] > bestScore) {
        bestState = state - 1
        bestScore = previous[state - 1]
      }
      if (
        state > 1 &&
        state % 2 === 1 &&
        tokenIds[(state - 1) / 2] !== tokenIds[(state - 3) / 2] &&
        previous[state - 2] > bestScore
      ) {
        bestState = state - 2
        bestScore = previous[state - 2]
      }
      if (bestScore === NEGATIVE_INFINITY) continue
      const tokenId = state % 2 === 0 ? blankTokenId : tokenIds[(state - 1) / 2]
      current[state] = bestScore + logProbabilities[frame * vocabularySize + tokenId]
      backPointers[frame * stateCount + state] = bestState
    }
    previous = current
  }

  let state = stateCount - 1
  if (stateCount > 1 && previous[stateCount - 2] > previous[state]) state = stateCount - 2
  const finalScore = previous[state]
  if (finalScore === NEGATIVE_INFINITY) return null
  const states = new Int32Array(frameCount)
  states[frameCount - 1] = state
  for (let frame = frameCount - 1; frame > 0; frame -= 1) {
    state = backPointers[frame * stateCount + state]
    if (state < 0) return null
    states[frame - 1] = state
  }

  const spans = tokenIds.map((_, tokenIndex) => {
    const targetState = tokenIndex * 2 + 1
    let startFrame = -1
    let endFrame = -1
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (states[frame] !== targetState) continue
      if (startFrame < 0) startFrame = frame
      endFrame = frame + 1
    }
    return { startFrame, endFrame }
  })
  if (spans.some((span) => span.startFrame < 0 || span.endFrame <= span.startFrame)) return null
  return { pathScore: finalScore / frameCount, states, spans }
}

function assessAlignedPhones(
  logProbabilities: Float64Array,
  frameCount: number,
  vocabularySize: number,
  expectedPhones: readonly string[],
  spans: readonly { startFrame: number; endFrame: number }[],
  inventory: AcousticPhoneInventory,
  durationMs: number
): AlignedPhoneEvidence[] {
  const frameDurationMs = durationMs / frameCount
  return spans.map((span, index) => {
    const expected = expectedPhones[index]
    const expectedToken = inventory.byCmu.get(expected)
    if (!expectedToken) throw new Error(`音素模型词表不包含 CMU 音素“${expected}”`)
    const means = inventory.phones.map((phone) => {
      let total = 0
      for (let frame = span.startFrame; frame < span.endFrame; frame += 1) {
        total += logProbabilities[frame * vocabularySize + phone.tokenId]
      }
      return total / (span.endFrame - span.startFrame)
    })
    const expectedIndex = inventory.phones.findIndex((phone) => phone.cmu === expected)
    const alternativeIndexes = means
      .map((_, phoneIndex) => phoneIndex)
      .filter((phoneIndex) => phoneIndex !== expectedIndex)
    const acousticIndex = maxIndex(means)
    const alternativeIndex = alternativeIndexes.reduce((best, candidate) =>
      means[candidate] > means[best] ? candidate : best
    )
    const expectedLogP = means[expectedIndex]
    const alternativeLogP = means[alternativeIndex]
    const gop = expectedLogP - logSumExp(alternativeIndexes.map((phoneIndex) => means[phoneIndex]))
    const acousticWinner = inventory.phones[acousticIndex]
    const bestAlternative = inventory.phones[alternativeIndex]
    return {
      expected,
      expected_ipa: cmuPhoneToIpa(expected),
      acoustic_winner: acousticWinner.cmu,
      acoustic_winner_ipa: cmuPhoneToIpa(acousticWinner.cmu),
      best_alternative: bestAlternative.cmu,
      best_alternative_ipa: cmuPhoneToIpa(bestAlternative.cmu),
      expected_log_p: round(expectedLogP, 6),
      alternative_log_p: round(alternativeLogP, 6),
      gop_log_ratio: round(gop, 6),
      confidence: round(Math.min(1, Math.abs(gop) / 4), 3),
      start_ms: Math.round(span.startFrame * frameDurationMs),
      end_ms: Math.round(span.endFrame * frameDurationMs)
    }
  })
}

function groupPhonesByWord(
  reference: PronunciationReference,
  alignedPhones: readonly AlignedPhoneEvidence[]
): { phones: PronunciationPhoneAssessment[]; words: PronunciationWordAssessment[] } {
  const phones: PronunciationPhoneAssessment[] = []
  let offset = 0
  const words = reference.words.map((word, wordIndex) => {
    const wordPhones = alignedPhones
      .slice(offset, offset + word.phones.length)
      .map((phone, phoneIndex): PronunciationPhoneAssessment => {
        const row = {
          index: offset + phoneIndex,
          word_index: wordIndex,
          phone_index: phoneIndex,
          word: word.text,
          ...phone
        }
        phones.push(row)
        return row
      })
    offset += word.phones.length
    return {
      word_index: wordIndex,
      text: word.text,
      expected_arpabet: [...word.phones],
      expected_ipa: [...word.ipaPhones],
      start_ms: wordPhones[0]?.start_ms ?? 0,
      end_ms: wordPhones.at(-1)?.end_ms ?? 0,
      phones: wordPhones
    }
  })
  return { phones, words }
}

function greedyDecode(
  logits: Float32Array,
  frameCount: number,
  vocabularySize: number,
  inventory: AcousticPhoneInventory,
  blankTokenId: number
): string[] {
  const result: string[] = []
  let previous = -1
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * vocabularySize
    let bestId = blankTokenId
    let bestValue = logits[offset + blankTokenId]
    for (const phone of inventory.phones) {
      const value = logits[offset + phone.tokenId]
      if (value > bestValue) {
        bestId = phone.tokenId
        bestValue = value
      }
    }
    if (bestId !== previous && bestId !== blankTokenId) {
      const phone = inventory.byTokenId.get(bestId)
      if (phone) result.push(phone.cmu)
    }
    previous = bestId
  }
  return result
}

function phoneEditDistance(left: readonly string[], right: readonly string[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = new Array<number>(right.length + 1)
    current[0] = leftIndex + 1
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current[rightIndex + 1] = Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + Number(left[leftIndex] !== right[rightIndex])
      )
    }
    previous = current
  }
  return previous[right.length]
}

function alignPhoneSequences(expected: readonly string[], observed: readonly string[]): number[][] {
  const columns = observed.length + 1
  const scores = new Int32Array((expected.length + 1) * columns)
  const operations = new Uint8Array(scores.length)
  for (let expectedIndex = 0; expectedIndex <= expected.length; expectedIndex += 1) {
    scores[expectedIndex * columns] = expectedIndex
    if (expectedIndex > 0) operations[expectedIndex * columns] = 1
  }
  for (let observedIndex = 1; observedIndex <= observed.length; observedIndex += 1) {
    scores[observedIndex] = observedIndex
    operations[observedIndex] = 2
  }
  for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
    for (let observedIndex = 1; observedIndex <= observed.length; observedIndex += 1) {
      const offset = expectedIndex * columns + observedIndex
      const diagonal =
        scores[(expectedIndex - 1) * columns + observedIndex - 1] +
        Number(expected[expectedIndex - 1] !== observed[observedIndex - 1])
      const deletion = scores[(expectedIndex - 1) * columns + observedIndex] + 1
      const insertion = scores[expectedIndex * columns + observedIndex - 1] + 1
      if (diagonal <= deletion && diagonal <= insertion) {
        scores[offset] = diagonal
        operations[offset] = 0
      } else if (deletion <= insertion) {
        scores[offset] = deletion
        operations[offset] = 1
      } else {
        scores[offset] = insertion
        operations[offset] = 2
      }
    }
  }

  const observedByExpected = Array.from({ length: expected.length }, () => [] as number[])
  let expectedIndex = expected.length
  let observedIndex = observed.length
  while (expectedIndex > 0 || observedIndex > 0) {
    const operation = operations[expectedIndex * columns + observedIndex]
    if (operation === 0 && expectedIndex > 0 && observedIndex > 0) {
      observedByExpected[expectedIndex - 1].push(observedIndex - 1)
      expectedIndex -= 1
      observedIndex -= 1
    } else if (operation === 1 && expectedIndex > 0) {
      expectedIndex -= 1
    } else if (observedIndex > 0) {
      const attachment = Math.min(expected.length - 1, Math.max(0, expectedIndex - 1))
      observedByExpected[attachment]?.push(observedIndex - 1)
      observedIndex -= 1
    } else {
      break
    }
  }
  return observedByExpected
}

function maxIndex(values: readonly number[]): number {
  if (values.length === 0) throw new Error('声学音素候选为空')
  let best = 0
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[best]) best = index
  }
  return best
}

function logSumExp(values: readonly number[]): number {
  if (values.length === 0) return NEGATIVE_INFINITY
  const maximum = Math.max(...values)
  return maximum + Math.log(values.reduce((sum, value) => sum + Math.exp(value - maximum), 0))
}

function samePhones(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((phone, index) => phone === right[index])
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}
