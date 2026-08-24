import type {
  CompiledSchemaInput,
  ExamPackage,
  ExamResourceManifest,
  ExamResourceEntry,
  InterfaceInstance,
  InterfaceVarManifest,
  PlayerChoiceMeta,
  PlayerChoiceQuestion,
  ResolvedChoiceViewport,
  ResolvedContentBlock,
  SchemaDefinition
} from '@ls101/core-types'
import type {
  ExportInterfaceInstanceSelection,
  FunctionDef,
  ChoiceGroupShape,
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
  /** 文件名到可读源 URL 的映射，仅供编译时收集资源。 */
  assetUrls: Readonly<Record<string, string>>
}

export interface TemplateCompileContext extends TemplateDocumentValidationContext {
  interfaceBindings: readonly TemplateInterfaceBinding[]
  synthesizeSpeech?(text: string): Promise<GeneratedTimelineAudio>
  locateInterfaceInstance(
    instanceId: string
  ): LocatedInterfaceInstance | null | Promise<LocatedInterfaceInstance | null>
}

export interface GeneratedTimelineAudio {
  data: Uint8Array
  mediaType: string
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
  | 'RESOURCE_SOURCE_NOT_FOUND'
  | 'SPEECH_SYNTHESIZER_MISSING'
  | 'SPEECH_SYNTHESIS_FAILED'
  | 'INVALID_SYNTHESIZED_AUDIO'
  | 'EMPTY_PLAYER_PAGES'
  | 'INVALID_RECORDING_DURATION'
  | 'UNKNOWN_FOCUS_QUESTION'
  | 'UNKNOWN_CHOICE_GROUP'
  | 'CHOICE_GROUP_NOT_AVAILABLE'
  | 'CHOICE_GROUP_OUT_OF_RANGE'
  | 'CHOICE_GROUP_SHAPE_MISMATCH'

export type TemplateCompileError =
  | { stage: 'validation'; error: TemplateValidationError }
  | {
      stage: 'compile'
      path: string
      code: TemplateCompileErrorCode
      params: Readonly<Record<string, string | number>>
    }

export type TemplateCompileResult =
  | {
      success: true
      examPackage: ExamPackage
      /** 写入试卷归档时使用，不属于持久化 ExamPackage JSON。 */
      resourceSources: readonly ExamResourceSource[]
    }
  | { success: false; errors: readonly TemplateCompileError[] }

export interface TemplatePreviewPage {
  id: string
  sourceNodeId: string
  sourceNodeName?: string
  callPath: readonly string[]
  content: ResolvedContentBlock[]
  timeline: TemplatePreviewTimelineStep[]
}

export type TemplatePreviewTimelineStep =
  | {
      type: 'play'
      text: string
      choiceViewOverrides?: Record<string, ResolvedChoiceViewport>
    }
  | {
      type: 'countdown'
      seconds: number
      choiceViewOverrides?: Record<string, ResolvedChoiceViewport>
    }
  | {
      type: 'record'
      duration: number
      recordIndex: number
      choiceViewOverrides?: Record<string, ResolvedChoiceViewport>
    }

export interface TemplatePreviewData {
  title: string
  pages: readonly TemplatePreviewPage[]
  recordingIndices: readonly number[]
  choiceMeta?: PlayerChoiceMeta
  resources: ExamResourceManifest
}

export type TemplatePreviewResult =
  | {
      success: true
      preview: TemplatePreviewData
      resourceSources: readonly ExamResourceSource[]
    }
  | { success: false; errors: readonly TemplateCompileError[] }

export type ExamResourceSource =
  | { assetKey: string; sourceUrl: string }
  | { assetKey: string; data: Uint8Array }

export interface ExpandedExamPage {
  id: string
  sourceNodeId: string
  sourceNodeName?: string
  callPath: readonly string[]
  content: ResolvedContentBlock[]
  timeline: ExpandedTimelineStep[]
}

export type ExpandedTimelineStep =
  | {
      type: 'play'
      text: string
      sourcePath: string
      choiceViewOverrides?: Record<string, ResolvedChoiceViewport>
    }
  | {
      type: 'countdown'
      seconds: number
      choiceViewOverrides?: Record<string, ResolvedChoiceViewport>
    }
  | {
      type: 'record'
      duration: number
      recordIndex: number
      sourcePath: string
      choiceViewOverrides?: Record<string, ResolvedChoiceViewport>
    }

/** SchemaUse 展开后的编译器内部结构；运行期来源索引不会写入最终作答快照。 */
export interface ExpandedSchemaUse {
  instanceId: string
  schemaId: string
  inputs: CompiledSchemaInput[]
  answers: ExpandedSchemaAnswer[]
}

export type ExpandedSchemaAnswer =
  | {
      answerId: string
      type: 'text'
      choiceIndex: number
    }
  | {
      answerId: string
      type: 'fixed-speech'
      text: string
      recordIndex: number
    }
  | {
      answerId: string
      type: 'free-speech'
      recordIndex: number
    }

export type CompiledValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'file'; value: string; sourceUrl?: string }
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
  choiceGroups: Map<string, ChoiceGroupCell>
}

export interface ChoiceGroupContext {
  kind: ChoiceGroupShape['kind']
  pages: number[][]
  pageIndices: number[]
}

export interface ChoiceGroupCell {
  type: 'choice-group'
  label: string
  get(): ChoiceGroupContext
}

export interface ChoiceCandidate {
  pages: number[][]
}

export interface StructuralResult {
  uncollectedQuestionIndices: number[]
  candidates: ChoiceCandidate[]
}

export type BoundInterfaceValue =
  | { type: 'string'; value: string }
  | { type: 'file'; value: string; sourceUrl?: string }

export interface CompilerState {
  functionsById: Map<string, FunctionDef>
  schemasById: Map<string, SchemaDefinition>
  interfaceValuesByAlias: Map<string, Map<string, BoundInterfaceValue>>
  staticCells: ValueCell[]
  choiceGroupCells: ChoiceGroupCell[]
  pages: Array<() => ExpandedExamPage>
  questions: Array<() => PlayerChoiceQuestion>
  schemaUsages: Array<() => ExpandedSchemaUse>
  resources: Map<string, ExamResourceEntry>
  submissionResourceKeys: Set<string>
  resourceSources: Map<string, string>
  questionIndicesByAddress: Map<string, number>
  recordingIndices: number[]
  nextRecordIndex: number
  nextChoiceIndex: number
  globalChoiceGroup: ChoiceGroupContext | undefined
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
    schemasById: new Map(context.schemaDefinitions.map((schema) => [schema.schemaId, schema])),
    interfaceValuesByAlias,
    staticCells: [],
    choiceGroupCells: [],
    pages: [],
    questions: [],
    schemaUsages: [],
    resources: new Map(),
    submissionResourceKeys: new Set(),
    resourceSources: new Map(),
    questionIndicesByAddress: new Map(),
    recordingIndices: [],
    nextRecordIndex: 0,
    nextChoiceIndex: 0,
    globalChoiceGroup: undefined
  }
}

export function fixedValueCell(value: CompiledValue, label: string): ValueCell {
  return { type: value.type, label, get: () => value }
}

export function lazyChoiceGroupCell(
  label: string,
  resolve: () => ChoiceGroupContext
): ChoiceGroupCell {
  let status: 'idle' | 'resolving' | 'resolved' = 'idle'
  let cached: ChoiceGroupContext | undefined
  return {
    type: 'choice-group',
    label,
    get() {
      if (status === 'resolved') return cached as ChoiceGroupContext
      if (status === 'resolving') fail('STATIC_VALUE_CYCLE', label, { value: label })
      status = 'resolving'
      cached = resolve()
      status = 'resolved'
      return cached
    }
  }
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
