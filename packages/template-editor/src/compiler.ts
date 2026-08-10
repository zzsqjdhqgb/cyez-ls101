import type { ExamPackage } from '@ls101/core-types'
import type { TemplateContent, TemplateDocument } from './types'
import { validateTemplateDocument } from './validation'
import { instantiateTemplate } from './compiler/expand'
import {
  CompileFailure,
  compileError,
  createCompilerState,
  manifestMap,
  type BoundInterfaceValue,
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
    const usedSchemaIds = new Set(schemaBlocks.map((block) => block.schemaId))
    const candidate = structure.candidates[0]

    const examPackage: ExamPackage = {
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
      schema: {
        definitions: context.schemaDefinitions.filter((schema) =>
          usedSchemaIds.has(schema.schemaId)
        ),
        uses: schemaBlocks
      },
      resources: Object.fromEntries(state.resources)
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
