import { dictionary } from 'cmu-pronouncing-dictionary'

const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY
const MAX_REFERENCE_CANDIDATES = 32
const ALIGNMENT_REFERENCE_CANDIDATES = 8
const ISSUE_SCORE_THRESHOLD = 40
const ISSUE_CONFIDENCE_THRESHOLD = 0.35

export interface PronunciationReferenceWord {
  text: string
  phones: string[]
}

export interface PronunciationReference {
  text: string
  words: PronunciationReferenceWord[]
  phones: string[]
}

export interface PronunciationPhoneAssessment {
  expected: string
  observed?: string
  score: number
  confidence: number
  startMs: number
  endMs: number
}

export interface PronunciationWordAssessment {
  text: string
  expectedPhones: string[]
  score: number
  startMs: number
  endMs: number
  phones: PronunciationPhoneAssessment[]
}

export interface PronunciationPauseAssessment {
  afterWordIndex: number
  durationMs: number
  startMs: number
  endMs: number
}

export interface PronunciationAssessmentResult {
  referenceText: string
  recognizedPhones: string[]
  overallScore: number
  words: PronunciationWordAssessment[]
  pauses: PronunciationPauseAssessment[]
  feedbackMarkdown: string
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
  phones: PronunciationPhoneAssessment[]
}

const ARPABET_TO_IPA: Readonly<Record<string, string>> = {
  AA: 'ɑː',
  AE: 'æ',
  AH0: 'ə',
  AH1: 'ʌ',
  AH2: 'ʌ',
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
  IY0: 'i',
  IY1: 'iː',
  IY2: 'iː',
  UW0: 'u',
  UW1: 'uː',
  UW2: 'uː'
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
  return candidates.map((words) => ({
    text: normalizedText,
    words,
    phones: words.flatMap((word) => word.phones)
  }))
}

export function assessCtcPronunciation(
  input: CtcPronunciationInput
): PronunciationAssessmentResult {
  validateCtcInput(input)
  const blankTokenId = input.blankTokenId ?? 0
  const tokenById = invertVocabulary(input.vocabulary, input.vocabularySize)
  const recognizedPhones = greedyDecode(
    input.logits,
    input.frameCount,
    input.vocabularySize,
    tokenById,
    blankTokenId
  )
  const evidenceReference = createEvidenceSelectedReference(input.referenceText, recognizedPhones)
  const references = [evidenceReference, ...createPronunciationReferences(input.referenceText)]
    .map((reference) => ({
      reference,
      distance: phoneEditDistance(reference.phones, recognizedPhones)
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, ALIGNMENT_REFERENCE_CANDIDATES)
    .map((candidate) => candidate.reference)
  let best: CandidateAssessment | undefined

  for (const reference of references) {
    const tokenIds = reference.phones.map((phone) => {
      const tokenId = input.vocabulary[phone]
      if (!Number.isSafeInteger(tokenId)) {
        throw new Error(`音素模型词表不包含“${phone}”`)
      }
      return tokenId
    })
    if (tokenIds.length > input.frameCount) continue
    const alignment = alignCtc(
      input.logits,
      input.frameCount,
      input.vocabularySize,
      tokenIds,
      blankTokenId
    )
    if (!alignment) continue
    const phones = assessAlignedPhones(
      input.logits,
      input.frameCount,
      input.vocabularySize,
      reference.phones,
      tokenIds,
      alignment.spans,
      tokenById,
      blankTokenId,
      input.durationMs
    )
    if (!best || alignment.pathScore > best.alignment.pathScore) {
      best = { reference, alignment, phones }
    }
  }
  if (!best) throw new Error('录音帧数不足以对齐参考文本')

  const words = groupPhonesByWord(best.reference, best.phones)
  const pauses = findInternalPauses(
    best.alignment.states,
    best.reference,
    input.frameCount,
    input.durationMs
  )
  const overallScore = roundedAverage(best.phones.map((phone) => phone.score))
  const result: PronunciationAssessmentResult = {
    referenceText: best.reference.text,
    recognizedPhones,
    overallScore,
    words,
    pauses,
    feedbackMarkdown: ''
  }
  result.feedbackMarkdown = formatPronunciationFeedback(result)
  return result
}

export function formatPronunciationFeedback(result: PronunciationAssessmentResult): string {
  const issues = result.words.flatMap((word) =>
    word.phones
      .filter(
        (phone) =>
          phone.score < ISSUE_SCORE_THRESHOLD && phone.confidence >= ISSUE_CONFIDENCE_THRESHOLD
      )
      .map((phone) => ({ word, phone }))
  )
  const lines = [`**发音评测（实验性）**：整体音素匹配度 ${result.overallScore}/100。`, '']
  if (issues.length === 0) {
    lines.push('未发现高置信度的单音素错误。')
  } else {
    lines.push('需要重点复听的发音：')
    for (const { word, phone } of issues.slice(0, 8)) {
      const observed = phone.observed ? `，声学上更接近 /${phone.observed}/` : ''
      lines.push(
        `- \`${word.text}\` 中的 /${phone.expected}/ 匹配度 ${phone.score}/100${observed}。${articulationTip(phone.expected, phone.observed)}`
      )
    }
  }
  const longPauses = result.pauses.filter((pause) => pause.durationMs >= 600)
  if (longPauses.length > 0) {
    lines.push('', '流利度：')
    for (const pause of longPauses.slice(0, 4)) {
      const word = result.words[pause.afterWordIndex]
      lines.push(
        `- \`${word?.text ?? '句中'}\` 后停顿约 ${(pause.durationMs / 1000).toFixed(1)} 秒。`
      )
    }
  }
  lines.push(
    '',
    `模型自由识别音素：/${result.recognizedPhones.join(' ') || '无'}/`,
    '',
    '> 该结果来自声学模型和强制对齐；低置信度偏差已被过滤，仍应结合录音复听。'
  )
  return lines.join('\n')
}

function dictionaryPronunciations(word: string): string[][] {
  const values = rawDictionaryPronunciations(word)
  if (values.length === 0 && word.endsWith('y')) {
    const baseValues = rawDictionaryPronunciations(word.slice(0, -1))
    for (const value of baseValues) values.push(`${value} IY0`)
  }
  if (values.length === 0 && word.endsWith("'s")) {
    const baseValues = rawDictionaryPronunciations(word.slice(0, -2))
    for (const value of baseValues) values.push(`${value} Z`)
  }
  if (values.length === 0 && word.endsWith('s')) {
    const baseValues = rawDictionaryPronunciations(word.slice(0, -1))
    for (const value of baseValues) values.push(`${value} ${pluralSuffix(value)}`)
  }
  return ipaPronunciationVariants(values)
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
      return variants.map((phones) => ({ text: surfaceWord, phones }))
    })
  }
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
  return { text: normalizedText, words, phones: words.flatMap((word) => word.phones) }
}

function pluralSuffix(pronunciation: string): string {
  const finalPhone = pronunciation
    .trim()
    .split(/\s+/)
    .at(-1)
    ?.replace(/[012]$/, '')
  if (finalPhone && ['S', 'Z', 'SH', 'ZH', 'CH', 'JH'].includes(finalPhone)) return 'IH0 Z'
  if (finalPhone && ['P', 'T', 'K', 'F', 'TH'].includes(finalPhone)) return 'S'
  return 'Z'
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

function ipaPronunciationVariants(values: readonly string[]): string[][] {
  const unique = new Map<string, string[]>()
  for (const value of values) {
    const phones = value.split(/\s+/).map(arpabetPhoneToIpa)
    unique.set(phones.join(' '), phones)
  }
  return [...unique.values()]
}

function arpabetPhoneToIpa(phone: string): string {
  const stressSensitive = STRESS_SENSITIVE_ARPABET_TO_IPA[phone]
  if (stressSensitive) return stressSensitive
  const exact = ARPABET_TO_IPA[phone]
  if (exact) return exact
  const withoutStress = phone.replace(/[012]$/, '')
  const mapped = ARPABET_TO_IPA[withoutStress]
  if (!mapped) throw new Error(`不支持的 ARPAbet 音素：${phone}`)
  return mapped
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
}

function invertVocabulary(
  vocabulary: Readonly<Record<string, number>>,
  vocabularySize: number
): string[] {
  const result = Array<string>(vocabularySize).fill('')
  for (const [token, id] of Object.entries(vocabulary)) {
    if (Number.isSafeInteger(id) && id >= 0 && id < vocabularySize) result[id] = token
  }
  return result
}

function alignCtc(
  logits: Float32Array,
  frameCount: number,
  vocabularySize: number,
  tokenIds: readonly number[],
  blankTokenId: number
): CtcAlignment | null {
  const stateCount = tokenIds.length * 2 + 1
  const backPointers = new Int32Array(frameCount * stateCount).fill(-1)
  let previous = new Float64Array(stateCount).fill(NEGATIVE_INFINITY)
  previous[0] = logProbability(logits, 0, blankTokenId, vocabularySize)
  if (tokenIds.length > 0) {
    previous[1] = logProbability(logits, 0, tokenIds[0], vocabularySize)
  }

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
      current[state] = bestScore + logProbability(logits, frame, tokenId, vocabularySize)
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
  logits: Float32Array,
  frameCount: number,
  vocabularySize: number,
  expectedPhones: readonly string[],
  tokenIds: readonly number[],
  spans: readonly { startFrame: number; endFrame: number }[],
  tokenById: readonly string[],
  blankTokenId: number,
  durationMs: number
): PronunciationPhoneAssessment[] {
  const frameDurationMs = durationMs / frameCount
  return spans.map((span, index) => {
    const expectedId = tokenIds[index]
    const meanLogits = new Float64Array(vocabularySize)
    const frames = span.endFrame - span.startFrame
    for (let frame = span.startFrame; frame < span.endFrame; frame += 1) {
      const offset = frame * vocabularySize
      for (let tokenId = 0; tokenId < vocabularySize; tokenId += 1) {
        meanLogits[tokenId] += logits[offset + tokenId]
      }
    }
    let observedId = expectedId
    let observedLogit = NEGATIVE_INFINITY
    for (let tokenId = 0; tokenId < vocabularySize; tokenId += 1) {
      if (tokenId === blankTokenId || tokenId === expectedId || !tokenById[tokenId]) continue
      const value = meanLogits[tokenId] / frames
      if (value > observedLogit) {
        observedLogit = value
        observedId = tokenId
      }
    }
    const expectedLogit = meanLogits[expectedId] / frames
    const margin = expectedLogit - observedLogit
    const score = Math.round(sigmoid(margin) * 100)
    const confidence = round(Math.min(1, Math.abs(margin) / 4), 3)
    return {
      expected: expectedPhones[index],
      ...(observedId !== expectedId && margin < 0 ? { observed: tokenById[observedId] } : {}),
      score,
      confidence,
      startMs: Math.round(span.startFrame * frameDurationMs),
      endMs: Math.round(span.endFrame * frameDurationMs)
    }
  })
}

function groupPhonesByWord(
  reference: PronunciationReference,
  phones: readonly PronunciationPhoneAssessment[]
): PronunciationWordAssessment[] {
  let offset = 0
  return reference.words.map((word) => {
    const wordPhones = phones.slice(offset, offset + word.phones.length)
    offset += word.phones.length
    return {
      text: word.text,
      expectedPhones: [...word.phones],
      score: roundedAverage(wordPhones.map((phone) => phone.score)),
      startMs: wordPhones[0]?.startMs ?? 0,
      endMs: wordPhones.at(-1)?.endMs ?? 0,
      phones: wordPhones
    }
  })
}

function findInternalPauses(
  states: Int32Array,
  reference: PronunciationReference,
  frameCount: number,
  durationMs: number
): PronunciationPauseAssessment[] {
  const phoneToWord: number[] = []
  reference.words.forEach((word, wordIndex) => {
    for (let index = 0; index < word.phones.length; index += 1) phoneToWord.push(wordIndex)
  })
  const frameDurationMs = durationMs / frameCount
  const pauses: PronunciationPauseAssessment[] = []
  let start = -1
  for (let frame = 0; frame <= states.length; frame += 1) {
    const isBlank = frame < states.length && states[frame] % 2 === 0
    if (isBlank && start < 0) start = frame
    if (isBlank || start < 0) continue
    const end = frame
    const previousState = start > 0 ? states[start - 1] : -1
    const nextState = frame < states.length ? states[frame] : -1
    if (previousState % 2 === 1 && nextState % 2 === 1) {
      const previousPhoneIndex = (previousState - 1) / 2
      const nextPhoneIndex = (nextState - 1) / 2
      const afterWordIndex = phoneToWord[previousPhoneIndex]
      if (
        Number.isSafeInteger(afterWordIndex) &&
        phoneToWord[nextPhoneIndex] !== undefined &&
        end - start >= 2
      ) {
        pauses.push({
          afterWordIndex,
          durationMs: Math.round((end - start) * frameDurationMs),
          startMs: Math.round(start * frameDurationMs),
          endMs: Math.round(end * frameDurationMs)
        })
      }
    }
    start = -1
  }
  return pauses
}

function greedyDecode(
  logits: Float32Array,
  frameCount: number,
  vocabularySize: number,
  tokenById: readonly string[],
  blankTokenId: number
): string[] {
  const result: string[] = []
  let previous = -1
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * vocabularySize
    let bestId = 0
    let bestValue = NEGATIVE_INFINITY
    for (let tokenId = 0; tokenId < vocabularySize; tokenId += 1) {
      if (logits[offset + tokenId] > bestValue) {
        bestValue = logits[offset + tokenId]
        bestId = tokenId
      }
    }
    if (bestId !== previous && bestId !== blankTokenId && tokenById[bestId]) {
      const token = tokenById[bestId]
      if (!token.startsWith('<')) result.push(token)
    }
    previous = bestId
  }
  return result
}

function logProbability(
  logits: Float32Array,
  frame: number,
  tokenId: number,
  vocabularySize: number
): number {
  const offset = frame * vocabularySize
  let maximum = NEGATIVE_INFINITY
  for (let index = 0; index < vocabularySize; index += 1) {
    maximum = Math.max(maximum, logits[offset + index])
  }
  let sum = 0
  for (let index = 0; index < vocabularySize; index += 1) {
    sum += Math.exp(logits[offset + index] - maximum)
  }
  return logits[offset + tokenId] - maximum - Math.log(sum)
}

function articulationTip(expected: string, observed?: string): string {
  const key = `${expected}>${observed ?? ''}`
  const confusionTips: Readonly<Record<string, string>> = {
    'θ>s': '建议舌尖轻触上下齿之间送气，不要只从齿缝送气。',
    'ð>d': '建议保持舌尖轻触齿间并持续振动，避免变成短促的 /d/。',
    'ɹ>l': '建议舌尖不触上齿龈，舌身稍向后收。',
    'l>ɹ': '建议让舌尖触及上齿龈，不要向后卷舌。',
    'v>w': '建议上齿轻触下唇送气，不要圆唇起音。',
    'w>v': '建议先圆唇再快速展开，上齿不要碰下唇。'
  }
  const genericTips: Readonly<Record<string, string>> = {
    θ: '建议舌尖轻放于上下齿之间持续送气。',
    ð: '建议舌尖轻放于齿间，同时保持声带振动。',
    ɹ: '建议舌身稍向后收，舌尖不触上齿龈。',
    v: '建议上齿轻触下唇并持续送气。',
    ŋ: '建议舌根抬起贴近软腭，不要在词尾额外加 /g/。'
  }
  return confusionTips[key] ?? genericTips[expected] ?? '建议对照标准录音慢速跟读并复听。'
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

function roundedAverage(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}
