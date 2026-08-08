import type { InterfaceVarManifest, SchemaBlockManifest } from '@ls101/core-types'
import type { FunctionDef, TemplateContent, TemplateValueType } from '../types'

export interface TemplateValidationContext {
  interfaceManifests: readonly InterfaceVarManifest[]
  schemaManifests: readonly SchemaBlockManifest[]
  functions: readonly FunctionDef[]
}

/** TemplateDocument 已自带函数资源，调用方只需提供跨模块清单。 */
export type TemplateDocumentValidationContext = Omit<TemplateValidationContext, 'functions'>

export type TemplateValidationErrorCode =
  | 'EMPTY_TEMPLATE_NAME'
  | 'DUPLICATE_INTERFACE_MANIFEST'
  | 'DUPLICATE_SCHEMA_MANIFEST'
  | 'DUPLICATE_FUNCTION_DEF'
  | 'INVALID_FUNCTION_RESOURCE_ID'
  | 'FUNCTION_RESOURCE_ID_MISMATCH'
  | 'INVALID_INTERFACE_ALIAS'
  | 'DUPLICATE_INTERFACE_ALIAS'
  | 'UNKNOWN_INTERFACE'
  | 'EMPTY_ACCEPTED_VARS'
  | 'DUPLICATE_ACCEPTED_VAR'
  | 'UNKNOWN_INTERFACE_VAR'
  | 'INTERFACE_VAR_NOT_ACCEPTED'
  | 'EMPTY_NODE_ID'
  | 'DUPLICATE_NODE_ID'
  | 'EMPTY_CONTENT_BLOCK_ID'
  | 'DUPLICATE_CONTENT_BLOCK_ID'
  | 'UNKNOWN_CHOICE_VIEW_OVERRIDE'
  | 'INVALID_LOCAL_NAME'
  | 'DUPLICATE_LOCAL_NAME'
  | 'UNKNOWN_LOCAL_VARIABLE'
  | 'UNKNOWN_INTERFACE_ALIAS'
  | 'INTERFACE_VARIABLE_IN_FUNCTION'
  | 'EXPRESSION_TYPE_MISMATCH'
  | 'UNKNOWN_FUNCTION'
  | 'RECURSIVE_FUNCTION_CALL'
  | 'MISSING_FUNCTION_INPUT'
  | 'UNKNOWN_FUNCTION_INPUT'
  | 'MISSING_FUNCTION_OUTPUT_NAME'
  | 'UNKNOWN_FUNCTION_OUTPUT_NAME'
  | 'INVALID_CHOICE_OPTION_COUNT'
  | 'EMPTY_CHOICE_OPTION_ID'
  | 'DUPLICATE_CHOICE_OPTION_ID'
  | 'INVALID_SCHEMA_USE_ID'
  | 'DUPLICATE_SCHEMA_USE_ID'
  | 'UNKNOWN_SCHEMA'
  | 'UNKNOWN_SCHEMA_BLOCK'
  | 'MISSING_SCHEMA_BINDING'
  | 'UNKNOWN_SCHEMA_BINDING'
  | 'SCHEMA_BINDING_TYPE_MISMATCH'
  | 'NO_SCHEMA_USE'
  | 'EMPTY_CHOICE_COLLECTOR'
  | 'EMPTY_CHOICE_COLLECTOR_PAGES'
  | 'INVALID_CHOICE_PAGE_SIZE'
  | 'CHOICE_PAGE_TOTAL_MISMATCH'
  | 'NESTED_CHOICE_COLLECTOR'
  | 'MULTIPLE_CHOICE_COLLECTORS'
  | 'UNCOLLECTED_CHOICE_QUESTIONS'
  | 'CHOICE_VIEW_WITHOUT_META'
  | 'FUNCTION_CHOICE_VIEW_WITHOUT_LOCAL_COLLECTOR'
  | 'INVALID_CHOICE_VIEWPORT'
  | 'EMPTY_FOCUS_REFERENCE'
  | 'INVALID_FOCUS_CALL_PATH'

export interface TemplateValidationError {
  path: string
  code: TemplateValidationErrorCode
  params: Readonly<Record<string, string | number>>
}

export interface TemplateValidationResult {
  readonly valid: boolean
  readonly errors: readonly TemplateValidationError[]
}

export interface ValidationState {
  errors: TemplateValidationError[]
  interfacesById: Map<string, InterfaceVarManifest>
  schemasById: Map<string, SchemaBlockManifest>
  functionsById: Map<string, FunctionDef>
  requirementsByAlias: Map<string, RequirementState>
  schemaUseCount: number
}

interface RequirementState {
  acceptedVars: Set<string>
  manifest?: InterfaceVarManifest
}

export interface LocalSymbol {
  type: TemplateValueType
}

export interface ScopeState {
  symbols: Map<string, LocalSymbol>
  usedNames: Map<string, string>
  nodeIds: Map<string, string>
  interfaceVariablesAllowed: boolean
}

const LOCAL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

export function createValidationState(context: TemplateValidationContext): ValidationState {
  const state: ValidationState = {
    errors: [],
    interfacesById: new Map(),
    schemasById: new Map(),
    functionsById: new Map(),
    requirementsByAlias: new Map(),
    schemaUseCount: 0
  }

  indexUnique(
    context.interfaceManifests,
    (manifest) => manifest.interfaceId,
    state.interfacesById,
    'context.interfaceManifests',
    'DUPLICATE_INTERFACE_MANIFEST',
    state
  )
  indexUnique(
    context.schemaManifests,
    (manifest) => manifest.schemaId,
    state.schemasById,
    'context.schemaManifests',
    'DUPLICATE_SCHEMA_MANIFEST',
    state
  )
  indexUnique(
    context.functions,
    (func) => func.id,
    state.functionsById,
    'context.functions',
    'DUPLICATE_FUNCTION_DEF',
    state
  )

  return state
}

function indexUnique<T>(
  values: readonly T[],
  getId: (value: T) => string,
  target: Map<string, T>,
  path: string,
  code: 'DUPLICATE_INTERFACE_MANIFEST' | 'DUPLICATE_SCHEMA_MANIFEST' | 'DUPLICATE_FUNCTION_DEF',
  state: ValidationState
): void {
  values.forEach((value, index) => {
    const id = getId(value)
    if (target.has(id)) {
      addError(state, `${path}[${index}]`, code, { id })
      return
    }
    target.set(id, value)
  })
}

export function validateInterfaceRequirements(
  content: TemplateContent,
  state: ValidationState
): void {
  content.interfaces.forEach((requirement, index) => {
    const path = `interfaces[${index}]`
    if (!LOCAL_NAME_PATTERN.test(requirement.alias)) {
      addError(state, `${path}.alias`, 'INVALID_INTERFACE_ALIAS', { alias: requirement.alias })
    }
    if (state.requirementsByAlias.has(requirement.alias)) {
      addError(state, `${path}.alias`, 'DUPLICATE_INTERFACE_ALIAS', {
        alias: requirement.alias
      })
      return
    }

    const manifest = state.interfacesById.get(requirement.interfaceId)
    if (!manifest) {
      addError(state, `${path}.interfaceId`, 'UNKNOWN_INTERFACE', {
        interfaceId: requirement.interfaceId
      })
    }

    const acceptedVars = new Set<string>()
    if (requirement.acceptedVars.length === 0) {
      addError(state, `${path}.acceptedVars`, 'EMPTY_ACCEPTED_VARS')
    }
    requirement.acceptedVars.forEach((varName, varIndex) => {
      if (acceptedVars.has(varName)) {
        addError(state, `${path}.acceptedVars[${varIndex}]`, 'DUPLICATE_ACCEPTED_VAR', { varName })
      }
      acceptedVars.add(varName)
      if (manifest && !manifest.vars.some((variable) => variable.varName === varName)) {
        addError(state, `${path}.acceptedVars[${varIndex}]`, 'UNKNOWN_INTERFACE_VAR', { varName })
      }
    })

    state.requirementsByAlias.set(requirement.alias, { acceptedVars, manifest })
  })
}

export function isValidLocalName(name: string): boolean {
  return LOCAL_NAME_PATTERN.test(name)
}

export function addError(
  state: ValidationState,
  path: string,
  code: TemplateValidationErrorCode,
  params: Record<string, string | number> = {}
): void {
  state.errors.push({ path, code, params })
}
