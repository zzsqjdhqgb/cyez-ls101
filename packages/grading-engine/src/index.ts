import {
  SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID,
  SCHEMA_OBJECTIVE_CORRECT_ANSWER_INPUT_ID,
  SCHEMA_QUESTION_DESCRIPTION_INPUT_ID,
  SCHEMA_REFERENCE_ANSWER_INPUT_ID,
  type GradingResult
} from '@ls101/core-types'
import type {
  GradingEngine,
  GradingInput,
  GradingResourceInput,
  ResolvedGradingAnswer
} from '@ls101/submission-library'
import { correctSpeechWithLLM, type SpeechCorrectionTrace } from './speech-correction'
import { parseNoDictionaryCoverageError, type PronunciationAssessmentResult } from './pronunciation'

export {
  buildSpeechCorrectionPrompt,
  correctSpeechWithLLM,
  createSpeechCorrectionEvidence,
  normalizePlainTextResponse,
  SPEECH_CORRECTION_SYSTEM_PROMPT,
  SPEECH_GOP_THRESHOLD,
  SPEECH_WORD_CONTEXT_RADIUS,
  validateSpeechCorrectionEvidence
} from './speech-correction'
export type {
  SpeechCorrectionEvidence,
  SpeechCorrectionResult,
  SpeechCorrectionTrace,
  SpeechContextWord,
  SpeechGopEvidenceRow,
  SpeechObservedPhoneSequence,
  SpeechPhoneSequence,
  SpeechWordContext
} from './speech-correction'
export { noDictionaryCoverageError, parseNoDictionaryCoverageError } from './pronunciation'
export type { NoDictionaryCoverage } from './pronunciation'

export interface SpeechRecognitionModelSelection {
  providerId: string
  modelId: string
}

export interface TextGradingModelSelection {
  providerId: string
  modelId: string
}

export interface SpeechRecognitionRequest {
  audio: GradingResourceInput & { durationMs: number }
}

export interface SpeechRecognizer {
  recognize(request: SpeechRecognitionRequest, options?: { signal?: AbortSignal }): Promise<string>
}

export interface PronunciationAssessmentRequest {
  audio: GradingResourceInput & { durationMs: number }
  referenceText: string
}

export interface PronunciationAssessor {
  assess(
    request: PronunciationAssessmentRequest,
    options?: { signal?: AbortSignal }
  ): Promise<PronunciationAssessmentResult>
}

export interface TextGenerationOptions {
  signal?: AbortSignal
  systemPrompt?: string
  temperature?: number
  maxOutputTokens?: number
}

export interface TextGradingModel {
  generate(prompt: string, options?: TextGenerationOptions): Promise<string>
}

export interface ProcessedGradingAnswer {
  answerId: string
  description: string
  transcript: string
  correction: string
  correctionTrace: SpeechCorrectionTrace
  uncoveredWords: string[]
  allWordsOutsideDictionary?: true
  referenceText?: string
}

export interface AIGradingTrace {
  speechRecognitionModel: SpeechRecognitionModelSelection
  textModel: TextGradingModelSelection
  answers: ProcessedGradingAnswer[]
  prompt: string
  rawResponse: string
  result: GradingResult
}

export interface AIGradingExecution {
  result: GradingResult
  trace: AIGradingTrace
}

export interface AIGradingProgress {
  answers: ProcessedGradingAnswer[]
  prompt?: string
  rawResponse?: string
  result?: GradingResult
}

export interface AIGradingDependencies {
  recognizer: SpeechRecognizer
  pronunciationAssessor: PronunciationAssessor
  textModel: TextGradingModel
  speechRecognitionModel: SpeechRecognitionModelSelection
  textModelSelection: TextGradingModelSelection
}

export class AIGradingError extends Error {
  constructor(
    public readonly code:
      | 'UNSUPPORTED_QUESTION_TYPE'
      | 'INVALID_SPEECH_RESULT'
      | 'INVALID_MODEL_RESPONSE',
    message: string
  ) {
    super(message)
    this.name = 'AIGradingError'
  }
}

export function createAIGradingEngine(
  dependencies: AIGradingDependencies,
  options: { signal?: AbortSignal; onTrace?(trace: AIGradingTrace): void } = {}
): GradingEngine {
  return {
    kind: 'ai',
    async grade(input) {
      const execution = await executeAIGrading(input, dependencies, options)
      options.onTrace?.(structuredClone(execution.trace))
      return execution.result
    }
  }
}

export async function executeAIGrading(
  input: GradingInput,
  dependencies: AIGradingDependencies,
  options: {
    signal?: AbortSignal
    onProgress?(progress: AIGradingProgress): Promise<void> | void
  } = {}
): Promise<AIGradingExecution> {
  if (input.schema.structure.questionType === 'objective') {
    throw new AIGradingError('UNSUPPORTED_QUESTION_TYPE', '客观题不进入 AI 评分引擎')
  }
  options.signal?.throwIfAborted()
  const audioAnswers = input.answers.filter(isAudioAnswer)
  const answers: ProcessedGradingAnswer[] = []

  // Keep this sequential for the first implementation. The result array is the stable
  // answer-format order and can be preserved when bounded concurrency is added later.
  for (const answer of audioAnswers) {
    options.signal?.throwIfAborted()
    const transcript = await dependencies.recognizer.recognize(
      { audio: answer.audio },
      { signal: options.signal }
    )
    if (typeof transcript !== 'string') {
      throw new AIGradingError('INVALID_SPEECH_RESULT', '语音识别和语音纠错必须返回字符串')
    }
    const assessment = await assessPronunciation(dependencies, answer, transcript, options.signal)
    if (assessment.allWordsOutsideDictionary) {
      answers.push({
        answerId: answer.answerId,
        description: answer.description,
        transcript,
        correction: formatNoDictionaryCoverageCorrection(assessment.result.uncoveredWords),
        correctionTrace: {},
        uncoveredWords: assessment.result.uncoveredWords,
        allWordsOutsideDictionary: true,
        ...(answer.type === 'fixed-speech' ? { referenceText: answer.text } : {})
      })
      await options.onProgress?.({ answers: structuredClone(answers) })
      continue
    }
    const correctionResult = await correctSpeechWithLLM(
      {
        transcript,
        assessment: assessment.result
      },
      dependencies.textModel,
      { signal: options.signal }
    )
    answers.push({
      answerId: answer.answerId,
      description: answer.description,
      transcript,
      correction: correctionResult.correction,
      correctionTrace: correctionResult.trace,
      uncoveredWords: [...assessment.result.uncovered_words],
      ...(answer.type === 'fixed-speech' ? { referenceText: answer.text } : {})
    })
    await options.onProgress?.({ answers: structuredClone(answers) })
  }

  const prompt = buildAIGradingPrompt(input, answers)
  await options.onProgress?.({ answers: structuredClone(answers), prompt })
  const rawResponse = await dependencies.textModel.generate(prompt, { signal: options.signal })
  await options.onProgress?.({ answers: structuredClone(answers), prompt, rawResponse })
  const parsed = parseAIGradingResponse(rawResponse, input.schema.data.maxScore)
  // 评分政策：只要有答案的全部单词都不在标准词典中（发音完全无法评测），
  // 该评分单元的正式得分强制为 0；评语由模型按 prompt 指令说明原因并给出
  // 仅按内容评分的参考分。
  const result =
    answers.some((answer) => answer.allWordsOutsideDictionary) && parsed.score !== 0
      ? { ...parsed, score: 0 }
      : parsed
  await options.onProgress?.({
    answers: structuredClone(answers),
    prompt,
    rawResponse,
    result: structuredClone(result)
  })
  return {
    result,
    trace: {
      speechRecognitionModel: structuredClone(dependencies.speechRecognitionModel),
      textModel: structuredClone(dependencies.textModelSelection),
      answers: structuredClone(answers),
      prompt,
      rawResponse,
      result: structuredClone(result)
    }
  }
}

// 发音评测的两类结果：正常返回对齐结果；转写中没有任何词典可覆盖单词时，
// worker/IPC 只回传错误消息字符串，因此用带标记的错误承载缺词清单。
async function assessPronunciation(
  dependencies: AIGradingDependencies,
  answer: Extract<GradingInput['answers'][number], { audio: unknown }>,
  transcript: string,
  signal: AbortSignal | undefined
): Promise<
  | { result: PronunciationAssessmentResult; allWordsOutsideDictionary?: false }
  | { result: { uncoveredWords: string[] }; allWordsOutsideDictionary: true }
> {
  try {
    const result = await dependencies.pronunciationAssessor.assess(
      { audio: answer.audio, referenceText: transcript },
      { signal }
    )
    return { result }
  } catch (error) {
    const coverage = parseNoDictionaryCoverageError(error)
    if (!coverage) throw error
    return { result: { uncoveredWords: coverage.words }, allWordsOutsideDictionary: true }
  }
}

function formatNoDictionaryCoverageCorrection(words: readonly string[]): string {
  if (words.length === 0) {
    return '该答案的转写中没有可评测的英文单词，无法生成基于音素对齐的发音评测证据，也未调用文本模型。'
  }
  return `该答案转写中的所有单词（${words.join('、')}）均不在标准发音词典中，无法生成基于音素对齐的发音评测证据，也未调用文本模型。`
}

export function buildAIGradingPrompt(
  input: GradingInput,
  answers: readonly ProcessedGradingAnswer[]
): string {
  const payload = {
    questionType: input.schema.structure.questionType,
    schemaName: input.schema.data.name,
    maxScore: input.schema.data.maxScore,
    inputs: input.inputs.map((item) => ({
      inputId: item.inputId,
      description:
        input.schema.data.inputDescriptions[item.inputId] ?? builtinInputName(item.inputId),
      value: item.value
    })),
    rubricMarkdown: input.schema.data.rubricMarkdown,
    extraPromptMarkdown: input.schema.data.extraPromptMarkdown ?? '',
    answers: answers.map((answer) => ({
      answerId: answer.answerId,
      description: answer.description,
      transcript: answer.transcript,
      correction: answer.correction,
      ...(answer.uncoveredWords.length === 0 ? {} : { uncoveredWords: answer.uncoveredWords }),
      ...(answer.allWordsOutsideDictionary ? { allWordsOutsideDictionary: true } : {}),
      ...(answer.referenceText === undefined ? {} : { referenceText: answer.referenceText })
    }))
  }
  const uncoveredPolicy = answers.filter((answer) => answer.allWordsOutsideDictionary)
  return [
    '你是英语听说考试的评分员。请严格依据评分材料和评分标准对整个评分单元打分。',
    '语音纠错描述是语音系统的分析结果；额外提示词是出题者补充的评分指令。',
    '只输出一个 JSON 对象，不要使用 Markdown 代码块，不要输出解释性文字。',
    '输出必须严格符合：{"score": number, "comment": string}',
    `score 必须在 0 到 ${input.schema.data.maxScore} 之间，且最多三位小数；comment 是 Markdown 评语。`,
    ...(uncoveredPolicy.length === 0
      ? []
      : [
          `评分政策：答案 ${uncoveredPolicy
            .map((answer) => `「${answer.description}」`)
            .join(
              '、'
            )} 的所有单词都不在标准发音词典中（或没有可评测的英文单词），发音完全无法评测。`,
          '本题 score 必须为 0。comment 必须明确说明该答案无法进行发音评测的原因，并单独给出「如果仅根据内容评分」本题可达的参考分数（例如：本题所有单词都不在标准词典中。如果只根据内容评分，此题可得 x 分）。'
        ]),
    '',
    '评分材料 JSON：',
    JSON.stringify(payload, null, 2)
  ].join('\n')
}

export function parseAIGradingResponse(response: string, maxScore: number): GradingResult {
  if (typeof response !== 'string') {
    throw invalidModelResponse('AI 评分结果必须是 JSON 文本')
  }
  let value: unknown
  let scoreSource: string | undefined
  try {
    value = JSON.parse(
      response.replace(/^\uFEFF/, '').trim(),
      (key, parsedValue, context?: { source?: string }) => {
        if (key === 'score' && typeof parsedValue === 'number') scoreSource = context?.source
        return parsedValue
      }
    )
  } catch {
    throw invalidModelResponse('AI 评分结果不是严格 JSON')
  }
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'score' && key !== 'comment')) {
    throw invalidModelResponse('AI 评分结果只能包含 score 和 comment')
  }
  if (
    typeof value.score !== 'number' ||
    !Number.isFinite(value.score) ||
    value.score < 0 ||
    value.score > maxScore ||
    decimalPlacesFromJSONNumber(scoreSource ?? value.score.toString()) > 3 ||
    typeof value.comment !== 'string'
  ) {
    throw invalidModelResponse(`score 必须在 0 到 ${maxScore} 之间且最多三位小数`)
  }
  return { score: value.score, comment: value.comment }
}

function isAudioAnswer(
  answer: ResolvedGradingAnswer
): answer is Extract<ResolvedGradingAnswer, { type: 'fixed-speech' | 'free-speech' }> {
  return answer.type === 'fixed-speech' || answer.type === 'free-speech'
}

function builtinInputName(inputId: string): string {
  if (inputId === SCHEMA_QUESTION_DESCRIPTION_INPUT_ID) return '题目描述'
  if (inputId === SCHEMA_OBJECTIVE_CORRECT_ANSWER_INPUT_ID) return '正确答案'
  if (inputId === SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID) return '解析'
  if (inputId === SCHEMA_REFERENCE_ANSWER_INPUT_ID) return '参考答案'
  return inputId
}

function decimalPlacesFromJSONNumber(source: string): number {
  const [coefficient, exponentText] = source.toLowerCase().split('e')
  const exponent = Number(exponentText ?? '0')
  const fractional = coefficient.split('.')[1]?.length ?? 0
  return Math.max(0, fractional - exponent)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalidModelResponse(message: string): AIGradingError {
  return new AIGradingError('INVALID_MODEL_RESPONSE', message)
}
