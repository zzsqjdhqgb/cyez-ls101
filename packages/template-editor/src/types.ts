// @ls101/template-editor - Template 作者态领域模型

// ============================================================
// 值、变量和表达式
// ============================================================

/** 导出试卷包前必须能够求值的静态参数类型。 */
export type ValueType = 'string' | 'number' | 'file'

/** 只能在 ExamPlayer 运行期间产生的值类型。 */
export type RuntimeValueType = 'audio' | 'choice'

export type TemplateValueType = ValueType | RuntimeValueType | 'choice-group'

export interface ValueTypeMap {
  string: string
  number: number
  file: string
}

export type VariableRef = InterfaceVariableRef | LocalVariableRef

export interface InterfaceVariableRef {
  scope: 'interface'
  alias: string
  varName: string
}

export interface LocalVariableRef {
  scope: 'local'
  name: string
}

export interface LiteralValueExpression<T extends ValueType> {
  type: T
  source: 'literal'
  value: ValueTypeMap[T]
}

export interface VariableValueExpression<T extends ValueType> {
  type: T
  source: 'variable'
  ref: VariableRef
}

/**
 * 非文本静态表达式只能是单个字面量或变量引用。
 * 条件类型使默认泛型参数仍保持可判别联合。
 */
export type ValueExpression<T extends ValueType = ValueType> = T extends ValueType
  ? LiteralValueExpression<T> | VariableValueExpression<T>
  : never

export type TextExpressionPart = TextLiteralPart | TextVariablePart

export interface TextLiteralPart {
  type: 'literal'
  value: string
}

export interface TextVariablePart {
  type: 'variable'
  ref: VariableRef
}

/** 文本编辑器的结构化插值格式。 */
export interface TextExpression {
  type: 'string'
  parts: TextExpressionPart[]
}

export type StringExpression = ValueExpression<'string'> | TextExpression

export type StaticValueExpression =
  | StringExpression
  | ValueExpression<'number'>
  | ValueExpression<'file'>

export type FunctionInputExpression = StaticValueExpression | ChoiceGroupExpression

export type ChoiceGroupShape =
  | { kind: 'question' }
  | { kind: 'range'; pageCounts: number[] }
  | { kind: 'all'; pageCounts: number[] }

export type ChoiceGroupSelection =
  | { kind: 'all' }
  | { kind: 'range'; startPage: number }
  | { kind: 'question'; pageIndex: number; questionIndex: number }

export type ChoiceGroupExpression =
  | {
      type: 'choice-group'
      source: 'global'
      selection: ChoiceGroupSelection
    }
  | {
      type: 'choice-group'
      source: 'local'
      name: string
      selection: ChoiceGroupSelection
    }

// ============================================================
// 页面内容和时间线
// ============================================================

export interface ContentDocument {
  blocks: ContentBlock[]
}

export type ContentBlock = TextBlock | ImageBlock | ChoiceViewBlock

export interface TextBlock {
  id: string
  type: 'text'
  x: number
  y: number
  width?: number
  fontSize?: number
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  text: TextExpression
}

export interface ImageBlock {
  id: string
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  src: ValueExpression<'file'>
}

export interface ChoiceViewBlock {
  id: string
  type: 'choice-view'
  x: number
  y: number
  width: number
  height: number
  defaultViewport: ChoiceViewport
}

export type ChoiceViewport =
  | FreeChoiceViewport
  | FocusChoiceViewport
  | RangeChoiceViewport
  | ChoiceGroupFreeViewport
  | ChoiceGroupFocusViewport
  | ChoiceGroupRangeViewport

export interface FreeChoiceViewport {
  mode: 'free'
  initialPage?: number
}

export interface ChoiceGroupRef {
  scope: 'local'
  name: string
}

export interface ChoiceGroupFreeViewport {
  mode: 'free'
  group: ChoiceGroupRef
  initialPage?: number
}

export interface FocusChoiceViewport {
  mode: 'focus'
  questionRef: ChoiceQuestionRef
}

export interface ChoiceGroupFocusViewport {
  mode: 'focus'
  group: ChoiceGroupRef
  pageIndex: number
  questionIndex: number
}

/**
 * callPath 由 FunctionNode.id 组成，不包含 FrameNode.id。
 * relative 从当前 Template/函数定义作用域开始，absolute 从 Template 根开始。
 */
export interface ChoiceQuestionRef {
  scope: 'relative' | 'absolute'
  callPath: string[]
  questionId: string
}

export interface RangeChoiceViewport {
  mode: 'range'
  startPage: number
  endPage: number
  initialPage?: number
}

export interface ChoiceGroupRangeViewport {
  mode: 'range'
  group: ChoiceGroupRef
  startPage: number
  endPage: number
  initialPage?: number
}

export type TimelineAction = PlayTimelineAction | CountdownTimelineAction | RecordTimelineAction

export interface PlayTimelineAction {
  type: 'play'
  /** 编译期解析后交给 ExamPlayer TTS 的文本。 */
  text: TextExpression
}

export interface CountdownTimelineAction {
  type: 'countdown'
  seconds: ValueExpression<'number'>
}

export interface RecordTimelineAction {
  type: 'record'
  duration: ValueExpression<'number'>
  outputName: string
}

export type TimelineStep = TimelineAction & {
  /** key 是当前页面中 ChoiceViewBlock 的 id。 */
  choiceViewOverrides?: Record<string, ChoiceViewport>
}

// ============================================================
// DSL 节点
// ============================================================

export type TemplateNode = PageNode | FrameNode | FunctionNode | ChoiceQuestionNode | VariableNode

export interface BaseNode {
  id: string
  /** 仅用于编辑器展示，不参与节点寻址或变量解析。 */
  name?: string
}

export interface FrameNode extends BaseNode {
  type: 'frame'
  children: TemplateNode[]
  choiceCollector?: ChoiceCollectorConfig
}

export interface PageNode extends BaseNode {
  type: 'page'
  content: ContentDocument
  timeline: TimelineStep[]
}

export interface FunctionNode extends BaseNode {
  type: 'function'
  /** 在函数源文档中引用函数库 UUID；嵌入 Template 后改写为 FunctionDef 内容 ID。 */
  functionRef: string
  inputs: Record<string, FunctionInputExpression>
  /** key 是函数出参名，value 是该次调用在调用方作用域中暴露的名称。 */
  outputNames: Record<string, string>
}

export interface ChoiceQuestionNode extends BaseNode {
  type: 'choice-question'
  stem: TextExpression
  options: ChoiceOptionDef[]
  outputName: string
}

/** 在当前 Template 或函数定义作用域内声明一个不可变的静态变量。 */
export interface VariableNode extends BaseNode {
  type: 'variable'
  variableName: string
  value: StaticValueExpression
}

export interface ChoiceOptionDef {
  id: string
  content: TextExpression
}

export interface ChoiceCollectorConfig {
  pages: ChoicePageSpec[]
}

export interface ChoicePageSpec {
  /** 正整数字面量；所有页面之和必须等于 Collector 收集的题目数。 */
  questionCount: number
}

// ============================================================
// 函数
// ============================================================

/** 函数库条目和 Template 内嵌快照共享的可编辑正文。 */
export interface FunctionContent {
  name: string
  inputs: FunctionInputDef[]
  body: FrameNode
  outputs: FunctionOutputDef[]
  schemaUses: SchemaUse[]
}

/** 函数编辑器使用的库内函数投影；保存时由所属本地函数库统一执行 CAS。 */
export interface FunctionDocument {
  /** 自定义函数使用 UUID，内置函数使用稳定 builtin key。 */
  functionId: string
  content: FunctionContent
  editorState: DslEditorState
}

/** 函数库语义内容中的函数条目；不包含编辑器私有状态。 */
export interface FunctionLibraryEntry {
  functionId: string
  content: FunctionContent
  /** false 表示由跨库调用复制而来的内部依赖，不作为库的可编辑入口展示。 */
  exposed?: boolean
}

export interface FunctionLibraryContent {
  name: string
  functions: FunctionLibraryEntry[]
}

export interface FunctionLibraryEditorState {
  library: DslEditorState
  functions: Record<string, DslEditorState>
}

export interface FunctionLibraryExportState {
  contentHash: string
}

/** 用户本地持续编辑的函数库工作文档。 */
export interface LocalFunctionLibraryDocument {
  /** 稳定 UUID。 */
  libraryId: string
  /** 导出修订号；仅在导出内容相对上次导出发生变化时递增。 */
  revision: number
  /** 仓储乐观并发版本；每次成功保存后递增，不属于函数库导出语义。 */
  storageRevision: number
  content: FunctionLibraryContent
  editorState: FunctionLibraryEditorState
  /** 仅用于辅助下一次导出，不属于函数库语义内容。 */
  exportState?: FunctionLibraryExportState
}

/** 导入或随软件发布的不可变函数库版本。 */
export interface FunctionLibraryRelease {
  libraryId: string
  version: number
  /** sha256:<64 位十六进制摘要> */
  contentHash: string
  content: FunctionLibraryContent
}

export type FunctionLibrarySource = 'builtin' | 'imported' | 'local'

export type FunctionLibraryLocator =
  | { source: 'builtin'; libraryId: string }
  | { source: 'imported'; libraryId: string; version: number }
  | { source: 'local'; libraryId: string }

export interface FunctionLocator {
  library: FunctionLibraryLocator
  functionId: string
}

/**
 * Template 自带的不可变函数快照。id 是改写完子函数引用后的内容哈希；
 * FunctionNode.functionRef 在 Template 及内嵌函数中都指向此资源集合内的 id。
 */
export interface FunctionDef extends FunctionContent {
  /** sha256:<64 位十六进制摘要> */
  id: string
}

export type FunctionInputDef =
  | {
      name: string
      type: ValueType
    }
  | {
      name: string
      type: 'choice-group'
      shape: ChoiceGroupShape
    }

export interface StringFunctionOutputDef {
  name: string
  type: 'string'
  expression: StringExpression
}

export interface NumberFunctionOutputDef {
  name: string
  type: 'number'
  expression: ValueExpression<'number'>
}

export interface FileFunctionOutputDef {
  name: string
  type: 'file'
  expression: ValueExpression<'file'>
}

export interface AudioFunctionOutputDef {
  name: string
  type: 'audio'
  expression: RecordOutputExpression
}

export interface ChoiceFunctionOutputDef {
  name: string
  type: 'choice'
  expression: ChoiceOutputExpression
}

export type FunctionOutputDef =
  | StringFunctionOutputDef
  | NumberFunctionOutputDef
  | FileFunctionOutputDef
  | AudioFunctionOutputDef
  | ChoiceFunctionOutputDef

export interface RecordOutputExpression {
  type: 'audio'
  source: 'record-output'
  name: string
}

export interface ChoiceOutputExpression {
  type: 'choice'
  source: 'choice-output'
  name: string
}

export type OutputExpression =
  | StaticValueExpression
  | RecordOutputExpression
  | ChoiceOutputExpression

// ============================================================
// Schema 消费
// ============================================================

/** 仅在当前 SchemaUse 文本绑定内可见的附件变量。 */
export interface SchemaAttachmentVariableRef {
  scope: 'schema-use'
  varName: string
}

export type SchemaTextVariableRef = VariableRef | SchemaAttachmentVariableRef

export type SchemaTextExpressionPart = TextLiteralPart | SchemaTextVariablePart

export interface SchemaTextVariablePart {
  type: 'variable'
  ref: SchemaTextVariableRef
}

/** 支持 [@this.varName] 附件引用的 SchemaUse 文本表达式。 */
export interface SchemaTextExpression {
  type: 'string'
  parts: SchemaTextExpressionPart[]
}

/** 一次 Schema 消费，对应试卷中的一个实际评分单元。 */
export interface SchemaUse {
  useId: string
  schemaId: string
  inputBindings: Record<string, SchemaTextExpression>
  answerBindings: Record<string, SchemaAnswerBinding>
  attachments: SchemaUseAttachment[]
}

export interface SchemaUseAttachment {
  varName: string
  description: string
  file: ValueExpression<'file'>
}

export type SchemaAnswerBinding =
  | SchemaTextAnswerBinding
  | SchemaFixedSpeechAnswerBinding
  | SchemaFreeSpeechAnswerBinding

export interface SchemaTextAnswerBinding {
  type: 'text'
  source: 'choice-output'
  name: string
}

export interface SchemaFixedSpeechAnswerBinding {
  type: 'fixed-speech'
  text: SchemaTextExpression
  audio: RecordOutputExpression
}

export interface SchemaFreeSpeechAnswerBinding {
  type: 'free-speech'
  audio: RecordOutputExpression
}

// ============================================================
// Template 工作文档
// ============================================================

export interface TemplateInterfaceRequirement {
  /** Template 内唯一，也是 Interface 变量的可见命名空间。 */
  alias: string
  interfaceId: string
  acceptedVars: string[]
}

export interface TemplateContent {
  name: string
  description: string
  interfaces: TemplateInterfaceRequirement[]
  root: FrameNode
  schemaUses: SchemaUse[]
}

export interface TemplateResources {
  /** 当前 Template 根及内嵌函数传递闭包可达的函数快照，按内容 ID 去重。 */
  functions: FunctionDef[]
}

/**
 * 可持续编辑并直接保存的 Template 文档。导出 ExamPackage 不是发布操作，
 * 后续修改或删除此文档不会影响已经导出的试卷包。
 */
export interface TemplateDocument {
  /** 工作文档的稳定 UUID。 */
  templateId: string
  /** 仓储乐观并发版本；每次成功更新后递增。 */
  revision: number
  content: TemplateContent
  resources: TemplateResources
  editorState: DslEditorState
}

/** 随软件发布的不可变 Template 快照；不具有本地工作文档 revision。 */
export interface BuiltinTemplateRelease {
  /** 跨版本稳定的 UUID。 */
  templateId: string
  /** 从 1 开始递增的发布版本。 */
  version: number
  /** document 规范化后的 sha256 摘要。 */
  releaseHash: string
  document: {
    content: TemplateContent
    resources: TemplateResources
    editorState: DslEditorState
  }
}

/** 编辑器私有 JSON 状态，例如画布位置、折叠和选中状态；不参与校验或编译。 */
export type DslEditorState = Record<string, JsonValue>

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/** 预览或导出时临时提供，不写入 TemplateContent。 */
export interface ExportInterfaceInstanceSelection {
  alias: string
  interfaceId: string
  instanceId: string
}
