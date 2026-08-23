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
import type { PronunciationAssessmentResult } from './pronunciation'

export {
  buildSpeechCorrectionPrompt,
  correctSpeechWithLLM,
  createSpeechCorrectionEvidence,
  parseSpeechCorrectionResponse,
  SPEECH_CORRECTION_SYSTEM_PROMPT,
  SPEECH_GOP_THRESHOLD,
  SPEECH_WORD_CONTEXT_RADIUS,
  validateSpeechCorrectionEvidence
} from './speech-correction'
export type {
  SpeechCorrectionEvidence,
  SpeechCorrectionDecision,
  SpeechCorrectionResult,
  SpeechCorrectionTrace,
  SpeechContextWord,
  SpeechEvidenceObservation,
  SpeechFeedbackItem,
  SpeechGopEvidenceRow,
  SpeechObservedPhoneSequence,
  SpeechPhoneSequence,
  SpeechWordContext,
  WithheldSpeechDifference
} from './speech-correction'

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
    const assessment = await dependencies.pronunciationAssessor.assess(
      { audio: answer.audio, referenceText: transcript },
      { signal: options.signal }
    )
    const correctionResult = await correctSpeechWithLLM(
      {
        transcript,
        assessment
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
      ...(answer.type === 'fixed-speech' ? { referenceText: answer.text } : {})
    })
    await options.onProgress?.({ answers: structuredClone(answers) })
  }

  const prompt = buildAIGradingPrompt(input, answers)
  await options.onProgress?.({ answers: structuredClone(answers), prompt })
  const rawResponse = await dependencies.textModel.generate(prompt, { signal: options.signal })
  await options.onProgress?.({ answers: structuredClone(answers), prompt, rawResponse })
  const result = parseAIGradingResponse(rawResponse, input.schema.data.maxScore)
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
      ...(answer.referenceText === undefined ? {} : { referenceText: answer.referenceText })
    }))
  }
  return [
    '你是英语听说考试的评分员。请严格依据评分材料和评分标准对整个评分单元打分。',
    '语音纠错描述是语音系统的分析结果；额外提示词是出题者补充的评分指令。',
    '只输出一个 JSON 对象，不要使用 Markdown 代码块，不要输出解释性文字。',
    '输出必须严格符合：{"score": number, "comment": string}',
    `score 必须在 0 到 ${input.schema.data.maxScore} 之间，且最多三位小数；comment 是 Markdown 评语。`,
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
