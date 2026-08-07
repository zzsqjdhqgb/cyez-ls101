import type {
  ChoiceViewport,
  FrameNode,
  FunctionContent,
  FunctionOutputDef,
  SchemaBindingExpression,
  SchemaUse,
  StaticValueExpression,
  TemplateNode,
  TextExpression,
  TimelineStep,
  ValueType,
  VariableRef
} from '../types'
import { allocateId, allocateName, nodeIdBase } from './identifiers'
import type { DefinitionState } from './types'

export function prepareInsertedSubtree(source: TemplateNode, state: DefinitionState): TemplateNode {
  const node = structuredClone(source)
  const usedIds = collectNodeIds(state.root)
  const usedNames = collectLocalNames(state.root, state.reservedNames)
  const idMap = new Map<string, string>()
  const nameMap = new Map<string, string>()

  const rename = (current: TemplateNode): TemplateNode => {
    const id = allocateId(current.id, nodeIdBase(current.type), usedIds)
    if (!idMap.has(current.id)) idMap.set(current.id, id)
    if (current.type === 'frame') {
      return { ...current, id, children: current.children.map(rename) }
    }
    if (current.type === 'page') {
      const timeline = current.timeline.map((step) => {
        if (step.type !== 'record') return step
        const outputName = allocateName(step.outputName, 'recording', usedNames)
        if (!nameMap.has(step.outputName)) nameMap.set(step.outputName, outputName)
        return { ...step, outputName }
      })
      return { ...current, id, timeline }
    }
    if (current.type === 'choice-question') {
      const outputName = allocateName(current.outputName, 'answer', usedNames)
      if (!nameMap.has(current.outputName)) nameMap.set(current.outputName, outputName)
      return { ...current, id, outputName }
    }
    const outputNames = Object.fromEntries(
      Object.entries(current.outputNames).map(([key, value]) => {
        const outputName = allocateName(value, key || 'output', usedNames)
        if (!nameMap.has(value)) nameMap.set(value, outputName)
        return [key, outputName]
      })
    )
    return { ...current, id, outputNames }
  }

  return mapNodeExpressions(
    rename(node),
    (ref) => {
      if (ref.scope !== 'local') return ref
      const name = nameMap.get(ref.name)
      return name ? { ...ref, name } : ref
    },
    (viewport) => rewriteChoiceViewport(viewport, idMap)
  )
}

export function collectNodeIds(root: FrameNode): Set<string> {
  const ids = new Set<string>()
  const visit = (node: TemplateNode): void => {
    ids.add(node.id)
    if (node.type === 'frame') node.children.forEach(visit)
  }
  visit(root)
  return ids
}

export function collectLocalNames(
  root: FrameNode,
  reserved: readonly string[],
  excludedNodeId?: string
): Set<string> {
  const names = new Set(reserved)
  const visit = (node: TemplateNode): void => {
    if (node.type === 'frame') node.children.forEach(visit)
    if (node.id === excludedNodeId) return
    if (node.type === 'page') {
      node.timeline.forEach((step) => {
        if (step.type === 'record') names.add(step.outputName)
      })
    }
    if (node.type === 'choice-question') names.add(node.outputName)
    if (node.type === 'function') Object.values(node.outputNames).forEach((name) => names.add(name))
  }
  visit(root)
  return names
}

export function mapFrameExpressions(
  frame: FrameNode,
  mapRef: (ref: VariableRef) => VariableRef
): FrameNode {
  return mapNodeExpressions(frame, mapRef) as FrameNode
}

export function mapNodeExpressions(
  node: TemplateNode,
  mapRef: (ref: VariableRef) => VariableRef,
  mapViewport: (viewport: ChoiceViewport) => ChoiceViewport = (viewport) => viewport
): TemplateNode {
  if (node.type === 'frame') {
    return {
      ...node,
      children: node.children.map((child) => mapNodeExpressions(child, mapRef, mapViewport))
    }
  }
  if (node.type === 'choice-question') {
    return {
      ...node,
      stem: mapTextExpression(node.stem, mapRef),
      options: node.options.map((option) => ({
        ...option,
        content: mapTextExpression(option.content, mapRef)
      }))
    }
  }
  if (node.type === 'function') {
    return {
      ...node,
      inputs: Object.fromEntries(
        Object.entries(node.inputs).map(([key, expression]) => [
          key,
          mapStaticExpression(expression, mapRef)
        ])
      )
    }
  }
  return {
    ...node,
    content: {
      ...node.content,
      blocks: node.content.blocks.map((block) => {
        if (block.type === 'text') return { ...block, text: mapTextExpression(block.text, mapRef) }
        if (block.type === 'image')
          return { ...block, src: mapStaticExpression(block.src, mapRef) as typeof block.src }
        return { ...block, defaultViewport: mapViewport(block.defaultViewport) }
      })
    },
    timeline: node.timeline.map((step) => ({
      ...mapTimelineExpression(step, mapRef),
      ...(step.choiceViewOverrides === undefined
        ? {}
        : {
            choiceViewOverrides: Object.fromEntries(
              Object.entries(step.choiceViewOverrides).map(([key, viewport]) => [
                key,
                mapViewport(viewport)
              ])
            )
          })
    }))
  }
}

export function mapTimelineExpression(
  step: TimelineStep,
  mapRef: (ref: VariableRef) => VariableRef
): TimelineStep {
  if (step.type === 'play') return { ...step, text: mapTextExpression(step.text, mapRef) }
  if (step.type === 'countdown')
    return { ...step, seconds: mapStaticExpression(step.seconds, mapRef) as typeof step.seconds }
  return { ...step, duration: mapStaticExpression(step.duration, mapRef) as typeof step.duration }
}

export function mapStaticExpression(
  expression: StaticValueExpression,
  mapRef: (ref: VariableRef) => VariableRef
): StaticValueExpression {
  if ('parts' in expression) return mapTextExpression(expression, mapRef)
  return expression.source === 'variable'
    ? { ...expression, ref: mapRef(expression.ref) }
    : expression
}

export function mapTextExpression(
  expression: TextExpression,
  mapRef: (ref: VariableRef) => VariableRef
): TextExpression {
  return {
    ...expression,
    parts: expression.parts.map((part) =>
      part.type === 'variable' ? { ...part, ref: mapRef(part.ref) } : part
    )
  }
}

export function mapSchemaUses(
  uses: readonly SchemaUse[],
  mapRef: (ref: VariableRef) => VariableRef
): SchemaUse[] {
  return uses.map((use) => ({
    ...use,
    bindings: Object.fromEntries(
      Object.entries(use.bindings).map(([key, expression]) => [
        key,
        mapSchemaExpression(expression, mapRef)
      ])
    )
  }))
}

export function mapSchemaExpression(
  expression: SchemaBindingExpression,
  mapRef: (ref: VariableRef) => VariableRef
): SchemaBindingExpression {
  if (expression.type === 'variable') return { ...expression, ...mapRef(expression) }
  if (expression.type === 'concat') {
    return {
      ...expression,
      parts: expression.parts.map((part) =>
        part.type === 'variable' ? { ...part, ...mapRef(part) } : part
      )
    }
  }
  return expression
}

export function renameLocalReferences(
  content: FunctionContent,
  previous: string,
  next: string
): FunctionContent {
  return {
    ...content,
    body: renameFrameLocalReferences(content.body, previous, next),
    outputs: content.outputs.map((output): FunctionOutputDef => {
      if (output.type === 'audio') {
        return output.expression.name === previous
          ? { ...output, expression: { ...output.expression, name: next } }
          : output
      }
      if (output.type === 'choice') {
        return output.expression.name === previous
          ? { ...output, expression: { ...output.expression, name: next } }
          : output
      }
      if (output.type === 'string') {
        return {
          ...output,
          expression: mapStaticExpression(
            output.expression,
            localReferenceRenamer(previous, next)
          ) as typeof output.expression
        }
      }
      if (output.type === 'number') {
        return {
          ...output,
          expression: mapStaticExpression(
            output.expression,
            localReferenceRenamer(previous, next)
          ) as typeof output.expression
        }
      }
      return {
        ...output,
        expression: mapStaticExpression(
          output.expression,
          localReferenceRenamer(previous, next)
        ) as typeof output.expression
      }
    }),
    schemaUses: renameSchemaLocalReferences(content.schemaUses, previous, next)
  }
}

export function renameDefinitionLocalReferences(
  state: DefinitionState,
  previous: string,
  next: string
): DefinitionState {
  return {
    ...state,
    root: renameFrameLocalReferences(state.root, previous, next),
    schemaUses: renameSchemaLocalReferences(state.schemaUses, previous, next)
  }
}

function renameFrameLocalReferences(frame: FrameNode, previous: string, next: string): FrameNode {
  return mapFrameExpressions(frame, localReferenceRenamer(previous, next))
}

function renameSchemaLocalReferences(
  uses: readonly SchemaUse[],
  previous: string,
  next: string
): SchemaUse[] {
  return mapSchemaUses(uses, localReferenceRenamer(previous, next)).map((use) => ({
    ...use,
    bindings: Object.fromEntries(
      Object.entries(use.bindings).map(([key, expression]) => {
        if (
          (expression.type === 'record-output' || expression.type === 'choice-output') &&
          expression.name === previous
        ) {
          return [key, { ...expression, name: next }]
        }
        return [key, expression]
      })
    )
  }))
}

function localReferenceRenamer(previous: string, next: string): (ref: VariableRef) => VariableRef {
  return (ref) => (ref.scope === 'local' && ref.name === previous ? { ...ref, name: next } : ref)
}

export function rewriteChoiceViewport(
  viewport: ChoiceViewport,
  idMap: ReadonlyMap<string, string>
): ChoiceViewport {
  if (viewport.mode !== 'focus' || viewport.questionRef.scope === 'absolute') return viewport
  return {
    ...viewport,
    questionRef: {
      ...viewport.questionRef,
      callPath: viewport.questionRef.callPath.map((id) => idMap.get(id) ?? id),
      questionId: idMap.get(viewport.questionRef.questionId) ?? viewport.questionRef.questionId
    }
  }
}

export function defaultExpression(type: ValueType): StaticValueExpression {
  if (type === 'number') return { type: 'number', source: 'literal', value: 0 }
  if (type === 'file') return { type: 'file', source: 'literal', value: '' }
  return { type: 'string', source: 'literal', value: '' }
}
