import type { PronunciationAssessmentResult, PronunciationPhoneAssessment } from './pronunciation'
import type { TextGradingModel } from './index'

export const SPEECH_GOP_THRESHOLD = -0.35
export const SPEECH_WORD_CONTEXT_RADIUS = 2
export const SPEECH_CORRECTION_SYSTEM_PROMPT = `You are an evidence-constrained English pronunciation feedback editor.
You cannot hear the audio. You may only organize and cautiously explain the supplied
CMU-phone CTC-GOP word-context evidence. Never invent acoustic, prosodic, grammatical,
semantic, or audio observations. Return the requested JSON contract exactly.`

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

export interface SpeechEvidenceObservation {
  evidence_id: string
  expected: string
  expected_ipa: string
  acoustic_winner: string
  acoustic_winner_ipa: string
}

export interface SpeechFeedbackItem {
  evidence_ids: string[]
  decision: 'likely_issue' | 'needs_listening'
  observations: SpeechEvidenceObservation[]
  finding_zh: string
  rationale_zh: string
  practice_zh: string
}

export interface WithheldSpeechDifference {
  evidence_ids: string[]
  observations: SpeechEvidenceObservation[]
  reason_zh: string
}

export interface SpeechCorrectionDecision {
  summary_zh: string
  feedback_items: SpeechFeedbackItem[]
  withheld_differences: WithheldSpeechDifference[]
  limitations_zh: string[]
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
  const decision = parseSpeechCorrectionResponse(rawResponse, evidence)
  return {
    correction: formatSpeechCorrection(decision, evidence),
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
    throw new Error('语音纠错证据选择策略不符合 v3 冻结协议')
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
  const sourceResult = {
    transcript_source: evidence.source_result.transcript_source,
    audio_duration_ms: evidence.source_result.audio_duration_ms,
    gop_method: evidence.source_result.gop_method,
    acoustic_model: evidence.source_result.acoustic_model,
    acoustic_phone_inventory: evidence.source_result.acoustic_phone_inventory,
    reference_source: evidence.source_result.reference_source,
    dictionary_source: evidence.source_result.dictionary_source
  }
  const promptEvidence = {
    source_result: {
      ...sourceResult,
      transcript_scope:
        'The full ASR transcript is retained in local evidence for audit only; the prompt contains only the local context_words/context_text windows.'
    },
    selection_policy: evidence.selection_policy,
    word_context_policy: evidence.word_context_policy,
    interpretation_boundary: evidence.interpretation_boundary,
    word_contexts: evidence.word_contexts
  }
  return `请把下面所有存在低 GOP 质疑的单词证据整理成保守的中文发音反馈，不要评分。

输入按“问题单词”组织：每个 \`word_context\` 都表示至少含有一条低 GOP 音素的单词，
并包含该词前后各最多两个 ASR 单词、该词完整的参考音素序列、
以及沿强制对齐窗口得到的用户声学赢家音素序列。\`gop_evidence\` 是该词内每一条
低 GOP 音素的详细原始证据。

必须遵守：
1. 你看不到音频。每一条 evidence_id 都是程序按阈值选出的原始声学证据，不是人工标注，
   也不是错误概率；expected 与 acoustic_winner 不同不自动等于发音错误。
2. 本次请求不包含完整 ASR transcript；\`context_words\` 和 \`context_text\` 来自 ASR，
   可能有错词，只用于提供局部语境。
   不得讨论语法、内容、措辞、停顿、流利度、
   音高、重音、语调、音量、情绪或整体水平。
3. \`reference_phones\` 是标准参考的 CMU/IPA 序列；\`observed_phones\` 是每个参考音素
   对齐窗口的 \`acoustic_winner\` 拼接，不是独立无条件的单词 ASR，也不是已经确认的用户发音。
4. 可以结合单词、CMU 音素、IPA、相邻证据和重复模式判断教学价值，但必须承认模型/对齐
   混淆、连读、弱读、合法变体和边界偏移的可能性。
5. \`likely_issue\` 只用于你认为值得明确反馈的重复或相对清晰模式；\`needs_listening\` 用于
   值得人工复听但不能确定的模式；其余放入 \`withheld_differences\`，说明为什么不应直接报错。
6. 必须让每个输入 evidence_id 在 \`feedback_items\` 或 \`withheld_differences\` 中出现且只出现
   一次。可以把同类 evidence_id 合并成一条，但不要丢弃任何一条，也不要创造 ID。
7. 每个反馈/暂缓项都必须在 \`observations\` 中逐字复制所引用行的 expected、expected_ipa、
   acoustic_winner、acoustic_winner_ipa；程序会核对这些字段。不要把 ARPAbet 音素改名，
   也不要把单个音素拼成输入中没有的整词 IPA、音节重音或方言转写。
8. 反馈只能引用输入中的音素和数值。练习建议要针对具体音素，且不能承诺模型已经证明了
   某个错误；不要用外部词典知识替换输入中的 CMU 音素。

严格输出以下 JSON，不要 Markdown 代码块，不要增加字段：
{
  "summary_zh": "一句保守总结",
  "feedback_items": [
    {
      "evidence_ids": ["GOP-0001"],
      "decision": "likely_issue 或 needs_listening",
      "observations": [
        {
          "evidence_id": "GOP-0001",
          "expected": "B",
          "expected_ipa": "b",
          "acoustic_winner": "P",
          "acoustic_winner_ipa": "p"
        }
      ],
      "finding_zh": "证据支持的发音观察",
      "rationale_zh": "为什么值得反馈或复听",
      "practice_zh": "具体而保守的练习建议"
    }
  ],
  "withheld_differences": [
    {
      "evidence_ids": ["GOP-0002"],
      "observations": [
        {
          "evidence_id": "GOP-0002",
          "expected": "B",
          "expected_ipa": "b",
          "acoustic_winner": "P",
          "acoustic_winner_ipa": "p"
        }
      ],
      "reason_zh": "为什么不能直接向学习者报错"
    }
  ],
  "limitations_zh": ["本次整理的具体限制"]
}

按单词组织的低 GOP 证据 JSON：
${JSON.stringify(promptEvidence, null, 2)}`
}

export function parseSpeechCorrectionResponse(
  response: string,
  evidence: SpeechCorrectionEvidence
): SpeechCorrectionDecision {
  validateSpeechCorrectionEvidence(evidence)
  const value = parseJsonObject(response)
  if (
    !hasExactKeys(value, [
      'summary_zh',
      'feedback_items',
      'withheld_differences',
      'limitations_zh'
    ]) ||
    !nonEmptyText(value.summary_zh) ||
    !Array.isArray(value.feedback_items) ||
    !Array.isArray(value.withheld_differences) ||
    !Array.isArray(value.limitations_zh) ||
    !value.limitations_zh.every(nonEmptyText)
  ) {
    throw new Error('LLM 语音纠错结果不符合 v3 顶层合同')
  }

  const rowById = new Map(evidence.rows.map((row) => [row.evidence_id, row]))
  const seen = new Set<string>()
  const feedbackItems = value.feedback_items.map((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        'evidence_ids',
        'decision',
        'observations',
        'finding_zh',
        'rationale_zh',
        'practice_zh'
      ]) ||
      (item.decision !== 'likely_issue' && item.decision !== 'needs_listening') ||
      !nonEmptyText(item.finding_zh) ||
      !nonEmptyText(item.rationale_zh) ||
      !nonEmptyText(item.practice_zh)
    ) {
      throw new Error('LLM 语音纠错反馈项不符合 v3 证据合同')
    }
    const evidenceIds = validateEvidenceIds(item.evidence_ids, rowById, seen)
    const observations = validateObservations(item.observations, evidenceIds, rowById)
    return {
      evidence_ids: evidenceIds,
      decision: item.decision,
      observations,
      finding_zh: item.finding_zh,
      rationale_zh: item.rationale_zh,
      practice_zh: item.practice_zh
    }
  })
  const withheldDifferences = value.withheld_differences.map((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['evidence_ids', 'observations', 'reason_zh']) ||
      !nonEmptyText(item.reason_zh)
    ) {
      throw new Error('LLM 语音纠错暂缓项不符合 v3 证据合同')
    }
    const evidenceIds = validateEvidenceIds(item.evidence_ids, rowById, seen)
    return {
      evidence_ids: evidenceIds,
      observations: validateObservations(item.observations, evidenceIds, rowById),
      reason_zh: item.reason_zh
    }
  })

  if (seen.size !== rowById.size || [...rowById.keys()].some((id) => !seen.has(id))) {
    throw new Error('LLM 没有恰好一次归档全部低 GOP 证据 ID')
  }
  return {
    summary_zh: value.summary_zh,
    feedback_items: feedbackItems,
    withheld_differences: withheldDifferences,
    limitations_zh: value.limitations_zh as string[]
  }
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

function validateEvidenceIds(
  value: unknown,
  rowById: ReadonlyMap<string, SpeechGopEvidenceRow>,
  seen: Set<string>
): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Error('LLM 语音纠错引用了无效的证据 ID 列表')
  }
  const ids = value as string[]
  if (new Set(ids).size !== ids.length) throw new Error('LLM 单项重复引用了证据 ID')
  if (ids.some((id) => !rowById.has(id))) throw new Error('LLM 语音纠错引用了未知证据 ID')
  if (ids.some((id) => seen.has(id))) throw new Error('LLM 语音纠错重复归档了证据 ID')
  ids.forEach((id) => seen.add(id))
  return ids
}

function validateObservations(
  value: unknown,
  evidenceIds: readonly string[],
  rowById: ReadonlyMap<string, SpeechGopEvidenceRow>
): SpeechEvidenceObservation[] {
  if (!Array.isArray(value) || value.length !== evidenceIds.length) {
    throw new Error('LLM observations 必须与 evidence_ids 一一对应')
  }
  return value.map((observation, index) => {
    if (
      !isRecord(observation) ||
      !hasExactKeys(observation, [
        'evidence_id',
        'expected',
        'expected_ipa',
        'acoustic_winner',
        'acoustic_winner_ipa'
      ]) ||
      observation.evidence_id !== evidenceIds[index]
    ) {
      throw new Error('LLM observation ID 必须按 evidence_ids 顺序逐项对应')
    }
    const source = rowById.get(evidenceIds[index])!
    for (const field of [
      'expected',
      'expected_ipa',
      'acoustic_winner',
      'acoustic_winner_ipa'
    ] as const) {
      if (observation[field] !== source[field]) {
        throw new Error(`LLM observation 没有逐字复制 ${field}：${source.evidence_id}`)
      }
    }
    return {
      evidence_id: source.evidence_id,
      expected: source.expected,
      expected_ipa: source.expected_ipa,
      acoustic_winner: source.acoustic_winner,
      acoustic_winner_ipa: source.acoustic_winner_ipa
    }
  })
}

function formatSpeechCorrection(
  decision: SpeechCorrectionDecision,
  evidence: SpeechCorrectionEvidence
): string {
  const rowById = new Map(evidence.rows.map((row) => [row.evidence_id, row]))
  const lines = ['**语音纠错（CMU-phone CTC-GOP v3）**', '', decision.summary_zh]
  if (decision.feedback_items.length === 0) {
    lines.push('', '未发现有充分证据、值得向学习者反馈的发音问题。')
  } else {
    lines.push('', '建议关注：')
    for (const item of decision.feedback_items) {
      const label = item.decision === 'likely_issue' ? '较可能' : '需复听'
      const words = [
        ...new Set(item.evidence_ids.map((id) => rowById.get(id)?.word).filter(nonEmptyText))
      ]
      lines.push(
        `- \`${words.join(', ') || '目标词'}\`（${label}；${item.evidence_ids.join(', ')}）：${item.finding_zh}`,
        `  ${item.rationale_zh}`,
        `  练习：${item.practice_zh}`
      )
    }
  }
  lines.push('', '> 低 GOP 是模型证据而非错误概率；暂缓项保留在审计记录中，不直接作为学习者错误。')
  return lines.join('\n')
}

function formatNoLowGopCorrection(): string {
  return [
    '**语音纠错（CMU-phone CTC-GOP v3）**',
    '',
    `全部强制对齐音素的 GOP 均高于 ${SPEECH_GOP_THRESHOLD}，本次没有生成待纠错证据，也未调用文本模型。`,
    '',
    '> GOP 不是校准后的正确率；本结果只表示没有音素进入冻结阈值范围。'
  ].join('\n')
}

function parseJsonObject(response: string): Record<string, unknown> {
  if (typeof response !== 'string') throw new Error('LLM 语音纠错结果必须是 JSON 文本')
  let candidate = response.replace(/^\uFEFF/, '').trim()
  if (candidate.startsWith('```')) {
    const lines = candidate.split(/\r?\n/).slice(1)
    if (lines.at(-1)?.trim() === '```') lines.pop()
    candidate = lines.join('\n').trim()
  }
  let value: unknown
  try {
    value = JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('LLM 语音纠错结果不包含 JSON 对象')
    try {
      value = JSON.parse(candidate.slice(start, end + 1))
    } catch {
      throw new Error('LLM 语音纠错结果不是有效 JSON')
    }
  }
  if (!isRecord(value)) throw new Error('LLM 语音纠错结果必须是 JSON 对象')
  return value
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

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyText)
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
