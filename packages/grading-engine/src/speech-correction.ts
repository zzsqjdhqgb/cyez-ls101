import type { PronunciationAssessmentResult } from './pronunciation'
import type { TextGradingModel } from './index'

export interface SpeechPhoneAlignmentEvidence {
  phoneId: string
  expectedPhone: string
  acousticWinner: string
  startMs: number
  endMs: number
}

export interface SpeechWordAlignmentEvidence {
  wordId: string
  word: string
  startMs: number
  endMs: number
  phones: SpeechPhoneAlignmentEvidence[]
}

export interface SpeechCorrectionEvidence {
  schemaVersion: 1
  provisionalTranscript: string
  referenceText: string
  referenceSource: 'known-script' | 'asr-provisional-transcript'
  referencePhones: 'CMUdict 0.7b mapped from ARPAbet to model-compatible IPA'
  alignment: 'whole-utterance CTC Viterbi forced alignment'
  acousticModel: 'facebook/wav2vec2-lv-60-espeak-cv-ft ONNX INT8'
  acousticWinnerDefinition: string
  words: SpeechWordAlignmentEvidence[]
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

export interface SpeechFeedbackItem {
  phoneIds: string[]
  word: string
  decision: 'likely_issue' | 'needs_listening'
  findingZh: string
  rationaleZh: string
  practiceZh: string
}

export interface WithheldSpeechDifference {
  phoneIds: string[]
  word: string
  reasonZh: string
}

export interface SpeechCorrectionDecision {
  summaryZh: string
  feedbackItems: SpeechFeedbackItem[]
  withheldDifferences: WithheldSpeechDifference[]
  limitationsZh: string[]
}

export async function correctSpeechWithLLM(
  request: {
    transcript: string
    referenceText: string
    referenceSource: SpeechCorrectionEvidence['referenceSource']
    assessment: PronunciationAssessmentResult
  },
  textModel: TextGradingModel,
  options: { signal?: AbortSignal } = {}
): Promise<SpeechCorrectionResult> {
  const evidence = createSpeechCorrectionEvidence(request)
  options.signal?.throwIfAborted()
  const prompt = buildSpeechCorrectionPrompt(evidence)
  const rawResponse = await textModel.generate(prompt, options)
  const decision = parseSpeechCorrectionResponse(rawResponse, evidence)
  return {
    correction: formatSpeechCorrection(decision),
    trace: { evidence, prompt, rawResponse }
  }
}

export function createSpeechCorrectionEvidence(request: {
  transcript: string
  referenceText: string
  referenceSource: SpeechCorrectionEvidence['referenceSource']
  assessment: PronunciationAssessmentResult
}): SpeechCorrectionEvidence {
  if (!request.referenceText.trim()) throw new Error('语音纠错参考文本不能为空')
  if (request.assessment.words.length === 0) throw new Error('CTC 发音评测没有生成词级对齐')
  return {
    schemaVersion: 1,
    provisionalTranscript: request.transcript,
    referenceText: request.referenceText,
    referenceSource: request.referenceSource,
    referencePhones: 'CMUdict 0.7b mapped from ARPAbet to model-compatible IPA',
    alignment: 'whole-utterance CTC Viterbi forced alignment',
    acousticModel: 'facebook/wav2vec2-lv-60-espeak-cv-ft ONNX INT8',
    acousticWinnerDefinition:
      'The highest mean-logit non-blank phone token in the forced span; it is not an error label, correctness probability, or human transcription.',
    words: request.assessment.words.map((word, wordIndex) => {
      const wordId = `W${String(wordIndex + 1).padStart(3, '0')}`
      return {
        wordId,
        word: word.text,
        startMs: word.startMs,
        endMs: word.endMs,
        phones: word.phones.map((phone, phoneIndex) => ({
          phoneId: `${wordId}-P${String(phoneIndex + 1).padStart(2, '0')}`,
          expectedPhone: phone.expected,
          acousticWinner: phone.observed ?? phone.expected,
          startMs: phone.startMs,
          endMs: phone.endMs
        }))
      }
    })
  }
}

export function buildSpeechCorrectionPrompt(evidence: SpeechCorrectionEvidence): string {
  const referenceNote =
    evidence.referenceSource === 'known-script'
      ? 'referenceText 是本题已知朗读原文；provisionalTranscript 是 ASR 转写，只能作为辅助上下文。'
      : 'referenceText 与 provisionalTranscript 均来自 ASR 临时转写，不是已知原文，可能转写错误。'
  return [
    '下面是一段英语录音的完整词级 CTC 强制对齐。请生成中文发音反馈。',
    '',
    '输入口径：',
    `1. ${referenceNote}`,
    '2. 输入没有经过问题筛选，也没有分数、阈值、置信度或预先作出的好坏判断。',
    '3. 每个 phoneId 表示 CMUdict 期望音素在强制对齐路径中的时间片；acousticWinner 是该时间片里声学模型平均 logit 最高的非空白音素 token，不等于人工听到的真值，也不是错误概率。',
    '4. 强制对齐会把全部参考音素压到音频上。不得据此断言漏词、错词、语法问题或整体水平。',
    '5. 请自行考虑合法口音、自然弱读、闪音、复合 token、相邻音素错位和连锁对齐错误。尤其要识别 CMUdict 拆分音素与模型复合 token 的等价表示，例如 /ə/ + /l/ 对 /əl/；expectedPhone 与 acousticWinner 不同不自动等于发音错误，相同也不证明发音正确。',
    '6. 只把具有实际教学价值且有足够声学依据的差异放进 feedbackItems。证据不充分但值得人工复听的可标 needs_listening；很可能是自然变体、token 表示或对齐问题的差异放进 withheldDifferences。',
    '7. 每个判断必须引用输入中真实存在的 phoneId，不得重复引用；不要捏造音高、重音、语调、音量、情绪、流利度或停顿信息。没有可信问题时允许 feedbackItems 为空。',
    '',
    '严格输出以下 JSON，不要增加字段：',
    '{',
    '  "summaryZh": "保守的一句话总结",',
    '  "feedbackItems": [',
    '    {',
    '      "phoneIds": ["W001-P01"],',
    '      "word": "对应单词",',
    '      "decision": "likely_issue 或 needs_listening",',
    '      "findingZh": "观察到的具体音素差异",',
    '      "rationaleZh": "为什么该差异值得反馈或复听",',
    '      "practiceZh": "具体且不过度承诺的练习建议"',
    '    }',
    '  ],',
    '  "withheldDifferences": [',
    '    {',
    '      "phoneIds": ["W001-P01"],',
    '      "word": "对应单词",',
    '      "reasonZh": "为什么不应直接向学习者报错"',
    '    }',
    '  ],',
    '  "limitationsZh": ["本条分析的具体限制"]',
    '}',
    '',
    '完整词级对齐 JSON：',
    JSON.stringify(evidence, null, 2)
  ].join('\n')
}

export function parseSpeechCorrectionResponse(
  response: string,
  evidence: SpeechCorrectionEvidence
): SpeechCorrectionDecision {
  const value = parseJsonObject(response)
  if (
    !hasExactKeys(value, ['summaryZh', 'feedbackItems', 'withheldDifferences', 'limitationsZh']) ||
    typeof value.summaryZh !== 'string' ||
    !Array.isArray(value.feedbackItems) ||
    !Array.isArray(value.withheldDifferences) ||
    !Array.isArray(value.limitationsZh) ||
    !value.limitationsZh.every((item) => typeof item === 'string')
  ) {
    throw new Error('LLM 语音纠错结果不符合顶层证据协议')
  }

  const phoneWords = new Map(
    evidence.words.flatMap((word) =>
      word.phones.map((phone) => [phone.phoneId, word.word] as const)
    )
  )
  const cited = new Set<string>()
  const feedbackItems = value.feedbackItems.map((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        'phoneIds',
        'word',
        'decision',
        'findingZh',
        'rationaleZh',
        'practiceZh'
      ]) ||
      (item.decision !== 'likely_issue' && item.decision !== 'needs_listening') ||
      typeof item.word !== 'string' ||
      typeof item.findingZh !== 'string' ||
      typeof item.rationaleZh !== 'string' ||
      typeof item.practiceZh !== 'string'
    ) {
      throw new Error('LLM 语音纠错反馈项不符合证据协议')
    }
    const phoneIds = validatePhoneIds(item.phoneIds, item.word, phoneWords, cited)
    return {
      phoneIds,
      word: item.word,
      decision: item.decision,
      findingZh: item.findingZh,
      rationaleZh: item.rationaleZh,
      practiceZh: item.practiceZh
    }
  })
  const withheldDifferences = value.withheldDifferences.map((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['phoneIds', 'word', 'reasonZh']) ||
      typeof item.word !== 'string' ||
      typeof item.reasonZh !== 'string'
    ) {
      throw new Error('LLM 语音纠错暂缓项不符合证据协议')
    }
    return {
      phoneIds: validatePhoneIds(item.phoneIds, item.word, phoneWords, cited),
      word: item.word,
      reasonZh: item.reasonZh
    }
  })
  return {
    summaryZh: value.summaryZh,
    feedbackItems,
    withheldDifferences,
    limitationsZh: value.limitationsZh as string[]
  }
}

function formatSpeechCorrection(decision: SpeechCorrectionDecision): string {
  const lines = ['**语音纠错（CMUdict + 完整词级 CTC 对齐）**', '', decision.summaryZh]
  if (decision.feedbackItems.length === 0) {
    lines.push('', '未发现有充分证据、值得向学习者反馈的发音问题。')
  } else {
    lines.push('', '建议关注：')
    for (const item of decision.feedbackItems) {
      const label = item.decision === 'likely_issue' ? '较可能' : '需复听'
      lines.push(
        `- \`${item.word}\`（${label}；${item.phoneIds.join(', ')}）：${item.findingZh}`,
        `  ${item.rationaleZh}`,
        `  练习：${item.practiceZh}`
      )
    }
  }
  lines.push(
    '',
    '> 复合/拆分 token、自然变体和疑似对齐差异已保留在审计记录中，不直接向学习者报错。'
  )
  return lines.join('\n')
}

function validatePhoneIds(
  value: unknown,
  word: string,
  phoneWords: ReadonlyMap<string, string>,
  cited: Set<string>
): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Error('LLM 语音纠错引用了无效的音素证据 ID')
  }
  const phoneIds = value as string[]
  if (
    new Set(phoneIds).size !== phoneIds.length ||
    phoneIds.some((phoneId) => !phoneWords.has(phoneId) || cited.has(phoneId)) ||
    phoneIds.some((phoneId) => phoneWords.get(phoneId) !== word)
  ) {
    throw new Error('LLM 语音纠错引用与单词不匹配、重复或不存在的音素证据 ID')
  }
  phoneIds.forEach((phoneId) => cited.add(phoneId))
  return phoneIds
}

function parseJsonObject(response: string): Record<string, unknown> {
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

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
