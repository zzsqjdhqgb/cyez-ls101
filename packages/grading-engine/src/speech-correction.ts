import { dictionary } from 'cmu-pronouncing-dictionary'
import type { TextGradingModel } from './index'

export type SpeechWordAlignmentOperation = 'match' | 'substitution' | 'deletion' | 'insertion'

export interface SpeechWordAlignmentEvidence {
  evidenceId: string
  operation: SpeechWordAlignmentOperation
  referenceWord?: string
  transcriptWord?: string
  referencePronunciations: string[][]
  transcriptPronunciations: string[][]
}

export interface SpeechCorrectionEvidence {
  schemaVersion: 1
  referenceText: string
  provisionalTranscript: string
  transcriptIsGroundTruth: false
  phonemeSource: 'CMUdict 0.7b ARPAbet'
  alignment: SpeechWordAlignmentEvidence[]
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

interface CorrectionDecision {
  evidenceId: string
  decision: 'likely_issue' | 'uncertain' | 'no_issue'
  feedback: string
}

interface AlignedWordPair {
  operation: SpeechWordAlignmentOperation
  reference?: string
  transcript?: string
}

const FREE_SPEECH_CORRECTION =
  '自由表达没有固定参考文本，无法执行参考文本与 ASR 转写的单词级对齐；本次不据此判断发音错误。'
const NO_DIFFERENCE_CORRECTION =
  '参考文本与 ASR 转写的单词序列一致。由于 ASR 结果不是人工听辨真值，本结果不代表逐音素发音完全正确。'

export async function correctSpeechWithLLM(
  request: { transcript: string; referenceText?: string },
  textModel: TextGradingModel,
  options: { signal?: AbortSignal } = {}
): Promise<SpeechCorrectionResult> {
  if (!request.referenceText?.trim()) {
    return { correction: FREE_SPEECH_CORRECTION, trace: {} }
  }
  const evidence = createSpeechCorrectionEvidence(request.referenceText, request.transcript)
  const candidateIds = evidence.alignment
    .filter((item) => item.operation !== 'match')
    .map((item) => item.evidenceId)
  if (candidateIds.length === 0) {
    return { correction: NO_DIFFERENCE_CORRECTION, trace: { evidence } }
  }

  options.signal?.throwIfAborted()
  const prompt = buildSpeechCorrectionPrompt(evidence)
  const rawResponse = await textModel.generate(prompt, options)
  const decisions = parseSpeechCorrectionResponse(rawResponse, candidateIds)
  return {
    correction: formatSpeechCorrection(decisions),
    trace: { evidence, prompt, rawResponse }
  }
}

export function createSpeechCorrectionEvidence(
  referenceText: string,
  transcript: string
): SpeechCorrectionEvidence {
  const referenceWords = tokenizeEnglishWords(referenceText)
  if (referenceWords.length === 0) throw new Error('语音纠错参考文本中没有英文单词')
  const transcriptWords = tokenizeEnglishWords(transcript)
  const pairs = alignWords(referenceWords, transcriptWords)
  return {
    schemaVersion: 1,
    referenceText,
    provisionalTranscript: transcript,
    transcriptIsGroundTruth: false,
    phonemeSource: 'CMUdict 0.7b ARPAbet',
    alignment: pairs.map((pair, index) => ({
      evidenceId: `W${String(index + 1).padStart(3, '0')}`,
      operation: pair.operation,
      ...(pair.reference ? { referenceWord: pair.reference } : {}),
      ...(pair.transcript ? { transcriptWord: pair.transcript } : {}),
      referencePronunciations: pair.reference ? dictionaryPronunciations(pair.reference) : [],
      transcriptPronunciations: pair.transcript ? dictionaryPronunciations(pair.transcript) : []
    }))
  }
}

export function buildSpeechCorrectionPrompt(evidence: SpeechCorrectionEvidence): string {
  const candidateIds = evidence.alignment
    .filter((item) => item.operation !== 'match')
    .map((item) => item.evidenceId)
  return [
    '你是英语学习场景中的保守语音纠错助手。请审查参考文本与 ASR 临时转写的单词级对齐证据。',
    '',
    '证据边界：',
    '1. provisionalTranscript 来自 ASR，可能转写错误，不是人工听辨真值。',
    '2. operation 只表示单词序列的编辑对齐，不直接证明漏读、错读或发音错误。',
    '3. pronunciations 是 CMUdict 的 ARPAbet 词典读音，不是从录音中识别出的音素。',
    '4. 同音词、缩读、合法变体、专有名词和词典缺词应优先判为 uncertain 或 no_issue。',
    '5. 不得捏造录音中的具体音素、重音、语调、音量、语速、停顿或情绪。',
    '6. 只有证据足以支持且有教学价值时才使用 likely_issue；没有可信问题时允许全部为 no_issue。',
    `7. 必须且只能各判断一次这些候选 evidenceId：${candidateIds.join(', ')}。match 项不得输出。`,
    '',
    '严格输出以下 JSON，不要使用 Markdown 代码块，不要增加字段：',
    'decision 只能是 likely_issue、uncertain 或 no_issue。',
    '{"items":[{"evidenceId":"W001","decision":"uncertain","feedback":"简洁中文反馈；no_issue 时可为空字符串"}]}',
    '',
    '单词级对齐证据 JSON：',
    JSON.stringify(evidence, null, 2)
  ].join('\n')
}

export function parseSpeechCorrectionResponse(
  response: string,
  candidateIds: readonly string[]
): CorrectionDecision[] {
  let value: unknown
  try {
    value = JSON.parse(response.replace(/^\uFEFF/, '').trim())
  } catch {
    throw new Error('LLM 语音纠错结果不是严格 JSON')
  }
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.items)) {
    throw new Error('LLM 语音纠错结果必须只包含 items 数组')
  }
  const candidates = new Set(candidateIds)
  const seen = new Set<string>()
  const decisions: CorrectionDecision[] = []
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 3 ||
      typeof item.evidenceId !== 'string' ||
      !candidates.has(item.evidenceId) ||
      seen.has(item.evidenceId) ||
      (item.decision !== 'likely_issue' &&
        item.decision !== 'uncertain' &&
        item.decision !== 'no_issue') ||
      typeof item.feedback !== 'string'
    ) {
      throw new Error('LLM 语音纠错条目不符合证据约束')
    }
    if (item.decision !== 'no_issue' && !item.feedback.trim()) {
      throw new Error('LLM 语音纠错问题和不确定项必须包含反馈')
    }
    seen.add(item.evidenceId)
    decisions.push({
      evidenceId: item.evidenceId,
      decision: item.decision,
      feedback: item.feedback.trim()
    })
  }
  if (seen.size !== candidates.size) throw new Error('LLM 语音纠错未覆盖全部候选证据')
  return decisions
}

function formatSpeechCorrection(decisions: readonly CorrectionDecision[]): string {
  const issues = decisions.filter((item) => item.decision === 'likely_issue')
  const uncertain = decisions.filter((item) => item.decision === 'uncertain')
  const lines = ['**语音纠错（CMUdict + ASR 单词级对齐）**', '']
  if (issues.length === 0) {
    lines.push('未发现有充分证据可以确认的发音问题。')
  } else {
    lines.push('可能需要纠正：')
    for (const item of issues) lines.push(`- \`${item.evidenceId}\`：${item.feedback}`)
  }
  if (uncertain.length > 0) {
    lines.push('', '暂不判错、建议复听：')
    for (const item of uncertain) lines.push(`- \`${item.evidenceId}\`：${item.feedback}`)
  }
  lines.push('', '> ASR 单词差异不是发音错误的直接证明；不确定项不应作为确定错误扣分。')
  return lines.join('\n')
}

function tokenizeEnglishWords(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .replace(/[‘’]/g, "'")
      .match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) ?? []
  ).map((word) => word.toLowerCase())
}

function alignWords(
  reference: readonly string[],
  transcript: readonly string[]
): AlignedWordPair[] {
  const columns = transcript.length + 1
  const costs = new Uint32Array((reference.length + 1) * columns)
  const operations = new Uint8Array(costs.length)
  for (let refIndex = 1; refIndex <= reference.length; refIndex += 1) {
    costs[refIndex * columns] = refIndex
    operations[refIndex * columns] = 1
  }
  for (let transcriptIndex = 1; transcriptIndex <= transcript.length; transcriptIndex += 1) {
    costs[transcriptIndex] = transcriptIndex
    operations[transcriptIndex] = 2
  }
  for (let refIndex = 1; refIndex <= reference.length; refIndex += 1) {
    for (let transcriptIndex = 1; transcriptIndex <= transcript.length; transcriptIndex += 1) {
      const offset = refIndex * columns + transcriptIndex
      const diagonal =
        costs[(refIndex - 1) * columns + transcriptIndex - 1] +
        Number(reference[refIndex - 1] !== transcript[transcriptIndex - 1])
      const deletion = costs[(refIndex - 1) * columns + transcriptIndex] + 1
      const insertion = costs[refIndex * columns + transcriptIndex - 1] + 1
      if (diagonal <= deletion && diagonal <= insertion) {
        costs[offset] = diagonal
        operations[offset] = 0
      } else if (deletion <= insertion) {
        costs[offset] = deletion
        operations[offset] = 1
      } else {
        costs[offset] = insertion
        operations[offset] = 2
      }
    }
  }

  const reversed: AlignedWordPair[] = []
  let refIndex = reference.length
  let transcriptIndex = transcript.length
  while (refIndex > 0 || transcriptIndex > 0) {
    const operation = operations[refIndex * columns + transcriptIndex]
    if (operation === 0 && refIndex > 0 && transcriptIndex > 0) {
      const referenceWord = reference[refIndex - 1]
      const transcriptWord = transcript[transcriptIndex - 1]
      reversed.push({
        operation: referenceWord === transcriptWord ? 'match' : 'substitution',
        reference: referenceWord,
        transcript: transcriptWord
      })
      refIndex -= 1
      transcriptIndex -= 1
    } else if (operation === 1 && refIndex > 0) {
      reversed.push({ operation: 'deletion', reference: reference[refIndex - 1] })
      refIndex -= 1
    } else if (transcriptIndex > 0) {
      reversed.push({ operation: 'insertion', transcript: transcript[transcriptIndex - 1] })
      transcriptIndex -= 1
    } else {
      break
    }
  }
  return reversed.reverse()
}

function dictionaryPronunciations(word: string): string[][] {
  const pronunciations: string[][] = []
  const primary = dictionary[word]
  if (primary) pronunciations.push(splitPronunciation(primary))
  for (let index = 1; index <= 20; index += 1) {
    const variant = dictionary[`${word}(${index})`]
    if (variant) pronunciations.push(splitPronunciation(variant))
  }
  return pronunciations
}

function splitPronunciation(value: string): string[] {
  return value.trim().split(/\s+/)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
