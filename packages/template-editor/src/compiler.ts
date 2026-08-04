import type { ExamPackage } from '@ls101/core-types'
import type { TemplateContent } from './types'
import { validateTemplateContent } from './validation'
import { instantiateTemplate } from './compiler/expand'
import {
  CompileFailure,
  compileError,
  createCompilerState,
  manifestMap,
  type BoundInterfaceValue,
  type TemplateCompileContext,
  type TemplateCompileError,
  type TemplateCompileResult
} from './compiler/shared'

export type {
  TemplateCompileContext,
  TemplateCompileError,
  TemplateCompileErrorCode,
  TemplateCompileResult,
  TemplateInterfaceBinding
} from './compiler/shared'

export function compileTemplate(
  content: TemplateContent,
  context: TemplateCompileContext
): TemplateCompileResult {
  const validation = validateTemplateContent(content, context)
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors.map((error) => ({ stage: 'validation', error }))
    }
  }

  const bound = bindInterfaceValues(content, context)
  if (bound.errors.length > 0) return { success: false, errors: bound.errors }

  const state = createCompilerState(context, bound.valuesByAlias)
  try {
    const structure = instantiateTemplate(content, state)
    state.staticCells.forEach((cell) => cell.get())

    const pages = state.pages.map((resolve) => resolve())
    const questions = state.questions.map((resolve) => resolve())
    const schemaUsages = state.schemaUsages.map((resolve) => resolve())
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
      schema: { usages: schemaUsages }
    }
    return { success: true, examPackage }
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

function bindInterfaceValues(
  content: TemplateContent,
  context: TemplateCompileContext
): BoundInterfaceResult {
  const valuesByAlias = new Map<string, Map<string, BoundInterfaceValue>>()
  const errors: TemplateCompileError[] = []
  const bindings = new Map<string, TemplateCompileContext['interfaceBindings'][number]>()
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
    bindings.set(binding.alias, binding)
    if (!requirements.has(binding.alias)) {
      errors.push(
        compileError('UNKNOWN_INTERFACE_BINDING', `interfaceBindings[${index}].alias`, {
          alias: binding.alias
        })
      )
    }
  })

  content.interfaces.forEach((requirement, index) => {
    const binding = bindings.get(requirement.alias)
    const path = `interfaces[${index}]`
    if (!binding) {
      errors.push(compileError('MISSING_INTERFACE_BINDING', path, { alias: requirement.alias }))
      return
    }
    if (binding.interfaceId !== requirement.interfaceId) {
      errors.push(
        compileError('INTERFACE_BINDING_ID_MISMATCH', `${path}.interfaceId`, {
          alias: requirement.alias,
          expected: requirement.interfaceId,
          actual: binding.interfaceId
        })
      )
      return
    }

    const manifest = manifests.get(requirement.interfaceId)
    const values = new Map<string, BoundInterfaceValue>()
    requirement.acceptedVars.forEach((varName) => {
      if (!Object.hasOwn(binding.instance.values, varName)) {
        errors.push(
          compileError('MISSING_INTERFACE_VALUE', `${path}.acceptedVars`, {
            alias: requirement.alias,
            instanceId: binding.instance.instanceId,
            varName
          })
        )
        return
      }
      const variable = manifest?.vars.find((item) => item.varName === varName)
      values.set(varName, {
        type: variable?.type === 'image' ? 'file' : 'string',
        value: binding.instance.values[varName]
      })
    })
    valuesByAlias.set(requirement.alias, values)
  })

  return { valuesByAlias, errors }
}
