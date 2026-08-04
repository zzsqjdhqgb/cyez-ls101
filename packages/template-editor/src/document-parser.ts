import type {
  ChoiceViewport,
  ContentBlock,
  FrameNode,
  FunctionContent,
  FunctionDef,
  FunctionDocument,
  FunctionOutputDef,
  JsonValue,
  SchemaBindingExpression,
  SchemaUse,
  StaticValueExpression,
  TemplateDocument,
  TemplateNode,
  TextExpression,
  TimelineStep,
  ValueType,
  VariableRef
} from './types'

export function parseTemplateDocument(value: unknown): TemplateDocument | null {
  if (
    !isRecord(value) ||
    typeof value.templateId !== 'string' ||
    !isRevision(value.revision) ||
    !isRecord(value.content) ||
    typeof value.content.name !== 'string' ||
    typeof value.content.description !== 'string' ||
    !Array.isArray(value.content.interfaces) ||
    !value.content.interfaces.every(isInterfaceRequirement) ||
    !isFrameNode(value.content.root) ||
    !Array.isArray(value.content.schemaUses) ||
    !value.content.schemaUses.every(isSchemaUse) ||
    !isRecord(value.resources) ||
    !Array.isArray(value.resources.functions) ||
    !value.resources.functions.every(isFunctionDef) ||
    !isJsonObject(value.editorState)
  ) {
    return null
  }
  return value as unknown as TemplateDocument
}

export function parseFunctionDocument(value: unknown): FunctionDocument | null {
  if (
    !isRecord(value) ||
    typeof value.functionId !== 'string' ||
    !isRevision(value.revision) ||
    !isFunctionContent(value.content) ||
    !isJsonObject(value.editorState)
  ) {
    return null
  }
  return value as unknown as FunctionDocument
}

function isFunctionDef(value: unknown): value is FunctionDef {
  return isRecord(value) && typeof value.id === 'string' && isFunctionContent(value)
}

function isFunctionContent(value: unknown): value is FunctionContent {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.inputs) &&
    value.inputs.every(
      (input) => isRecord(input) && typeof input.name === 'string' && isValueType(input.type)
    ) &&
    isFrameNode(value.body) &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isFunctionOutput) &&
    Array.isArray(value.schemaUses) &&
    value.schemaUses.every(isSchemaUse)
  )
}

function isFunctionOutput(value: unknown): value is FunctionOutputDef {
  if (!isRecord(value) || typeof value.name !== 'string' || !isRecord(value.expression)) {
    return false
  }
  switch (value.type) {
    case 'string':
      return isStringExpression(value.expression)
    case 'number':
      return isValueExpression(value.expression, 'number')
    case 'file':
      return isValueExpression(value.expression, 'file')
    case 'audio':
      return (
        value.expression.type === 'audio' &&
        value.expression.source === 'record-output' &&
        typeof value.expression.name === 'string'
      )
    case 'choice':
      return (
        value.expression.type === 'choice' &&
        value.expression.source === 'choice-output' &&
        typeof value.expression.name === 'string'
      )
    default:
      return false
  }
}

function isTemplateNode(value: unknown): value is TemplateNode {
  if (!isRecord(value) || typeof value.id !== 'string') return false
  switch (value.type) {
    case 'frame':
      return isFrameNode(value)
    case 'page':
      return (
        isRecord(value.content) &&
        Array.isArray(value.content.blocks) &&
        value.content.blocks.every(isContentBlock) &&
        Array.isArray(value.timeline) &&
        value.timeline.every(isTimelineStep)
      )
    case 'function':
      return (
        typeof value.functionRef === 'string' &&
        isRecordOf(value.inputs, isStaticValueExpression) &&
        isRecordOf(value.outputNames, (name) => typeof name === 'string')
      )
    case 'choice-question':
      return (
        isTextExpression(value.stem) &&
        Array.isArray(value.options) &&
        value.options.every(
          (option) =>
            isRecord(option) && typeof option.id === 'string' && isTextExpression(option.content)
        ) &&
        typeof value.outputName === 'string'
      )
    default:
      return false
  }
}

function isFrameNode(value: unknown): value is FrameNode {
  if (
    !isRecord(value) ||
    value.type !== 'frame' ||
    typeof value.id !== 'string' ||
    !Array.isArray(value.children) ||
    !value.children.every(isTemplateNode)
  ) {
    return false
  }
  if (value.choiceCollector === undefined) return true
  return (
    isRecord(value.choiceCollector) &&
    Array.isArray(value.choiceCollector.pages) &&
    value.choiceCollector.pages.every(
      (page) => isRecord(page) && isFiniteNumber(page.questionCount)
    )
  )
}

function isContentBlock(value: unknown): value is ContentBlock {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y)
  ) {
    return false
  }
  switch (value.type) {
    case 'text':
      return (
        isOptionalNumber(value.width) &&
        isOptionalNumber(value.fontSize) &&
        (value.bold === undefined || typeof value.bold === 'boolean') &&
        (value.align === undefined || ['left', 'center', 'right'].includes(String(value.align))) &&
        isTextExpression(value.text)
      )
    case 'image':
      return isFiniteNumber(value.width) && isValueExpression(value.src, 'file')
    case 'choice-view':
      return (
        isFiniteNumber(value.width) &&
        isFiniteNumber(value.height) &&
        isChoiceViewport(value.defaultViewport)
      )
    default:
      return false
  }
}

function isTimelineStep(value: unknown): value is TimelineStep {
  if (!isRecord(value)) return false
  if (
    value.choiceViewOverrides !== undefined &&
    !isRecordOf(value.choiceViewOverrides, isChoiceViewport)
  ) {
    return false
  }
  switch (value.type) {
    case 'play':
      return isValueExpression(value.src, 'file')
    case 'countdown':
      return isValueExpression(value.seconds, 'number')
    case 'record':
      return isValueExpression(value.duration, 'number') && typeof value.outputName === 'string'
    default:
      return false
  }
}

function isChoiceViewport(value: unknown): value is ChoiceViewport {
  if (!isRecord(value)) return false
  switch (value.mode) {
    case 'free':
      return isOptionalNumber(value.initialPage)
    case 'focus':
      return (
        isRecord(value.questionRef) &&
        (value.questionRef.scope === 'relative' || value.questionRef.scope === 'absolute') &&
        Array.isArray(value.questionRef.callPath) &&
        value.questionRef.callPath.every((item) => typeof item === 'string') &&
        typeof value.questionRef.questionId === 'string'
      )
    case 'range':
      return (
        isFiniteNumber(value.startPage) &&
        isFiniteNumber(value.endPage) &&
        isOptionalNumber(value.initialPage)
      )
    default:
      return false
  }
}

function isSchemaUse(value: unknown): value is SchemaUse {
  return (
    isRecord(value) &&
    typeof value.useId === 'string' &&
    typeof value.schemaId === 'string' &&
    typeof value.blockId === 'string' &&
    isRecordOf(value.bindings, isSchemaBindingExpression)
  )
}

function isSchemaBindingExpression(value: unknown): value is SchemaBindingExpression {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'literal':
      return typeof value.value === 'string' || isFiniteNumber(value.value)
    case 'variable':
      return isVariableRef(value)
    case 'concat':
      return (
        Array.isArray(value.parts) &&
        value.parts.every(
          (part) =>
            isRecord(part) &&
            ((part.type === 'literal' && typeof part.value === 'string') ||
              (part.type === 'variable' && isVariableRef(part)))
        )
      )
    case 'record-output':
    case 'choice-output':
      return typeof value.name === 'string'
    default:
      return false
  }
}

function isStaticValueExpression(value: unknown): value is StaticValueExpression {
  if (!isRecord(value)) return false
  if (value.type === 'string') return isStringExpression(value)
  if (value.type === 'number') return isValueExpression(value, 'number')
  if (value.type === 'file') return isValueExpression(value, 'file')
  return false
}

function isStringExpression(value: unknown): boolean {
  if (!isRecord(value) || value.type !== 'string') return false
  if ('parts' in value) return isTextExpression(value)
  return isValueExpression(value, 'string')
}

function isTextExpression(value: unknown): value is TextExpression {
  return (
    isRecord(value) &&
    value.type === 'string' &&
    Array.isArray(value.parts) &&
    value.parts.every(
      (part) =>
        isRecord(part) &&
        ((part.type === 'literal' && typeof part.value === 'string') ||
          (part.type === 'variable' && isVariableRef(part.ref)))
    )
  )
}

function isValueExpression(value: unknown, expected: ValueType): boolean {
  if (!isRecord(value) || value.type !== expected) return false
  if (value.source === 'variable') return isVariableRef(value.ref)
  if (value.source !== 'literal') return false
  return expected === 'number' ? isFiniteNumber(value.value) : typeof value.value === 'string'
}

function isVariableRef(value: unknown): value is VariableRef {
  if (!isRecord(value)) return false
  if (value.scope === 'local') return typeof value.name === 'string'
  return (
    value.scope === 'interface' &&
    typeof value.alias === 'string' &&
    typeof value.varName === 'string'
  )
}

function isInterfaceRequirement(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.alias === 'string' &&
    typeof value.interfaceId === 'string' &&
    Array.isArray(value.acceptedVars) &&
    value.acceptedVars.every((item) => typeof item === 'string')
  )
}

function isValueType(value: unknown): value is ValueType {
  return value === 'string' || value === 'number' || value === 'file'
}

function isRecordOf(
  value: unknown,
  predicate: (entry: unknown) => boolean
): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).every(predicate)
}

function isJsonObject(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isRevision(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
