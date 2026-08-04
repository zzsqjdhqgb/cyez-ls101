// @ls101/template-editor - Template 作者态领域模型

// ============================================================
// 值、变量和表达式
// ============================================================

/** 导出试卷包前必须能够求值的静态参数类型。 */
export type ValueType = 'string' | 'number' | 'file'

/** 只能在 ExamPlayer 运行期间产生的值类型。 */
export type RuntimeValueType = 'audio' | 'choice'

export type TemplateValueType = ValueType | RuntimeValueType

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

export type ChoiceViewport = FreeChoiceViewport | FocusChoiceViewport | RangeChoiceViewport

export interface FreeChoiceViewport {
  mode: 'free'
  initialPage?: number
}

export interface FocusChoiceViewport {
  mode: 'focus'
  questionRef: ChoiceQuestionRef
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

export type TimelineAction = PlayTimelineAction | CountdownTimelineAction | RecordTimelineAction

export interface PlayTimelineAction {
  type: 'play'
  src: ValueExpression<'file'>
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

export type TemplateNode = PageNode | FrameNode | FunctionNode | ChoiceQuestionNode

export interface BaseNode {
  id: string
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
  /** 引用不可变 FunctionDef 的内容 ID。 */
  functionRef: string
  inputs: Record<string, StaticValueExpression>
  /** key 是函数出参名，value 是该次调用在调用方作用域中暴露的名称。 */
  outputNames: Record<string, string>
}

export interface ChoiceQuestionNode extends BaseNode {
  type: 'choice-question'
  stem: TextExpression
  options: ChoiceOptionDef[]
  outputName: string
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

export interface FunctionDef {
  /** 不可变函数定义的内容 ID。 */
  id: string
  name: string
  inputs: FunctionInputDef[]
  body: FrameNode
  outputs: FunctionOutputDef[]
  schemaUses: SchemaUse[]
}

export interface FunctionInputDef {
  name: string
  type: ValueType
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

/** 一次评分块消费；schemaId 和 blockId 共同锁定其字段契约。 */
export interface SchemaUse {
  useId: string
  schemaId: string
  blockId: string
  bindings: Record<string, SchemaBindingExpression>
}

export type SchemaBindingExpression =
  | SchemaLiteralExpression
  | SchemaVariableExpression
  | SchemaConcatExpression
  | SchemaRecordOutputExpression
  | SchemaChoiceOutputExpression

export interface SchemaLiteralExpression {
  type: 'literal'
  value: string | number
}

export type SchemaVariableExpression = VariableRef & {
  type: 'variable'
}

export interface SchemaConcatExpression {
  type: 'concat'
  parts: SchemaConcatPart[]
}

export type SchemaConcatPart = SchemaConcatLiteralPart | SchemaVariableExpression

export interface SchemaConcatLiteralPart {
  type: 'literal'
  value: string
}

export interface SchemaRecordOutputExpression {
  type: 'record-output'
  name: string
}

export interface SchemaChoiceOutputExpression {
  type: 'choice-output'
  name: string
}

// ============================================================
// Template 生命周期
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

export type TemplateStatus = 'draft' | 'published'

export interface TemplateDraft extends TemplateContent {
  /** 仅标识本地编辑会话，不参与发布内容 ID。 */
  draftId: string
  status: 'draft'
}

export interface TemplateDef extends TemplateContent {
  /** sha256:<64 位十六进制摘要> */
  id: string
  status: 'published'
}

/** 预览或导出时临时提供，不写入 TemplateContent。 */
export interface ExportInterfaceInstanceSelection {
  alias: string
  interfaceId: string
  instanceId: string
}
