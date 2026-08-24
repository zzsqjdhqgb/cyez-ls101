import type {
  AnswerCapturePlan,
  ExamPage,
  ExamPackage,
  SchemaDefinition,
  SubmissionSchemaAnswer,
  SubmissionSchemaUse
} from '@ls101/core-types'
import type { TemplateContent, TemplateDocument } from './types'
import { validateTemplateDocument } from './validation'
import { instantiateTemplate } from './compiler/expand'
import {
  CompileFailure,
  compileError,
  createCompilerState,
  manifestMap,
  type BoundInterfaceValue,
  type ExpandedExamPage,
  type ExpandedSchemaUse,
  type ExamResourceSource,
  type TemplateCompileContext,
  type TemplateCompileError,
  type TemplateCompileResult,
  type TemplatePreviewResult,
  type TemplatePreviewTimelineStep
} from './compiler/shared'

export type {
  TemplateCompileContext,
  TemplateCompileError,
  TemplateCompileErrorCode,
  TemplateCompileResult,
  GeneratedTimelineAudio,
  ExamResourceSource,
  TemplateInterfaceBinding,
  LocatedInterfaceInstance
} from './compiler/shared'

export type {
  TemplatePreviewData,
  TemplatePreviewPage,
  TemplatePreviewResult,
  TemplatePreviewTimelineStep
} from './compiler/shared'

export async function compileTemplatePreview(
  template: TemplateDocument,
  context: TemplateCompileContext
): Promise<TemplatePreviewResult> {
  const validation = await validateTemplateDocument(template, context)
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors.map((error) => ({ stage: 'validation', error }))
    }
  }

  const bound = await bindInterfaceValues(template.content, context)
  if (bound.errors.length > 0) return { success: false, errors: bound.errors }

  const state = createCompilerState(context, bound.valuesByAlias, template.resources.functions)
  try {
    const structure = instantiateTemplate(template.content, state)
    state.choiceGroupCells.forEach((cell) => cell.get())
    state.staticCells.forEach((cell) => cell.get())

    const expandedPages = state.pages.map((resolve) => resolve())
    if (expandedPages.length === 0) {
      throw new CompileFailure(compileError('EMPTY_PLAYER_PAGES', 'root'))
    }
    validateResolvedRecordings(expandedPages)
    const questions = state.questions.map((resolve) => resolve())
    state.schemaUsages.forEach((resolve) => resolve())
    const candidate = structure.candidates[0]

    return {
      success: true,
      preview: {
        title: template.content.name,
        pages: expandedPages.map((page) => ({
          id: page.id,
          sourceNodeId: page.sourceNodeId,
          ...(page.sourceNodeName ? { sourceNodeName: page.sourceNodeName } : {}),
          callPath: page.callPath,
          content: page.content,
          timeline: page.timeline.map(toPreviewTimelineStep)
        })),
        recordingIndices: state.recordingIndices,
        ...(candidate
          ? {
              choiceMeta: {
                pages: candidate.pages.map((questionIndices) => ({ questionIndices })),
                questions
              }
            }
          : {}),
        resources: Object.fromEntries(state.resources)
      },
      resourceSources: Array.from(state.resourceSources, ([assetKey, sourceUrl]) => ({
        assetKey,
        sourceUrl
      }))
    }
  } catch (error) {
    if (error instanceof CompileFailure) {
      return { success: false, errors: [error.compileError] }
    }
    throw error
  }
}

export async function compileTemplate(
  template: TemplateDocument,
  context: TemplateCompileContext
): Promise<TemplateCompileResult> {
  const validation = await validateTemplateDocument(template, context)
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors.map((error) => ({ stage: 'validation', error }))
    }
  }

  const content = template.content
  const bound = await bindInterfaceValues(content, context)
  if (bound.errors.length > 0) return { success: false, errors: bound.errors }

  const state = createCompilerState(context, bound.valuesByAlias, template.resources.functions)
  try {
    const structure = instantiateTemplate(content, state)
    state.choiceGroupCells.forEach((cell) => cell.get())
    state.staticCells.forEach((cell) => cell.get())

    const expandedPages = state.pages.map((resolve) => resolve())
    if (expandedPages.length === 0) {
      throw new CompileFailure(compileError('EMPTY_PLAYER_PAGES', 'root'))
    }
    const generatedSources: ExamResourceSource[] = []
    const pages = await compileTimelineAudio(
      expandedPages,
      context,
      state.resources,
      generatedSources
    )
    const questions = state.questions.map((resolve) => resolve())
    const schemaBlocks = state.schemaUsages.map((resolve) => resolve())
    const candidate = structure.candidates[0]
    const packageId = crypto.randomUUID()
    const resources = Object.fromEntries(state.resources)
    const submissionResources = Object.fromEntries(
      [...state.resources].filter(([assetKey]) => state.submissionResourceKeys.has(assetKey))
    )
    const submission = buildSubmissionSnapshot(
      packageId,
      content.name,
      schemaBlocks,
      state.schemasById,
      submissionResources
    )

    const examPackage: ExamPackage = {
      format: 'ls101-exam',
      formatVersion: 1,
      packageId,
      examData: {
        title: content.name,
        player: {
          pages,
          recordingIndices: state.recordingIndices,
          ...(candidate
            ? {
                choiceMeta: {
                  pages: candidate.pages.map((questionIndices) => ({ questionIndices })),
                  questions
                }
              }
            : {})
        },
        resources
      },
      answerCapturePlan: submission.answerCapturePlan,
      submissionTemplate: submission.template
    }
    const resourceSources: ExamResourceSource[] = Array.from(
      state.resourceSources,
      ([assetKey, sourceUrl]) => ({ assetKey, sourceUrl })
    )
    return {
      success: true,
      examPackage,
      resourceSources: [...resourceSources, ...generatedSources]
    }
  } catch (error) {
    if (error instanceof CompileFailure) {
      return { success: false, errors: [error.compileError] }
    }
    throw error
  }
}

async function compileTimelineAudio(
  pages: readonly ExpandedExamPage[],
  context: TemplateCompileContext,
  resources: Map<string, ExamPackage['examData']['resources'][string]>,
  sources: ExamResourceSource[]
): Promise<ExamPage[]> {
  const compiled: ExamPage[] = []
  for (const [pageIndex, page] of pages.entries()) {
    const timeline: ExamPage['timeline'] = []
    for (const [stepIndex, step] of page.timeline.entries()) {
      if (step.type !== 'play') {
        if (step.type === 'record') {
          if (!Number.isFinite(step.duration) || step.duration <= 0) {
            throw new CompileFailure(
              compileError('INVALID_RECORDING_DURATION', step.sourcePath, {
                value: step.duration
              })
            )
          }
          timeline.push({
            type: 'record',
            duration: step.duration,
            recordIndex: step.recordIndex,
            ...(step.choiceViewOverrides ? { choiceViewOverrides: step.choiceViewOverrides } : {})
          })
        } else {
          timeline.push(step)
        }
        continue
      }
      if (!context.synthesizeSpeech) {
        throw new CompileFailure(compileError('SPEECH_SYNTHESIZER_MISSING', step.sourcePath))
      }

      let audio: Awaited<ReturnType<NonNullable<TemplateCompileContext['synthesizeSpeech']>>>
      try {
        audio = await context.synthesizeSpeech(step.text)
      } catch (error) {
        throw new CompileFailure(
          compileError('SPEECH_SYNTHESIS_FAILED', step.sourcePath, {
            message: error instanceof Error ? error.message : String(error)
          })
        )
      }
      if (
        !audio ||
        !(audio.data instanceof Uint8Array) ||
        audio.data.byteLength === 0 ||
        typeof audio.mediaType !== 'string' ||
        !audio.mediaType.toLowerCase().startsWith('audio/')
      ) {
        throw new CompileFailure(compileError('INVALID_SYNTHESIZED_AUDIO', step.sourcePath))
      }

      const assetKey = `player-tts-${encodeURIComponent(page.id)}-${stepIndex}`
      const filename = `speech-${pageIndex}-${stepIndex}.${speechExtension(audio.mediaType)}`
      resources.set(assetKey, {
        filename,
        packagePath: `resources/${assetKey}/${filename}`,
        mediaType: audio.mediaType
      })
      sources.push({ assetKey, data: audio.data })
      timeline.push({
        type: 'play',
        src: `resource:${assetKey}`,
        ...(step.choiceViewOverrides ? { choiceViewOverrides: step.choiceViewOverrides } : {})
      })
    }
    compiled.push({ id: page.id, content: page.content, timeline })
  }
  return compiled
}

function toPreviewTimelineStep(
  step: ExpandedExamPage['timeline'][number]
): TemplatePreviewTimelineStep {
  const choiceViewOverrides = step.choiceViewOverrides
  if (step.type === 'play') {
    return {
      type: 'play',
      text: step.text,
      ...(choiceViewOverrides ? { choiceViewOverrides } : {})
    }
  }
  if (step.type === 'countdown') {
    return {
      type: 'countdown',
      seconds: step.seconds,
      ...(choiceViewOverrides ? { choiceViewOverrides } : {})
    }
  }
  return {
    type: 'record',
    duration: step.duration,
    recordIndex: step.recordIndex,
    ...(choiceViewOverrides ? { choiceViewOverrides } : {})
  }
}

function validateResolvedRecordings(pages: readonly ExpandedExamPage[]): void {
  pages.forEach((page) => {
    page.timeline.forEach((step) => {
      if (step.type === 'record' && (!Number.isFinite(step.duration) || step.duration <= 0)) {
        throw new CompileFailure(
          compileError('INVALID_RECORDING_DURATION', step.sourcePath, { value: step.duration })
        )
      }
    })
  })
}

function speechExtension(mediaType: string): string {
  switch (mediaType.toLowerCase().split(';', 1)[0]) {
    case 'audio/wav':
    case 'audio/wave':
      return 'wav'
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/ogg':
    case 'audio/opus':
      return 'ogg'
    case 'audio/mp4':
      return 'm4a'
    default:
      return 'bin'
  }
}

function buildSubmissionSnapshot(
  packageId: string,
  examTitle: string,
  expandedUses: readonly ExpandedSchemaUse[],
  schemasById: ReadonlyMap<string, SchemaDefinition>,
  resources: ExamPackage['examData']['resources']
): {
  answerCapturePlan: AnswerCapturePlan
  template: ExamPackage['submissionTemplate']
} {
  const stringIndices = new Map<number, number>()
  const audioIndices = new Map<number, number>()
  const answerCapturePlan: AnswerCapturePlan = { strings: [], audios: [] }

  const stringAnswerIndex = (choiceIndex: number): number => {
    const existing = stringIndices.get(choiceIndex)
    if (existing !== undefined) return existing
    const index = stringIndices.size
    stringIndices.set(choiceIndex, index)
    answerCapturePlan.strings.push({ stringAnswerIndex: index, choiceIndex })
    return index
  }

  const audioAnswerIndex = (recordIndex: number): number => {
    const existing = audioIndices.get(recordIndex)
    if (existing !== undefined) return existing
    const index = audioIndices.size
    audioIndices.set(recordIndex, index)
    answerCapturePlan.audios.push({ audioAnswerIndex: index, recordIndex })
    return index
  }

  const schemaUses = expandedUses.map<SubmissionSchemaUse>((use) => {
    const schema = schemasById.get(use.schemaId)
    if (!schema) throw new Error(`Schema disappeared during compilation: ${use.schemaId}`)

    const answers = use.answers.map<SubmissionSchemaAnswer>((answer) => {
      switch (answer.type) {
        case 'text':
          return {
            answerId: answer.answerId,
            type: answer.type,
            stringAnswerIndex: stringAnswerIndex(answer.choiceIndex)
          }
        case 'fixed-speech':
          return {
            answerId: answer.answerId,
            type: answer.type,
            text: answer.text,
            audioAnswerIndex: audioAnswerIndex(answer.recordIndex)
          }
        case 'free-speech':
          return {
            answerId: answer.answerId,
            type: answer.type,
            audioAnswerIndex: audioAnswerIndex(answer.recordIndex)
          }
      }
    })

    return {
      instanceId: use.instanceId,
      schema: structuredClone(schema),
      inputs: structuredClone(use.inputs),
      answers
    }
  })

  return {
    answerCapturePlan,
    template: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: packageId, examTitle },
      schemaUses,
      resources: structuredClone(resources)
    }
  }
}

interface BoundInterfaceResult {
  valuesByAlias: Map<string, Map<string, BoundInterfaceValue>>
  errors: TemplateCompileError[]
}

async function bindInterfaceValues(
  content: TemplateContent,
  context: TemplateCompileContext
): Promise<BoundInterfaceResult> {
  const valuesByAlias = new Map<string, Map<string, BoundInterfaceValue>>()
  const errors: TemplateCompileError[] = []
  const bindings = new Map<
    string,
    { binding: TemplateCompileContext['interfaceBindings'][number]; index: number }
  >()
  const requirements = new Map(
    content.interfaces.map((requirement) => [requirement.alias, requirement])
  )
  const manifests = manifestMap(context.interfaceManifests)

  context.interfaceBindings.forEach((binding, index) => {
    if (bindings.has(binding.alias)) {
      errors.push(
        compileError('DUPLICATE_INTERFACE_BINDING', `interfaceBindings[${index}].alias`, {
          alias: binding.alias
        })
      )
      return
    }
    bindings.set(binding.alias, { binding, index })
    if (!requirements.has(binding.alias)) {
      errors.push(
        compileError('UNKNOWN_INTERFACE_BINDING', `interfaceBindings[${index}].alias`, {
          alias: binding.alias
        })
      )
    }
  })

  for (const [index, requirement] of content.interfaces.entries()) {
    const bindingEntry = bindings.get(requirement.alias)
    const path = `interfaces[${index}]`
    if (!bindingEntry) {
      errors.push(compileError('MISSING_INTERFACE_BINDING', path, { alias: requirement.alias }))
      continue
    }
    const { binding, index: bindingIndex } = bindingEntry
    if (binding.interfaceId !== requirement.interfaceId) {
      errors.push(
        compileError(
          'INTERFACE_BINDING_ID_MISMATCH',
          `interfaceBindings[${bindingIndex}].interfaceId`,
          {
            alias: requirement.alias,
            expected: requirement.interfaceId,
            actual: binding.interfaceId
          }
        )
      )
      continue
    }

    const located = await context.locateInterfaceInstance(binding.instanceId)
    if (!located) {
      errors.push(
        compileError(
          'INTERFACE_INSTANCE_NOT_FOUND',
          `interfaceBindings[${bindingIndex}].instanceId`,
          {
            alias: requirement.alias,
            instanceId: binding.instanceId
          }
        )
      )
      continue
    }
    if (located.interfaceId !== requirement.interfaceId) {
      errors.push(
        compileError(
          'INTERFACE_BINDING_ID_MISMATCH',
          `interfaceBindings[${bindingIndex}].instanceId`,
          {
            alias: requirement.alias,
            instanceId: binding.instanceId,
            expected: requirement.interfaceId,
            actual: located.interfaceId
          }
        )
      )
      continue
    }

    const manifest = manifests.get(requirement.interfaceId)
    const incompleteVariables =
      manifest?.vars.filter(({ varName, type }) => {
        const value = located.instance.values[varName]
        if (typeof value !== 'string' || !value.trim()) return true
        return type === 'image' && !Object.hasOwn(located.assetUrls, value)
      }) ?? []
    if (incompleteVariables.length > 0) {
      incompleteVariables.forEach(({ varName }) => {
        errors.push(
          compileError('MISSING_INTERFACE_VALUE', `interfaceBindings[${bindingIndex}].instanceId`, {
            alias: requirement.alias,
            instanceId: binding.instanceId,
            varName
          })
        )
      })
      continue
    }
    const values = new Map<string, BoundInterfaceValue>()
    requirement.acceptedVars.forEach((varName) => {
      if (!Object.hasOwn(located.instance.values, varName)) {
        errors.push(
          compileError('MISSING_INTERFACE_VALUE', `${path}.acceptedVars`, {
            alias: requirement.alias,
            instanceId: binding.instanceId,
            varName
          })
        )
        return
      }
      const variable = manifest?.vars.find((item) => item.varName === varName)
      values.set(varName, {
        type: variable?.type === 'image' ? 'file' : 'string',
        value: located.instance.values[varName],
        ...(variable?.type === 'image'
          ? { sourceUrl: located.assetUrls[located.instance.values[varName]] }
          : {})
      })
    })
    valuesByAlias.set(requirement.alias, values)
  }

  return { valuesByAlias, errors }
}
