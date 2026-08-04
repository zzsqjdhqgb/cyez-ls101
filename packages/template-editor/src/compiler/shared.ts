import type {
  ExamPage,
  ExamPackage,
  InterfaceInstance,
  InterfaceVarManifest,
  PlayerChoiceQuestion,
  SchemaBlockManifest,
  SchemaUsageExport
} from '@ls101/core-types'
import type {
  ExportInterfaceInstanceSelection,
  FunctionDef,
  TemplateValueType,
  ValueType
} from '../types'
import type {
  TemplateDocumentValidationContext,
  TemplateValidationError
} from '../validation/shared'

export type TemplateInterfaceBinding = ExportInterfaceInstanceSelection

/** Interface 仓储按 instanceId 返回的唯一定位结果。 */
export interface LocatedInterfaceInstance {
  interfaceId: string
  instance: InterfaceInstance
}

export interface TemplateCompileContext extends TemplateDocumentValidationContext {
  interfaceBindings: readonly TemplateInterfaceBinding[]
  locateInterfaceInstance(
    instanceId: string
  ): LocatedInterfaceInstance | null | Promise<LocatedInterfaceInstance | null>
}

export type TemplateCompileErrorCode =
  | 'DUPLICATE_INTERFACE_BINDING'
  | 'MISSING_INTERFACE_BINDING'
  | 'UNKNOWN_INTERFACE_BINDING'
  | 'INTERFACE_BINDING_ID_MISMATCH'
  | 'INTERFACE_INSTANCE_NOT_FOUND'
  | 'MISSING_INTERFACE_VALUE'
  | 'STATIC_VALUE_CYCLE'
  | 'UNRESOLVED_VALUE'
  | 'UNKNOWN_FOCUS_QUESTION'

export type TemplateCompileError =
  | { stage: 'validation'; error: TemplateValidationError }
  | {
      stage: 'compile'
      path: string
      code: TemplateCompileErrorCode
      params: Readonly<Record<string, string | number>>
    }

export type TemplateCompileResult =
  | { success: true; examPackage: ExamPackage }
  | { success: false; errors: readonly TemplateCompileError[] }

export type CompiledValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'file'; value: string }
  | { type: 'audio'; recordIndex: number }
  | { type: 'choice'; choiceIndex: number }

export interface ValueCell {
  type: TemplateValueType
  label: string
  get(): CompiledValue
}

export interface CompileScope {
  callPath: string[]
  symbols: Map<string, ValueCell>
}

export interface ChoiceCandidate {
  pages: number[][]
}

export interface StructuralResult {
  uncollectedQuestionIndices: number[]
  candidates: ChoiceCandidate[]
}

export interface BoundInterfaceValue {
  type: 'string' | 'file'
  value: string
}

export interface CompilerState {
  functionsById: Map<string, FunctionDef>
  schemasById: Map<string, SchemaBlockManifest>
  interfaceValuesByAlias: Map<string, Map<string, BoundInterfaceValue>>
  staticCells: ValueCell[]
  pages: Array<() => ExamPage>
  questions: Array<() => PlayerChoiceQuestion>
  schemaUsages: Array<() => SchemaUsageExport>
  questionIndicesByAddress: Map<string, number>
  recordingIndices: number[]
  nextRecordIndex: number
  nextChoiceIndex: number
}

export class CompileFailure extends Error {
  constructor(readonly compileError: Extract<TemplateCompileError, { stage: 'compile' }>) {
    super(compileError.code)
  }
}

export function createCompilerState(
  context: TemplateCompileContext,
  interfaceValuesByAlias: Map<string, Map<string, BoundInterfaceValue>>,
  functions: readonly FunctionDef[]
): CompilerState {
  return {
    functionsById: new Map(functions.map((func) => [func.id, func])),
    schemasById: new Map(context.schemaManifests.map((schema) => [schema.schemaId, schema])),
    interfaceValuesByAlias,
    staticCells: [],
    pages: [],
    questions: [],
    schemaUsages: [],
    questionIndicesByAddress: new Map(),
    recordingIndices: [],
    nextRecordIndex: 0,
    nextChoiceIndex: 0
  }
}

export function fixedValueCell(value: CompiledValue, label: string): ValueCell {
  return { type: value.type, label, get: () => value }
}

export function lazyValueCell(
  state: CompilerState,
  type: ValueType,
  label: string,
  resolve: () => CompiledValue
): ValueCell {
  let status: 'idle' | 'resolving' | 'resolved' = 'idle'
  let cached: CompiledValue | undefined

  const cell: ValueCell = {
    type,
    label,
    get() {
      if (status === 'resolved') return cached as CompiledValue
      if (status === 'resolving') {
        fail('STATIC_VALUE_CYCLE', label, { value: label })
      }
      status = 'resolving'
      cached = resolve()
      status = 'resolved'
      return cached
    }
  }
  state.staticCells.push(cell)
  return cell
}

export function fail(
  code: TemplateCompileErrorCode,
  path: string,
  params: Record<string, string | number> = {}
): never {
  throw new CompileFailure({ stage: 'compile', path, code, params })
}

export function emptyStructuralResult(): StructuralResult {
  return { uncollectedQuestionIndices: [], candidates: [] }
}

export function mergeStructuralResults(results: readonly StructuralResult[]): StructuralResult {
  return results.reduce<StructuralResult>(
    (merged, result) => ({
      uncollectedQuestionIndices: [
        ...merged.uncollectedQuestionIndices,
        ...result.uncollectedQuestionIndices
      ],
      candidates: [...merged.candidates, ...result.candidates]
    }),
    emptyStructuralResult()
  )
}

export function questionAddressKey(callPath: readonly string[], questionId: string): string {
  return JSON.stringify([...callPath, questionId])
}

export function expandedId(
  kind: 'page' | 'block',
  callPath: readonly string[],
  ...sourceIds: string[]
): string {
  return `${kind}:${[...callPath, ...sourceIds].map(encodeURIComponent).join('/')}`
}

export function expandedSchemaUseId(callPath: readonly string[], useId: string): string {
  return `schema-use:${[...callPath, useId].map(encodeURIComponent).join('/')}`
}

export function compileError(
  code: TemplateCompileErrorCode,
  path: string,
  params: Record<string, string | number> = {}
): Extract<TemplateCompileError, { stage: 'compile' }> {
  return { stage: 'compile', path, code, params }
}

export function manifestMap(
  manifests: readonly InterfaceVarManifest[]
): Map<string, InterfaceVarManifest> {
  return new Map(manifests.map((manifest) => [manifest.interfaceId, manifest]))
}
