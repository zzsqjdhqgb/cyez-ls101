import type { InterfaceVarManifest } from '@ls101/core-types'
import type {
  FrameNode,
  FunctionDef,
  SchemaTextExpression,
  SchemaTextVariableRef,
  SchemaUseAttachment,
  TemplateInterfaceRequirement,
  TemplateNode,
  TemplateValueType,
  TextExpression,
  VariableRef
} from '@ls101/template-editor'

export interface TemplateVariableCandidate {
  key: string
  label: string
  sourceLabel: string
  type: TemplateValueType
  ref: VariableRef
}

export interface SchemaAttachmentVariableCandidate {
  key: string
  label: string
  sourceLabel: string
  type: 'file'
  ref: Extract<SchemaTextVariableRef, { scope: 'schema-use' }>
}

const VARIABLE_NAME_PATTERN = '[a-zA-Z_][a-zA-Z0-9_-]*'
const VARIABLE_TOKEN_PATTERN = new RegExp(
  `\\[@(${VARIABLE_NAME_PATTERN})(?:\\.(${VARIABLE_NAME_PATTERN}(?:\\.${VARIABLE_NAME_PATTERN})*))?\\]`,
  'g'
)

export function collectTemplateVariableCandidates(
  root: FrameNode,
  functions: readonly FunctionDef[],
  requirements: readonly TemplateInterfaceRequirement[],
  manifests: readonly InterfaceVarManifest[]
): TemplateVariableCandidate[] {
  const candidates: TemplateVariableCandidate[] = []
  const usedKeys = new Set<string>()
  const functionsById = new Map(functions.map((definition) => [definition.id, definition]))

  const add = (candidate: TemplateVariableCandidate): void => {
    if (usedKeys.has(candidate.key)) return
    usedKeys.add(candidate.key)
    candidates.push(candidate)
  }

  const scan = (node: TemplateNode): void => {
    if (node.type === 'frame') {
      node.children.forEach(scan)
      return
    }
    if (node.type === 'page') {
      node.timeline.forEach((step) => {
        if (step.type !== 'record') return
        add(localCandidate(step.outputName, 'audio'))
      })
      return
    }
    if (node.type === 'choice-question') {
      add(localCandidate(node.outputName, 'choice'))
      return
    }
    if (node.type === 'variable') {
      add(localCandidate(node.variableName, node.value.type))
      return
    }

    const definition = functionsById.get(node.functionRef)
    definition?.outputs.forEach((output) => {
      const name = node.outputNames[output.name]
      if (name !== undefined) add(localCandidate(name, output.type))
    })
  }

  scan(root)

  const manifestsById = new Map(manifests.map((manifest) => [manifest.interfaceId, manifest]))
  requirements.forEach((requirement) => {
    const manifest = manifestsById.get(requirement.interfaceId)
    requirement.acceptedVars.forEach((varName) => {
      const variable = manifest?.vars.find((item) => item.varName === varName)
      if (!variable) return
      const ref: VariableRef = { scope: 'interface', alias: requirement.alias, varName }
      add({
        key: `interface:${requirement.alias}.${varName}`,
        label: `${requirement.alias}.${varName}`,
        sourceLabel: 'Interface',
        type: variable.type === 'text' ? 'string' : 'file',
        ref
      })
    })
  })

  return candidates
}

export function textExpressionInputValue(value: TextExpression): string {
  return value.parts
    .map((part) => (part.type === 'literal' ? part.value : `[@${variableRefName(part.ref)}]`))
    .join('')
}

export function parseTextExpression(value: string): TextExpression {
  const parts: TextExpression['parts'] = []
  let cursor = 0
  VARIABLE_TOKEN_PATTERN.lastIndex = 0
  for (const match of value.matchAll(VARIABLE_TOKEN_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ type: 'literal', value: value.slice(cursor, index) })
    const [, first, second] = match
    parts.push({
      type: 'variable',
      ref: second
        ? { scope: 'interface', alias: first, varName: second }
        : { scope: 'local', name: first }
    })
    cursor = index + match[0].length
  }
  if (cursor < value.length) parts.push({ type: 'literal', value: value.slice(cursor) })
  if (parts.length === 0) parts.push({ type: 'literal', value: '' })
  return { type: 'string', parts }
}

export function schemaTextExpressionInputValue(value: SchemaTextExpression): string {
  return value.parts
    .map((part) => (part.type === 'literal' ? part.value : `[@${schemaVariableRefName(part.ref)}]`))
    .join('')
}

export function parseSchemaTextExpression(value: string): SchemaTextExpression {
  const parts: SchemaTextExpression['parts'] = []
  let cursor = 0
  VARIABLE_TOKEN_PATTERN.lastIndex = 0
  for (const match of value.matchAll(VARIABLE_TOKEN_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ type: 'literal', value: value.slice(cursor, index) })
    const [, first, second] = match
    const ref: SchemaTextVariableRef = second
      ? first === 'this'
        ? { scope: 'schema-use', varName: second }
        : { scope: 'interface', alias: first, varName: second }
      : { scope: 'local', name: first }
    parts.push({ type: 'variable', ref })
    cursor = index + match[0].length
  }
  if (cursor < value.length) parts.push({ type: 'literal', value: value.slice(cursor) })
  if (parts.length === 0) parts.push({ type: 'literal', value: '' })
  return { type: 'string', parts }
}

export function collectSchemaAttachmentCandidates(
  attachments: readonly SchemaUseAttachment[]
): SchemaAttachmentVariableCandidate[] {
  return attachments.map((attachment) => ({
    key: `schema-use:${attachment.varName}`,
    label: `this.${attachment.varName}`,
    sourceLabel: '当前评分单元附件',
    type: 'file',
    ref: { scope: 'schema-use', varName: attachment.varName }
  }))
}

export function variableRefName(ref: VariableRef): string {
  return ref.scope === 'local' ? ref.name : `${ref.alias}.${ref.varName}`
}

function schemaVariableRefName(ref: SchemaTextVariableRef): string {
  return ref.scope === 'schema-use' ? `this.${ref.varName}` : variableRefName(ref)
}

function localCandidate(name: string, type: TemplateValueType): TemplateVariableCandidate {
  return {
    key: `local:${name}`,
    label: name,
    sourceLabel: '局部变量',
    type,
    ref: { scope: 'local', name }
  }
}
