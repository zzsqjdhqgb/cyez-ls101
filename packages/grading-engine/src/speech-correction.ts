import type { PronunciationAssessmentResult, PronunciationPhoneAssessment } from './pronunciation'
import type { TextGradingModel } from './index'

// 协议 `gop-llm-word-context-v4`（2026-08 发音实验最终设计 C，见
// HANDOFF-plain-text-correction.md 与 textpa/PRONUNCIATION_GOP_LLM_V4_PLAINTEXT.md）：
// 证据选择与 v3 冻结协议完全一致（阈值 <= -0.35、前后各 2 词上下文、schema 2）；
// 改动只在 LLM 阶段——模型直接输出保守的中文纯文本纠错说明，不再要求 JSON 合同、
// evidence_id 归档或逐字音素校验。实验中 v3 的 JSON 措辞在近乎满分的教师朗读上
// 断言了 likely_issue 并把评分模型带偏到 0.5/1；纯文本版保持 ②（buildAIGradingPrompt）
// 完全不变并得到 1/1。v4 的 ① 请求携带完整冻结证据 JSON（含完整 ASR 转写与扁平
// 证据行），与实验脚本 ai_eval3.mjs 逐字一致。
export const SPEECH_CORRECTION_SYSTEM_PROMPT = `You are an English pronunciation feedback writer working from CTC-GOP phone evidence.
You cannot hear the audio and may only describe what the supplied reference/observed phone evidence shows.
Write plain natural-language Chinese prose. Never output JSON, key-value pairs, tables, code blocks,
evidence IDs or any kind of score. Never claim a pronunciation error is confirmed.`

export const SPEECH_GOP_THRESHOLD = -0.35
export const SPEECH_WORD_CONTEXT_RADIUS = 2

const SELECTION_MEANING =
  'Every phone row at or below the threshold is included. No consonant, word-position, acoustic-winner, or hand-written diagnostic filter was applied.'
const CONTEXT_MEANING =
  'For every word containing at least one selected row, include that word and up to two preceding and two following transcript words.'
const OBSERVED_PHONE_SOURCE =
  'acoustic_winner for each forced-aligned reference-phone segment; not an independent word-level decode'
const INTERPRETATION_BOUNDARY =
  'A low GOP is model evidence, not a pronunciation error or a calibrated probability. The LLM cannot hear the audio.'

export interface SpeechGopEvidenceRow extends PronunciationPhoneAssessment {
  evidence_id: string
}

export interface SpeechContextWord {
  relative_position: number
  word_index: number
  word: string
  start_ms?: number
  end_ms?: number
}

export interface SpeechPhoneSequence {
  arpabet: string[]
  ipa: string[]
}

export interface SpeechObservedPhoneSequence extends SpeechPhoneSequence {
  source: typeof OBSERVED_PHONE_SOURCE
}

export interface SpeechWordContext {
  word_index: number
  word: string
  context_text: string
  context_words: SpeechContextWord[]
  reference_phones: SpeechPhoneSequence
  observed_phones: SpeechObservedPhoneSequence
  gop_evidence: SpeechGopEvidenceRow[]
}

export interface SpeechCorrectionEvidence {
  schema_version: 2
  source_result: {
    transcript: string
    transcript_source: string
    audio_duration_ms: number
    gop_method: string
    acoustic_model: string
    acoustic_phone_inventory: string
    reference_source: string
    dictionary_source: string
  }
  selection_policy: {
    gop_log_ratio_lte: typeof SPEECH_GOP_THRESHOLD
    selected_count: number
    word_context_count: number
    meaning: typeof SELECTION_MEANING
  }
  word_context_policy: {
    radius_words: typeof SPEECH_WORD_CONTEXT_RADIUS
    meaning: typeof CONTEXT_MEANING
  }
  interpretation_boundary: typeof INTERPRETATION_BOUNDARY
  rows: SpeechGopEvidenceRow[]
  word_contexts: SpeechWordContext[]
}

export interface SpeechCorrectionTrace {
  evidence?: SpeechCorrectionEvidence
  prompt?: string
  rawResponse?: string
}

export interface SpeechCorrectionResult {
  correction: string
  trace: SpeechCorrectionTrace
}

export async function correctSpeechWithLLM(
  request: {
    transcript: string
    assessment: PronunciationAssessmentResult
  },
  textModel: TextGradingModel,
  options: { signal?: AbortSignal } = {}
): Promise<SpeechCorrectionResult> {
  const evidence = createSpeechCorrectionEvidence(request)
  options.signal?.throwIfAborted()
  if (evidence.rows.length === 0) {
    return {
      correction: formatNoLowGopCorrection(),
      trace: { evidence }
    }
  }

  const prompt = buildSpeechCorrectionPrompt(evidence)
  const rawResponse = await textModel.generate(prompt, {
    signal: options.signal,
    systemPrompt: SPEECH_CORRECTION_SYSTEM_PROMPT,
    temperature: 0,
    maxOutputTokens: 65_535
  })
  return {
    correction: normalizePlainTextResponse(rawResponse),
    trace: { evidence, prompt, rawResponse }
  }
}

export function createSpeechCorrectionEvidence(request: {
  transcript: string
  assessment: PronunciationAssessmentResult
}): SpeechCorrectionEvidence {
  if (typeof request.transcript !== 'string' || !request.transcript.trim()) {
    throw new Error('语音纠错 ASR 转写不能为空')
  }
  validatePronunciationAssessment(request.assessment)

  const selected = request.assessment.phones
    .filter((phone) => phone.gop_log_ratio <= SPEECH_GOP_THRESHOLD)
    .map(copyGopRow)
    .sort(
      (left, right) =>
        left.gop_log_ratio - right.gop_log_ratio ||
        left.start_ms - right.start_ms ||
        left.index - right.index
    )
  const ids = selected.map((row) => row.evidence_id)
  if (new Set(ids).size !== ids.length) throw new Error('GOP 音素索引不唯一')

  const wordContexts = createWordContexts(request.assessment, selected)
  const evidence: SpeechCorrectionEvidence = {
    schema_version: 2,
    source_result: {
      transcript: request.transcript,
      transcript_source: 'AIRouter local ASR provisional transcript',
      audio_duration_ms: request.assessment.audio_duration_ms,
      gop_method: request.assessment.gop_method,
      acoustic_model: request.assessment.acoustic_model,
      acoustic_phone_inventory: request.assessment.acoustic_phone_inventory,
      reference_source: request.assessment.reference_source,
      dictionary_source: request.assessment.dictionary_source
    },
    selection_policy: {
      gop_log_ratio_lte: SPEECH_GOP_THRESHOLD,
      selected_count: selected.length,
      word_context_count: wordContexts.length,
      meaning: SELECTION_MEANING
    },
    word_context_policy: {
      radius_words: SPEECH_WORD_CONTEXT_RADIUS,
      meaning: CONTEXT_MEANING
    },
    interpretation_boundary: INTERPRETATION_BOUNDARY,
    rows: selected,
    word_contexts: wordContexts
  }
  validateSpeechCorrectionEvidence(evidence)
  return evidence
}

export function validateSpeechCorrectionEvidence(evidence: SpeechCorrectionEvidence): void {
  if (evidence.schema_version !== 2) throw new Error('语音纠错证据 schema 版本无效')
  if (
    evidence.selection_policy.gop_log_ratio_lte !== SPEECH_GOP_THRESHOLD ||
    evidence.word_context_policy.radius_words !== SPEECH_WORD_CONTEXT_RADIUS
  ) {
    throw new Error('语音纠错证据选择策略不符合冻结协议')
  }
  if (
    evidence.selection_policy.selected_count !== evidence.rows.length ||
    evidence.selection_policy.word_context_count !== evidence.word_contexts.length
  ) {
    throw new Error('语音纠错证据计数不一致')
  }
  const rowById = new Map(evidence.rows.map((row) => [row.evidence_id, row]))
  if (rowById.size !== evidence.rows.length) throw new Error('语音纠错证据 ID 不唯一')
  for (const row of evidence.rows) {
    if (row.evidence_id !== evidenceId(row.index)) {
      throw new Error(`语音纠错证据 ID 与音素索引不一致：${row.evidence_id}`)
    }
    if (row.gop_log_ratio > SPEECH_GOP_THRESHOLD) {
      throw new Error(`语音纠错证据超过 GOP 阈值：${row.evidence_id}`)
    }
  }

  const seen = new Set<string>()
  for (const context of evidence.word_contexts) {
    if (!context.context_words.length || !context.gop_evidence.length) {
      throw new Error('问题词上下文必须包含局部词窗和 GOP 证据')
    }
    if (
      context.reference_phones.arpabet.length !== context.reference_phones.ipa.length ||
      context.observed_phones.arpabet.length !== context.observed_phones.ipa.length ||
      context.observed_phones.source !== OBSERVED_PHONE_SOURCE
    ) {
      throw new Error('问题词完整音素序列无效')
    }
    const target = context.context_words.find((word) => word.relative_position === 0)
    if (!target || target.word_index !== context.word_index || target.word !== context.word) {
      throw new Error('问题词上下文缺少目标词')
    }
    if (context.context_words.some((word) => Math.abs(word.relative_position) > 2)) {
      throw new Error('问题词上下文超过前后两个词')
    }
    if (context.context_text !== context.context_words.map((word) => word.word).join(' ')) {
      throw new Error('问题词上下文文本与词窗不一致')
    }
    for (const row of context.gop_evidence) {
      const source = rowById.get(row.evidence_id)
      if (!source || !sameGopRow(source, row)) {
        throw new Error(`问题词上下文没有逐字复制证据：${row.evidence_id}`)
      }
      if (row.word_index !== context.word_index || seen.has(row.evidence_id)) {
        throw new Error(`问题词上下文重复或跨词引用证据：${row.evidence_id}`)
      }
      seen.add(row.evidence_id)
    }
  }
  if (seen.size !== rowById.size || [...rowById.keys()].some((id) => !seen.has(id))) {
    throw new Error('问题词上下文没有覆盖全部低 GOP 证据')
  }
}

export function buildSpeechCorrectionPrompt(evidence: SpeechCorrectionEvidence): string {
  validateSpeechCorrectionEvidence(evidence)
  return `请把下面的低 GOP 音素证据写成一段保守的中文发音纠错说明。

输入按“问题单词”组织：每个 word_context 是一个至少含有一条低 GOP 音素的单词，
包含该词前后各最多两个 ASR 单词、该词完整的参考音素序列，以及沿强制对齐窗口得到的
声学赢家音素序列；gop_evidence 是该词内每一条低 GOP 音素的原始证据。

必须遵守：
1. 你看不到音频。这些证据是程序按阈值选出的声学观测，不是人工标注，也不是错误概率；
   expected 与 acoustic_winner 不同不等于发音错误。
2. context_words 和 context_text 来自 ASR，可能有错词，只用于提供局部语境。
3. 只谈发音。不要讨论语法、内容、措辞、停顿、流利度、音高、重音、语调、音量、情绪或整体水平。
4. 承认模型混淆、强制对齐边界、连读、弱读和合法变体的可能，不要断言已经发错。
5. 练习建议要落到具体单词或音素，措辞保守。

输出要求：
- 只输出自然语言中文，纯文本：不要 JSON、不要键值对、不要代码块、不要表格、不要标题、
  不要罗列 evidence_id、不要给分数或等级。
- 2 段以内：先说明观察到的模式，再给 1-3 条具体建议。

按单词组织的低 GOP 证据 JSON：
${JSON.stringify(evidence, null, 2)}`
}

// 与实验脚本 ai_eval3.mjs 的 plain() 一致：模型已被要求纯文本，这里只剥掉
// 意外出现的 Markdown 代码围栏并要求非空，不做其它结构校验。
export function normalizePlainTextResponse(response: string): string {
  if (typeof response !== 'string') throw new Error('LLM 语音纠错结果必须是纯文本')
  const text = response
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim()
  if (!text) throw new Error('LLM 语音纠错结果为空')
  return text
}

function createWordContexts(
  assessment: PronunciationAssessmentResult,
  selected: readonly SpeechGopEvidenceRow[]
): SpeechWordContext[] {
  const words = [...assessment.words].sort((left, right) => left.word_index - right.word_index)
  const positionByIndex = new Map(words.map((word, position) => [word.word_index, position]))
  const selectedByWord = new Map<number, SpeechGopEvidenceRow[]>()
  for (const row of selected) {
    const values = selectedByWord.get(row.word_index) ?? []
    values.push(row)
    selectedByWord.set(row.word_index, values)
  }

  return [...selectedByWord.keys()]
    .sort((left, right) => positionByIndex.get(left)! - positionByIndex.get(right)!)
    .map((wordIndex) => {
      const position = positionByIndex.get(wordIndex)
      if (position === undefined) throw new Error(`低 GOP 证据引用未知单词：${wordIndex}`)
      const target = words[position]
      const first = Math.max(0, position - SPEECH_WORD_CONTEXT_RADIUS)
      const last = Math.min(words.length, position + SPEECH_WORD_CONTEXT_RADIUS + 1)
      const contextWords = words.slice(first, last).map((word, contextOffset) => ({
        relative_position: first + contextOffset - position,
        word_index: word.word_index,
        word: word.text,
        ...(Number.isFinite(word.start_ms) ? { start_ms: word.start_ms } : {}),
        ...(Number.isFinite(word.end_ms) ? { end_ms: word.end_ms } : {})
      }))
      const orderedPhones = [...target.phones].sort(phoneOrder)
      return {
        word_index: target.word_index,
        word: target.text,
        context_text: contextWords.map((word) => word.word).join(' '),
        context_words: contextWords,
        reference_phones: {
          arpabet: [...target.expected_arpabet],
          ipa: [...target.expected_ipa]
        },
        observed_phones: {
          arpabet: orderedPhones.map((phone) => phone.acoustic_winner),
          ipa: orderedPhones.map((phone) => phone.acoustic_winner_ipa),
          source: OBSERVED_PHONE_SOURCE
        },
        gop_evidence: [...(selectedByWord.get(wordIndex) ?? [])].sort(phoneOrder)
      }
    })
}

function validatePronunciationAssessment(assessment: PronunciationAssessmentResult): void {
  if (
    !assessment ||
    assessment.schema_version !== 2 ||
    typeof assessment.reference_text !== 'string' ||
    !assessment.reference_text.trim() ||
    !Number.isFinite(assessment.audio_duration_ms) ||
    assessment.audio_duration_ms <= 0 ||
    !Number.isSafeInteger(assessment.frame_count) ||
    assessment.frame_count <= 0 ||
    assessment.gop_method !== 'viterbi' ||
    !Number.isFinite(assessment.alignment_path_score) ||
    !nonEmptyText(assessment.acoustic_model) ||
    !nonEmptyText(assessment.acoustic_phone_inventory) ||
    !nonEmptyText(assessment.reference_source) ||
    !nonEmptyText(assessment.dictionary_source) ||
    !stringList(assessment.recognized_phones) ||
    !stringList(assessment.recognized_phones_ipa) ||
    assessment.recognized_phones.length !== assessment.recognized_phones_ipa.length ||
    !Array.isArray(assessment.phones) ||
    assessment.phones.length === 0 ||
    !Array.isArray(assessment.words) ||
    assessment.words.length === 0
  ) {
    throw new Error('GOP 发音评测结果无效')
  }
  const phoneByIndex = new Map<number, PronunciationPhoneAssessment>()
  for (const phone of assessment.phones) {
    validatePhoneRow(phone)
    if (phoneByIndex.has(phone.index)) throw new Error(`GOP 音素索引重复：${phone.index}`)
    phoneByIndex.set(phone.index, phone)
  }
  const wordIndexes = new Set<number>()
  const nestedPhoneIndexes = new Set<number>()
  for (const word of assessment.words) {
    if (
      !Number.isSafeInteger(word.word_index) ||
      word.word_index < 0 ||
      wordIndexes.has(word.word_index) ||
      typeof word.text !== 'string' ||
      !word.text ||
      !stringList(word.expected_arpabet) ||
      !stringList(word.expected_ipa) ||
      word.expected_arpabet.length !== word.expected_ipa.length ||
      !Number.isFinite(word.start_ms) ||
      !Number.isFinite(word.end_ms) ||
      word.start_ms < 0 ||
      word.end_ms < word.start_ms ||
      !Array.isArray(word.phones) ||
      word.phones.length === 0 ||
      word.phones.length !== word.expected_arpabet.length
    ) {
      throw new Error('GOP 词级评测结果无效')
    }
    wordIndexes.add(word.word_index)
    const orderedPhones = [...word.phones].sort(phoneOrder)
    orderedPhones.forEach((phone, phoneIndex) => {
      const source = phoneByIndex.get(phone.index)
      if (
        !source ||
        !samePhoneRow(source, phone) ||
        nestedPhoneIndexes.has(phone.index) ||
        phone.word_index !== word.word_index ||
        phone.word !== word.text ||
        phone.phone_index !== phoneIndex ||
        phone.expected !== word.expected_arpabet[phoneIndex]
      ) {
        throw new Error(`GOP 词级音素与扁平证据不一致：${phone.index}`)
      }
      nestedPhoneIndexes.add(phone.index)
    })
  }
  if (
    nestedPhoneIndexes.size !== phoneByIndex.size ||
    [...phoneByIndex.keys()].some((index) => !nestedPhoneIndexes.has(index))
  ) {
    throw new Error('GOP 词级结果没有覆盖全部扁平音素')
  }
}

function validatePhoneRow(phone: PronunciationPhoneAssessment): void {
  const finiteFields = [
    phone.expected_log_p,
    phone.alternative_log_p,
    phone.gop_log_ratio,
    phone.confidence,
    phone.start_ms,
    phone.end_ms
  ]
  if (
    !Number.isSafeInteger(phone.index) ||
    phone.index < 0 ||
    !Number.isSafeInteger(phone.word_index) ||
    phone.word_index < 0 ||
    !Number.isSafeInteger(phone.phone_index) ||
    phone.phone_index < 0 ||
    !nonEmptyText(phone.word) ||
    !nonEmptyText(phone.expected) ||
    !nonEmptyText(phone.expected_ipa) ||
    !nonEmptyText(phone.acoustic_winner) ||
    !nonEmptyText(phone.acoustic_winner_ipa) ||
    !nonEmptyText(phone.best_alternative) ||
    !nonEmptyText(phone.best_alternative_ipa) ||
    finiteFields.some((value) => !Number.isFinite(value)) ||
    phone.start_ms < 0 ||
    phone.end_ms < phone.start_ms
  ) {
    throw new Error(`GOP 音素证据行无效：${String(phone.index)}`)
  }
}

function copyGopRow(phone: PronunciationPhoneAssessment): SpeechGopEvidenceRow {
  return {
    evidence_id: evidenceId(phone.index),
    index: phone.index,
    word_index: phone.word_index,
    phone_index: phone.phone_index,
    word: phone.word,
    expected: phone.expected,
    expected_ipa: phone.expected_ipa,
    acoustic_winner: phone.acoustic_winner,
    acoustic_winner_ipa: phone.acoustic_winner_ipa,
    best_alternative: phone.best_alternative,
    best_alternative_ipa: phone.best_alternative_ipa,
    expected_log_p: phone.expected_log_p,
    alternative_log_p: phone.alternative_log_p,
    gop_log_ratio: phone.gop_log_ratio,
    confidence: phone.confidence,
    start_ms: phone.start_ms,
    end_ms: phone.end_ms
  }
}

function formatNoLowGopCorrection(): string {
  return [
    `全部强制对齐音素的 GOP 均高于 ${SPEECH_GOP_THRESHOLD}，本次没有生成待纠错证据，也未调用文本模型。`,
    'GOP 不是校准后的正确率；本结果只表示没有音素进入冻结阈值范围，不构成发音水平评价。'
  ].join('')
}

function evidenceId(index: number): string {
  return `GOP-${String(index).padStart(4, '0')}`
}

function phoneOrder(
  left: Pick<PronunciationPhoneAssessment, 'phone_index' | 'start_ms' | 'index'>,
  right: Pick<PronunciationPhoneAssessment, 'phone_index' | 'start_ms' | 'index'>
): number {
  return (
    left.phone_index - right.phone_index ||
    left.start_ms - right.start_ms ||
    left.index - right.index
  )
}

function samePhoneRow(
  left: PronunciationPhoneAssessment,
  right: PronunciationPhoneAssessment
): boolean {
  const fields: Array<keyof PronunciationPhoneAssessment> = [
    'index',
    'word_index',
    'phone_index',
    'word',
    'expected',
    'expected_ipa',
    'acoustic_winner',
    'acoustic_winner_ipa',
    'best_alternative',
    'best_alternative_ipa',
    'expected_log_p',
    'alternative_log_p',
    'gop_log_ratio',
    'confidence',
    'start_ms',
    'end_ms'
  ]
  return fields.every((field) => left[field] === right[field])
}

function sameGopRow(left: SpeechGopEvidenceRow, right: SpeechGopEvidenceRow): boolean {
  return left.evidence_id === right.evidence_id && samePhoneRow(left, right)
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyText)
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}
