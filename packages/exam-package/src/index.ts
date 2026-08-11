import { strToU8, unzip, zip } from 'fflate'
import { parseSchemaDefinition, validateSchemaDefinition } from '@ls101/schema-editor'
import type {
  ExamPackage,
  ResolvedChoiceViewport,
  SchemaDefinition,
  SubmissionPackage,
  SubmissionSchemaAnswer,
  SubmissionSchemaUse
} from '@ls101/core-types'

const MANIFEST_PATH = 'manifest.json'
const MAX_FILES = 10_000
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
const SAFE_RESOURCE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:%-]*$/
const RESOURCE_URI = /^resource:([A-Za-z0-9][A-Za-z0-9_.:%-]*)$/
const PACKAGE_URL_ROOT = new URL('https://exam-package.invalid/')

type ResourcePathKind = 'static' | 'either'

export interface ExamArchive {
  exam: ExamPackage
  resources: Record<string, Uint8Array>
}

export interface SubmissionArchive {
  submission: SubmissionPackage
  files: Record<string, Uint8Array>
}

export class ExamPackageArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExamPackageArchiveError'
  }
}

export async function encodeExamPackage(
  exam: ExamPackage,
  resources: Readonly<Record<string, Uint8Array>>
): Promise<Uint8Array> {
  validateExamPackage(exam)
  const files = resourceFiles(exam.examData.resources, resources)
  return encodeArchive(exam, files)
}

export async function decodeExamPackage(data: Uint8Array): Promise<ExamArchive> {
  const files = await unzipArchive(data)
  const exam = readJson<ExamPackage>(files, MANIFEST_PATH)
  validateExamPackage(exam)
  const resources = readResources(files, exam.examData.resources)
  return { exam, resources }
}

export async function encodeSubmissionPackage(
  submission: SubmissionPackage,
  files: Readonly<Record<string, Uint8Array>>
): Promise<Uint8Array> {
  validateSubmissionPackage(submission)
  return encodeArchive(submission, resourceFiles(submission.resources, files))
}

export function collectSubmissionPackageFiles(
  submission: SubmissionPackage,
  examResources: Readonly<Record<string, Uint8Array>>,
  recordings: Readonly<Record<string, Uint8Array>>
): Record<string, Uint8Array> {
  validateSubmissionPackage(submission)
  const files: Record<string, Uint8Array> = {}
  const recordingKeys = new Set<string>()
  for (const [key, entry] of Object.entries(submission.resources)) {
    const recording = entry.packagePath.startsWith('recordings/')
    const source = recording ? recordings : examResources
    const data = source[key]
    if (!(data instanceof Uint8Array)) {
      throw invalidArchive(`Missing ${recording ? 'recording' : 'ExamPackage'} resource: ${key}`)
    }
    files[key] = data
    if (recording) recordingKeys.add(key)
  }
  if (Object.keys(recordings).some((key) => !recordingKeys.has(key))) {
    throw invalidArchive('Unused recording supplied for SubmissionPackage')
  }
  return files
}

export async function decodeSubmissionPackage(data: Uint8Array): Promise<SubmissionArchive> {
  const files = await unzipArchive(data)
  const submission = readJson<SubmissionPackage>(files, MANIFEST_PATH)
  validateSubmissionPackage(submission)
  const resources = readResources(files, submission.resources)
  return { submission, files: resources }
}

export function validateExamPackage(value: unknown): asserts value is ExamPackage {
  if (
    !isRecord(value) ||
    value.format !== 'ls101-exam' ||
    value.formatVersion !== 1 ||
    !nonEmptyString(value.packageId) ||
    !isRecord(value.examData) ||
    !nonEmptyString(value.examData.title) ||
    !isPlayerExamData(value.examData.player) ||
    !isResourceManifest(value.examData.resources, 'static') ||
    !isCapturePlan(value.answerCapturePlan) ||
    !isSubmissionTemplate(value.submissionTemplate)
  ) {
    throw invalidArchive('Invalid ExamPackage manifest')
  }

  const exam = value as unknown as ExamPackage
  if (exam.submissionTemplate.meta.examPackageId !== exam.packageId) {
    throw invalidArchive('SubmissionTemplate examPackageId does not match packageId')
  }
  if (exam.submissionTemplate.meta.examTitle !== exam.examData.title) {
    throw invalidArchive('SubmissionTemplate examTitle does not match examData.title')
  }
  validateCaptureSources(exam)
  validateTemplateAnswers(exam)
  validatePlayerReferences(exam)
  validateReferencedResources(exam.submissionTemplate.resources, exam.examData.resources)
  validateSchemaResourceReferences(
    exam.submissionTemplate.schemaUses,
    exam.submissionTemplate.resources
  )
}

export function validateSubmissionPackage(value: unknown): asserts value is SubmissionPackage {
  if (
    !isRecord(value) ||
    value.format !== 'ls101-submission' ||
    value.formatVersion !== 1 ||
    !isSubmissionMeta(value.meta) ||
    !isSubmissionAnswers(value.answers) ||
    !Array.isArray(value.schemaUses) ||
    !value.schemaUses.every(isSubmissionSchemaUse) ||
    !isResourceManifest(value.resources, 'either')
  ) {
    throw invalidArchive('Invalid SubmissionPackage manifest')
  }

  const submission = value as unknown as SubmissionPackage
  validateUniqueSchemaUseIds(submission.schemaUses)
  const stringCount = submission.answers.strings.length
  const audioCount = submission.answers.audios.length
  for (const use of submission.schemaUses) {
    validateSchemaAnswerIndices(use, stringCount, audioCount)
  }
  for (const audio of submission.answers.audios) {
    if (!Object.hasOwn(submission.resources, audio.resourceKey)) {
      throw invalidArchive(`Audio answer references missing resource: ${audio.resourceKey}`)
    }
    if (!submission.resources[audio.resourceKey].packagePath.startsWith('recordings/')) {
      throw invalidArchive(`Audio answer resource is outside recordings/: ${audio.resourceKey}`)
    }
  }
  validateSchemaResourceReferences(submission.schemaUses, submission.resources)
}

function validateCaptureSources(exam: ExamPackage): void {
  const choiceIndices = new Set(
    exam.examData.player.choiceMeta?.questions.map((question) => question.choiceIndex) ?? []
  )
  const recordingIndices = new Set(exam.examData.player.recordingIndices)
  for (const capture of exam.answerCapturePlan.strings) {
    if (!choiceIndices.has(capture.choiceIndex)) {
      throw invalidArchive(`Unknown choiceIndex in capture plan: ${capture.choiceIndex}`)
    }
  }
  for (const capture of exam.answerCapturePlan.audios) {
    if (!recordingIndices.has(capture.recordIndex)) {
      throw invalidArchive(`Unknown recordIndex in capture plan: ${capture.recordIndex}`)
    }
  }
}

function validateTemplateAnswers(exam: ExamPackage): void {
  const stringCount = exam.answerCapturePlan.strings.length
  const audioCount = exam.answerCapturePlan.audios.length
  for (const use of exam.submissionTemplate.schemaUses) {
    validateSchemaAnswerIndices(use, stringCount, audioCount)
  }
  validateUniqueSchemaUseIds(exam.submissionTemplate.schemaUses)
}

function validateUniqueSchemaUseIds(uses: readonly SubmissionSchemaUse[]): void {
  const ids = new Set<string>()
  for (const use of uses) {
    if (ids.has(use.instanceId)) {
      throw invalidArchive(`Duplicate SchemaUse instanceId: ${use.instanceId}`)
    }
    ids.add(use.instanceId)
  }
}

function validateReferencedResources(
  referenced: Readonly<Record<string, unknown>>,
  available: Readonly<Record<string, unknown>>
): void {
  for (const key of Object.keys(referenced)) {
    if (!Object.hasOwn(available, key)) {
      throw invalidArchive(`SubmissionTemplate references missing ExamPackage resource: ${key}`)
    }
  }
}

function validateSchemaResourceReferences(
  uses: readonly SubmissionSchemaUse[],
  resources: Readonly<Record<string, unknown>>
): void {
  for (const use of uses) {
    const texts = [
      ...use.inputs.map((input) => input.value),
      ...use.answers.flatMap((answer) => (answer.type === 'fixed-speech' ? [answer.text] : []))
    ]
    for (const text of texts) {
      for (const match of text.matchAll(/resource:([A-Za-z0-9][A-Za-z0-9_.:%-]*)/g)) {
        const key = match[1]
        if (!Object.hasOwn(resources, key)) {
          throw invalidArchive(`SchemaUse references missing resource: ${key}`)
        }
        const resource = resources[key]
        if (
          !isRecord(resource) ||
          typeof resource.packagePath !== 'string' ||
          !resource.packagePath.startsWith('resources/')
        ) {
          throw invalidArchive(`SchemaUse references non-static resource: ${key}`)
        }
      }
    }
  }
}

function validatePlayerReferences(exam: ExamPackage): void {
  const player = exam.examData.player
  const recordingIndices = new Set(player.recordingIndices)
  if (recordingIndices.size !== player.recordingIndices.length) {
    throw invalidArchive('Player recordingIndices contains duplicates')
  }
  const timelineRecordingIndices = new Set<number>()
  for (const page of player.pages) {
    const choiceViewIds = new Set(
      page.content.filter((block) => block.type === 'choice-view').map((block) => block.id)
    )
    for (const step of page.timeline) {
      if (step.type === 'play') {
        const key = resourceKey(step.src)
        if (key === null || !Object.hasOwn(exam.examData.resources, key)) {
          throw invalidArchive(`Player audio references missing resource: ${step.src}`)
        }
      }
      if (step.type === 'record') {
        if (timelineRecordingIndices.has(step.recordIndex)) {
          throw invalidArchive(`Duplicate recordIndex in timeline: ${step.recordIndex}`)
        }
        timelineRecordingIndices.add(step.recordIndex)
      }
      for (const id of Object.keys(step.choiceViewOverrides ?? {})) {
        if (!choiceViewIds.has(id)) {
          throw invalidArchive(`Timeline override references unknown choice view: ${id}`)
        }
      }
    }
  }
  if (
    recordingIndices.size !== timelineRecordingIndices.size ||
    [...recordingIndices].some((index) => !timelineRecordingIndices.has(index))
  ) {
    throw invalidArchive('Player recordingIndices does not match record timeline steps')
  }

  const questions = player.choiceMeta?.questions ?? []
  const choiceIndices = new Set(questions.map((question) => question.choiceIndex))
  if (choiceIndices.size !== questions.length) {
    throw invalidArchive('Player choiceMeta contains duplicate choiceIndex values')
  }
  for (const page of player.choiceMeta?.pages ?? []) {
    if (page.questionIndices.some((index) => !choiceIndices.has(index))) {
      throw invalidArchive('Choice page references an unknown question index')
    }
  }
  for (const page of player.pages) {
    for (const block of page.content) {
      if (block.type === 'image') {
        const key = resourceKey(block.src)
        if (key === null || !Object.hasOwn(exam.examData.resources, key)) {
          throw invalidArchive(`Player image references missing resource: ${block.src}`)
        }
      }
      if (block.type === 'choice-view')
        validateViewport(block.defaultViewport, choiceIndices, player)
    }
    for (const step of page.timeline) {
      for (const viewport of Object.values(step.choiceViewOverrides ?? {})) {
        validateViewport(viewport, choiceIndices, player)
      }
    }
  }
}

function validateViewport(
  viewport: ResolvedChoiceViewport,
  choiceIndices: ReadonlySet<number>,
  player: ExamPackage['examData']['player']
): void {
  if (viewport.mode === 'focus' && !choiceIndices.has(viewport.choiceIndex)) {
    throw invalidArchive(`Choice viewport references unknown choiceIndex: ${viewport.choiceIndex}`)
  }
  if (viewport.mode === 'range') {
    const pageCount = player.choiceMeta?.pages.length ?? 0
    if (
      viewport.startPage > viewport.endPage ||
      viewport.startPage >= pageCount ||
      viewport.endPage >= pageCount ||
      (viewport.initialPage !== undefined &&
        (viewport.initialPage < viewport.startPage || viewport.initialPage > viewport.endPage))
    ) {
      throw invalidArchive('Choice range viewport is outside choiceMeta pages')
    }
  }
  if (viewport.mode === 'free' && viewport.initialPage !== undefined) {
    const pageCount = player.choiceMeta?.pages.length ?? 0
    if (viewport.initialPage >= pageCount) {
      throw invalidArchive('Choice free viewport initialPage is outside choiceMeta pages')
    }
  }
}

function validateSchemaAnswerIndices(
  use: SubmissionSchemaUse,
  stringCount: number,
  audioCount: number
): void {
  for (const answer of use.answers) {
    const index = answerIndex(answer)
    const count = answer.type === 'text' ? stringCount : audioCount
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw invalidArchive(`SchemaUse answer index is outside its answer pool: ${use.instanceId}`)
    }
  }
}

function answerIndex(answer: SubmissionSchemaAnswer): number {
  return answer.type === 'text' ? answer.stringAnswerIndex : answer.audioAnswerIndex
}

function isSubmissionTemplate(value: unknown): value is ExamPackage['submissionTemplate'] {
  return (
    isRecord(value) &&
    value.format === 'ls101-submission' &&
    value.formatVersion === 1 &&
    isRecord(value.meta) &&
    nonEmptyString(value.meta.examPackageId) &&
    nonEmptyString(value.meta.examTitle) &&
    Array.isArray(value.schemaUses) &&
    value.schemaUses.every(isSubmissionSchemaUse) &&
    isResourceManifest(value.resources, 'static')
  )
}

function isSubmissionMeta(value: unknown): value is SubmissionPackage['meta'] {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.submissionId) ||
    !nonEmptyString(value.examPackageId) ||
    !nonEmptyString(value.examTitle) ||
    !isCandidate(value.candidate) ||
    !isIsoDate(value.startedAt) ||
    !isIsoDate(value.submittedAt)
  ) {
    return false
  }
  return Date.parse(value.submittedAt) >= Date.parse(value.startedAt)
}

function isCandidate(value: unknown): boolean {
  return isRecord(value) && nonEmptyString(value.candidateId) && nonEmptyString(value.displayName)
}

function isSubmissionAnswers(value: unknown): value is SubmissionPackage['answers'] {
  return (
    isRecord(value) &&
    Array.isArray(value.strings) &&
    value.strings.every((answer) => answer === null || typeof answer === 'string') &&
    Array.isArray(value.audios) &&
    value.audios.every(
      (answer) =>
        isRecord(answer) &&
        nonEmptyString(answer.resourceKey) &&
        typeof answer.durationMs === 'number' &&
        Number.isFinite(answer.durationMs) &&
        answer.durationMs >= 0
    )
  )
}

function isSubmissionSchemaUse(value: unknown): value is SubmissionSchemaUse {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.instanceId) ||
    !isSchemaDefinition(value.schema) ||
    !Array.isArray(value.inputs) ||
    !value.inputs.every(
      (input) =>
        isRecord(input) &&
        nonEmptyString(input.inputId) &&
        input.type === 'text' &&
        typeof input.value === 'string'
    ) ||
    !Array.isArray(value.answers)
  ) {
    return false
  }
  const schema = value.schema
  const answers = value.answers
  if (!isSchemaDefinition(schema) || !Array.isArray(answers)) return false
  const inputDefinitions = new Map(
    schema.structure.templateInputs.map((input) => [input.inputId, input])
  )
  const inputIds = new Set<string>()
  if (
    value.inputs.some((input) => {
      if (
        !isRecord(input) ||
        !nonEmptyString(input.inputId) ||
        inputIds.has(input.inputId) ||
        inputDefinitions.get(input.inputId)?.type !== input.type
      ) {
        return true
      }
      inputIds.add(input.inputId)
      return false
    }) ||
    schema.structure.templateInputs.some((input) => input.required && !inputIds.has(input.inputId))
  ) {
    return false
  }
  const definitions = new Map(
    schema.structure.answerFormat.map((answer) => [answer.answerId, answer.type])
  )
  const answerIds = new Set<string>()
  return (
    answers.length === definitions.size &&
    answers.every((answer) => {
      if (
        !isRecord(answer) ||
        !nonEmptyString(answer.answerId) ||
        answerIds.has(answer.answerId) ||
        definitions.get(answer.answerId) !== answer.type
      ) {
        return false
      }
      answerIds.add(answer.answerId)
      if (answer.type === 'text')
        return (
          typeof answer.stringAnswerIndex === 'number' &&
          Number.isInteger(answer.stringAnswerIndex) &&
          answer.stringAnswerIndex >= 0
        )
      if (answer.type === 'fixed-speech')
        return (
          typeof answer.text === 'string' &&
          typeof answer.audioAnswerIndex === 'number' &&
          Number.isInteger(answer.audioAnswerIndex) &&
          answer.audioAnswerIndex >= 0
        )
      return (
        typeof answer.audioAnswerIndex === 'number' &&
        Number.isInteger(answer.audioAnswerIndex) &&
        answer.audioAnswerIndex >= 0
      )
    })
  )
}

function isSchemaDefinition(value: unknown): value is SchemaDefinition {
  const parsed = parseSchemaDefinition(value)
  return parsed !== null && validateSchemaDefinition(parsed).valid
}

function isPlayerExamData(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.pages) || !Array.isArray(value.recordingIndices))
    return false
  if (value.pages.length === 0 || !value.pages.every(isExamPage)) return false
  if (
    !value.recordingIndices.every(
      (index) => typeof index === 'number' && Number.isInteger(index) && index >= 0
    )
  ) {
    return false
  }
  if (value.choiceMeta === undefined) return true
  return (
    isRecord(value.choiceMeta) &&
    Array.isArray(value.choiceMeta.pages) &&
    value.choiceMeta.pages.every(
      (page) =>
        isRecord(page) &&
        Array.isArray(page.questionIndices) &&
        page.questionIndices.every(
          (index) => typeof index === 'number' && Number.isInteger(index) && index >= 0
        )
    ) &&
    Array.isArray(value.choiceMeta.questions) &&
    value.choiceMeta.questions.every(
      (question) =>
        isRecord(question) &&
        typeof question.choiceIndex === 'number' &&
        Number.isInteger(question.choiceIndex) &&
        question.choiceIndex >= 0 &&
        typeof question.stem === 'string' &&
        Array.isArray(question.options) &&
        question.options.every(
          (option) =>
            isRecord(option) &&
            typeof option.label === 'string' &&
            /^[A-Z]$/.test(option.label) &&
            typeof option.content === 'string'
        )
    )
  )
}

function isExamPage(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonEmptyString(value.id) &&
    Array.isArray(value.content) &&
    value.content.every(isContentBlock) &&
    Array.isArray(value.timeline) &&
    value.timeline.length > 0 &&
    value.timeline.every(isTimelineStep)
  )
}

function isContentBlock(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !finiteNumber(value.x) ||
    !finiteNumber(value.y)
  ) {
    return false
  }
  if (value.type === 'text') {
    return (
      typeof value.text === 'string' &&
      optionalFiniteNumber(value.width) &&
      optionalFiniteNumber(value.fontSize) &&
      (value.bold === undefined || typeof value.bold === 'boolean') &&
      (value.align === undefined || ['left', 'center', 'right'].includes(value.align as string))
    )
  }
  if (value.type === 'image') {
    return finiteNumber(value.width) && finiteNumber(value.height) && nonEmptyString(value.src)
  }
  return (
    value.type === 'choice-view' &&
    finiteNumber(value.width) &&
    finiteNumber(value.height) &&
    isViewport(value.defaultViewport)
  )
}

function isTimelineStep(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    value.choiceViewOverrides !== undefined &&
    (!isRecord(value.choiceViewOverrides) ||
      !Object.values(value.choiceViewOverrides).every(isViewport))
  ) {
    return false
  }
  if (value.type === 'play') return nonEmptyString(value.src)
  if (value.type === 'countdown') return finiteNumber(value.seconds) && value.seconds >= 0
  return (
    value.type === 'record' &&
    finiteNumber(value.duration) &&
    value.duration > 0 &&
    typeof value.recordIndex === 'number' &&
    Number.isInteger(value.recordIndex) &&
    value.recordIndex >= 0
  )
}

function isViewport(value: unknown): value is ResolvedChoiceViewport {
  if (!isRecord(value)) return false
  if (value.mode === 'free') return optionalNonNegativeInteger(value.initialPage)
  if (value.mode === 'focus') return nonNegativeInteger(value.choiceIndex)
  return (
    value.mode === 'range' &&
    nonNegativeInteger(value.startPage) &&
    nonNegativeInteger(value.endPage) &&
    optionalNonNegativeInteger(value.initialPage)
  )
}

function isCapturePlan(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.strings) || !Array.isArray(value.audios))
    return false
  return (
    isCaptureEntries(value.strings, 'stringAnswerIndex', 'choiceIndex') &&
    isCaptureEntries(value.audios, 'audioAnswerIndex', 'recordIndex')
  )
}

function isCaptureEntries(entries: unknown[], targetField: string, sourceField: string): boolean {
  const targets = new Set<number>()
  const sources = new Set<number>()
  for (const entry of entries) {
    if (!isRecord(entry)) return false
    const target = entry[targetField]
    const source = entry[sourceField]
    if (
      typeof target !== 'number' ||
      !Number.isInteger(target) ||
      target < 0 ||
      target >= entries.length ||
      typeof source !== 'number' ||
      !Number.isInteger(source) ||
      source < 0 ||
      targets.has(target) ||
      sources.has(source)
    ) {
      return false
    }
    targets.add(target)
    sources.add(source)
  }
  return true
}

function isResourceManifest(value: unknown, pathKind: ResourcePathKind): boolean {
  if (!isRecord(value)) return false
  const paths = new Set<string>()
  return Object.entries(value).every(([key, entry]) => {
    if (
      !SAFE_RESOURCE_KEY.test(key) ||
      !isResourceEntry(entry, pathKind) ||
      paths.has(entry.packagePath)
    ) {
      return false
    }
    paths.add(entry.packagePath)
    return true
  })
}

function isResourceEntry(
  value: unknown,
  pathKind: ResourcePathKind
): value is { filename: string; packagePath: string; mediaType?: string } {
  return (
    isRecord(value) &&
    nonEmptyString(value.filename) &&
    !/[\\/]/.test(value.filename) &&
    safePath(value.packagePath) &&
    canonicalUrlPath(value.packagePath) &&
    value.packagePath !== MANIFEST_PATH &&
    matchesResourcePathKind(value.packagePath, pathKind) &&
    value.packagePath.endsWith(`/${encodeURIComponent(value.filename)}`) &&
    (value.mediaType === undefined || typeof value.mediaType === 'string')
  )
}

function matchesResourcePathKind(packagePath: string, pathKind: ResourcePathKind): boolean {
  if (pathKind === 'static') return packagePath.startsWith('resources/')
  return packagePath.startsWith('resources/') || packagePath.startsWith('recordings/')
}

function resourceKey(value: string): string | null {
  return RESOURCE_URI.exec(value)?.[1] ?? null
}

function resourceFiles(
  manifest: Readonly<Record<string, { filename: string; packagePath: string }>>,
  files: Readonly<Record<string, Uint8Array>>
): Record<string, Uint8Array> {
  const archiveFiles: Record<string, Uint8Array> = {}
  const expectedKeys = Object.keys(manifest)
  if (Object.keys(files).some((key) => !Object.hasOwn(manifest, key))) {
    throw invalidArchive('Archive contains a file without a manifest resource entry')
  }
  const paths = new Set<string>()
  for (const key of expectedKeys) {
    const data = files[key]
    if (!(data instanceof Uint8Array)) throw invalidArchive(`Missing resource bytes: ${key}`)
    const path = manifest[key].packagePath
    if (paths.has(path)) throw invalidArchive(`Duplicate resource path: ${path}`)
    paths.add(path)
    archiveFiles[path] = data
  }
  return archiveFiles
}

function readResources(
  files: Record<string, Uint8Array>,
  manifest: Readonly<Record<string, { packagePath: string }>>
): Record<string, Uint8Array> {
  const resources: Record<string, Uint8Array> = {}
  const expectedPaths = new Set<string>([MANIFEST_PATH])
  const paths = new Set<string>()
  for (const [key, entry] of Object.entries(manifest)) {
    if (paths.has(entry.packagePath))
      throw invalidArchive(`Duplicate resource path: ${entry.packagePath}`)
    paths.add(entry.packagePath)
    expectedPaths.add(entry.packagePath)
    if (!files[entry.packagePath]) throw invalidArchive(`Missing resource file: ${key}`)
    resources[key] = files[entry.packagePath]
  }
  for (const path of Object.keys(files)) {
    if (!expectedPaths.has(path)) throw invalidArchive(`Unexpected file in archive: ${path}`)
  }
  return resources
}

function validatePaths(files: Record<string, Uint8Array>): void {
  if (Object.keys(files).length > MAX_FILES) throw invalidArchive('Archive contains too many files')
  let totalBytes = 0
  for (const path of Object.keys(files)) {
    totalBytes += files[path].byteLength
    if (totalBytes > MAX_UNCOMPRESSED_BYTES)
      throw invalidArchive('Archive is too large after decompression')
    if (!safePath(path)) throw invalidArchive(`Unsafe archive path: ${path}`)
  }
}

function safePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.includes('\\') &&
    !path.startsWith('/') &&
    path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  )
}

function canonicalUrlPath(path: string): boolean {
  try {
    const resolved = new URL(path, PACKAGE_URL_ROOT)
    return resolved.search === '' && resolved.hash === '' && resolved.pathname === `/${path}`
  } catch {
    return false
  }
}

function readJson<T>(files: Record<string, Uint8Array>, path: string): T {
  const data = files[path]
  if (!data) throw invalidArchive(`Missing required file: ${path}`)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as T
  } catch {
    throw invalidArchive(`Invalid UTF-8 JSON file: ${path}`)
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`)
}

function encodeArchive(
  manifest: ExamPackage | SubmissionPackage,
  resourceEntries: Record<string, Uint8Array>
): Promise<Uint8Array> {
  const files = { [MANIFEST_PATH]: jsonBytes(manifest), ...resourceEntries }
  validatePaths(files)
  return zipAsync(files)
}

function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data)))
  })
}

function unzipArchive(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  if (!(data instanceof Uint8Array))
    return Promise.reject(invalidArchive('Archive must be binary data'))
  let fileCount = 0
  let totalBytes = 0
  return new Promise((resolve, reject) => {
    unzip(
      data,
      {
        filter(file) {
          fileCount += 1
          totalBytes += file.originalSize
          return fileCount <= MAX_FILES && totalBytes <= MAX_UNCOMPRESSED_BYTES
        }
      },
      (error, files) => {
        if (error) return reject(invalidArchive(`Cannot read archive: ${error.message}`))
        if (fileCount > MAX_FILES) return reject(invalidArchive('Archive contains too many files'))
        if (totalBytes > MAX_UNCOMPRESSED_BYTES)
          return reject(invalidArchive('Archive is too large after decompression'))
        if (fileCount !== Object.keys(files).length)
          return reject(invalidArchive('Archive contains duplicate file paths'))
        try {
          validatePaths(files)
          resolve(files)
        } catch (validationError) {
          reject(validationError)
        }
      }
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
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

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || finiteNumber(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || nonNegativeInteger(value)
}

function invalidArchive(message: string): ExamPackageArchiveError {
  return new ExamPackageArchiveError(message)
}
