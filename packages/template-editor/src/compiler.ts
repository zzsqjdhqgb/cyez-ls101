import type {
  AnswerCapturePlan,
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
  type ExpandedSchemaUse,
  type ExamResourceSource,
  type TemplateCompileContext,
  type TemplateCompileError,
  type TemplateCompileResult
} from './compiler/shared'

export type {
  TemplateCompileContext,
  TemplateCompileError,
  TemplateCompileErrorCode,
  TemplateCompileResult,
  ExamResourceSource,
  TemplateInterfaceBinding,
  LocatedInterfaceInstance
} from './compiler/shared'

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
    state.staticCells.forEach((cell) => cell.get())

    const pages = state.pages.map((resolve) => resolve())
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
    return { success: true, examPackage, resourceSources }
  } catch (error) {
    if (error instanceof CompileFailure) {
      return { success: false, errors: [error.compileError] }
    }
    throw error
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
