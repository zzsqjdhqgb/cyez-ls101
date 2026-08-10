// @ls101/exam-player - 作答包运行期组装

import type {
  ExamPackage,
  SubmissionCandidate,
  SubmissionPackage,
  SubmissionResourceEntry
} from '@ls101/core-types'

export interface CapturedAudioAnswer {
  blob: Blob
  durationMs: number
}

export interface SubmissionAssemblyInput {
  submissionId: string
  candidate: SubmissionCandidate
  startedAt: string
  submittedAt: string
  /** 按 Player 的 choiceIndex 索引；undefined、null 和 '-' 都表示未作答。 */
  choiceAnswers: ReadonlyArray<string | null | undefined>
  /** 按 Player 的 recordIndex 索引。 */
  recordings: ReadonlyArray<CapturedAudioAnswer | null | undefined>
}

export interface SubmissionBundle {
  submission: SubmissionPackage
  /** 只包含本次考试产生的录音，以 Submission resourceKey 为键。 */
  files: Record<string, Blob>
}

export type SubmissionAssemblyErrorCode =
  | 'INVALID_EXAM_PACKAGE'
  | 'INVALID_SUBMISSION_META'
  | 'INVALID_CAPTURE_PLAN'
  | 'MISSING_RECORDING'
  | 'INVALID_RECORDING'

export class SubmissionAssemblyError extends Error {
  constructor(
    readonly code: SubmissionAssemblyErrorCode,
    message: string,
    readonly details: Readonly<Record<string, string | number>> = {}
  ) {
    super(message)
    this.name = 'SubmissionAssemblyError'
  }
}

/**
 * 复制编译期 SubmissionTemplate，并只补充 ExamPlayer 运行期产生的元数据和答案。
 * 本函数不读取 SchemaUse 的结构或评分数据。
 */
export function assembleSubmission(
  exam: ExamPackage,
  input: SubmissionAssemblyInput
): SubmissionBundle {
  validateExam(exam)
  validateMeta(input)
  validateCapturePlan(exam)

  const strings = Array<string | null>(exam.answerCapturePlan.strings.length).fill(null)
  for (const capture of exam.answerCapturePlan.strings) {
    const answer = input.choiceAnswers[capture.choiceIndex]
    strings[capture.stringAnswerIndex] =
      answer === undefined || answer === null || answer === '-' ? null : answer
  }

  const audios = Array<SubmissionPackage['answers']['audios'][number]>(
    exam.answerCapturePlan.audios.length
  )
  const files: Record<string, Blob> = {}
  const resources = structuredClone(exam.submissionTemplate.resources)

  for (const capture of exam.answerCapturePlan.audios) {
    const recording = input.recordings[capture.recordIndex]
    if (!recording) {
      throw new SubmissionAssemblyError(
        'MISSING_RECORDING',
        `Missing recording for recordIndex ${capture.recordIndex}`,
        { recordIndex: capture.recordIndex, audioAnswerIndex: capture.audioAnswerIndex }
      )
    }
    if (!Number.isFinite(recording.durationMs) || recording.durationMs < 0) {
      throw new SubmissionAssemblyError(
        'INVALID_RECORDING',
        `Invalid recording duration for recordIndex ${capture.recordIndex}`,
        { recordIndex: capture.recordIndex, durationMs: recording.durationMs }
      )
    }

    const resourceKey = `answer-audio-${capture.audioAnswerIndex}`
    if (Object.hasOwn(resources, resourceKey)) {
      throw new SubmissionAssemblyError(
        'INVALID_EXAM_PACKAGE',
        `Submission resource key collides with a static resource: ${resourceKey}`,
        { resourceKey }
      )
    }
    const filename = `recording-${capture.audioAnswerIndex}.${audioExtension(recording.blob.type)}`
    const resource: SubmissionResourceEntry = {
      filename,
      packagePath: `recordings/${resourceKey}/${filename}`,
      ...(recording.blob.type ? { mediaType: recording.blob.type } : {})
    }
    resources[resourceKey] = resource
    files[resourceKey] = recording.blob
    audios[capture.audioAnswerIndex] = {
      resourceKey,
      durationMs: recording.durationMs
    }
  }

  return {
    submission: {
      format: exam.submissionTemplate.format,
      formatVersion: exam.submissionTemplate.formatVersion,
      meta: {
        ...structuredClone(exam.submissionTemplate.meta),
        submissionId: input.submissionId,
        candidate: structuredClone(input.candidate),
        startedAt: input.startedAt,
        submittedAt: input.submittedAt
      },
      answers: { strings, audios },
      schemaUses: structuredClone(exam.submissionTemplate.schemaUses),
      resources
    },
    files
  }
}

function validateExam(exam: ExamPackage): void {
  if (
    exam.format !== 'ls101-exam' ||
    exam.formatVersion !== 1 ||
    exam.submissionTemplate.format !== 'ls101-submission' ||
    exam.submissionTemplate.formatVersion !== 1 ||
    exam.submissionTemplate.meta.examPackageId !== exam.packageId ||
    exam.submissionTemplate.meta.examTitle !== exam.examData.title
  ) {
    throw new SubmissionAssemblyError(
      'INVALID_EXAM_PACKAGE',
      'ExamPackage and SubmissionTemplate metadata do not match'
    )
  }
}

function validateMeta(input: SubmissionAssemblyInput): void {
  if (
    input.submissionId.trim() === '' ||
    input.candidate.candidateId.trim() === '' ||
    input.candidate.displayName.trim() === '' ||
    !isIsoDate(input.startedAt) ||
    !isIsoDate(input.submittedAt)
  ) {
    throw new SubmissionAssemblyError('INVALID_SUBMISSION_META', 'Submission metadata is invalid')
  }
}

function validateCapturePlan(exam: ExamPackage): void {
  validateCaptureEntries(exam.answerCapturePlan.strings, 'stringAnswerIndex', 'choiceIndex')
  validateCaptureEntries(exam.answerCapturePlan.audios, 'audioAnswerIndex', 'recordIndex')

  const choiceIndices = new Set(
    exam.examData.player.choiceMeta?.questions.map((question) => question.choiceIndex) ?? []
  )
  for (const capture of exam.answerCapturePlan.strings) {
    if (!choiceIndices.has(capture.choiceIndex)) {
      throw new SubmissionAssemblyError(
        'INVALID_EXAM_PACKAGE',
        `Capture plan references unknown choiceIndex ${capture.choiceIndex}`,
        { choiceIndex: capture.choiceIndex }
      )
    }
  }

  const recordIndices = new Set(exam.examData.player.recordingIndices)
  for (const capture of exam.answerCapturePlan.audios) {
    if (!recordIndices.has(capture.recordIndex)) {
      throw new SubmissionAssemblyError(
        'INVALID_EXAM_PACKAGE',
        `Capture plan references unknown recordIndex ${capture.recordIndex}`,
        { recordIndex: capture.recordIndex }
      )
    }
  }
}

function validateCaptureEntries<
  T extends Record<Target | Source, number>,
  Target extends string,
  Source extends string
>(entries: readonly T[], targetField: Target, sourceField: Source): void {
  const targets = new Set<number>()
  const sources = new Set<number>()
  for (const entry of entries) {
    const target = entry[targetField]
    const source = entry[sourceField]
    if (
      !Number.isInteger(target) ||
      target < 0 ||
      target >= entries.length ||
      !Number.isInteger(source) ||
      source < 0 ||
      targets.has(target) ||
      sources.has(source)
    ) {
      throw new SubmissionAssemblyError(
        'INVALID_CAPTURE_PLAN',
        `Invalid ${targetField}/${sourceField} mapping`,
        { [targetField]: target, [sourceField]: source }
      )
    }
    targets.add(target)
    sources.add(source)
  }
}

function isIsoDate(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value
    )
  if (!match) return false

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHourText,
    offsetMinuteText
  ] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText)

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  )
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leapYear ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function audioExtension(mediaType: string): string {
  switch (mediaType.toLowerCase().split(';', 1)[0]) {
    case 'audio/wav':
    case 'audio/wave':
      return 'wav'
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/ogg':
      return 'ogg'
    case 'audio/mp4':
      return 'm4a'
    case 'audio/webm':
    default:
      return 'webm'
  }
}
