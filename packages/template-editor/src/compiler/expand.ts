import type {
  ChoiceOptionLabel,
  CompiledSchemaBlock,
  CompiledSchemaInput,
  ExamPage,
  PlayerChoiceQuestion,
  ResolvedChoiceViewport,
  ResolvedContentBlock,
  ResolvedTimelineStep
} from '@ls101/core-types'
import type {
  ChoiceQuestionRef,
  ChoiceViewport,
  FrameNode,
  FunctionDef,
  FunctionOutputDef,
  PageNode,
  SchemaUse,
  TemplateContent,
  TemplateNode
} from '../types'
import {
  resolveRuntimeOutput,
  resolveSchemaTextBinding,
  resolveStaticExpression,
  resolveTextExpression,
  resolveValueExpression
} from './expressions'
import {
  emptyStructuralResult,
  expandedId,
  expandedSchemaUseId,
  fail,
  fixedValueCell,
  lazyValueCell,
  mergeStructuralResults,
  questionAddressKey,
  type CompileScope,
  type CompilerState,
  type StructuralResult,
  type ValueCell
} from './shared'

interface InstantiatedDefinition {
  structure: StructuralResult
  outputs: Map<string, ValueCell>
}

export function instantiateTemplate(
  content: TemplateContent,
  state: CompilerState
): StructuralResult {
  const scope: CompileScope = { callPath: [], symbols: new Map() }
  const structure = instantiateFrame(content.root, scope, 'root', state)
  instantiateSchemaUses(content.schemaUses, scope, 'schemaUses', state)
  return structure
}

function instantiateDefinition(
  func: FunctionDef,
  inputCells: Map<string, ValueCell>,
  callPath: string[],
  path: string,
  state: CompilerState
): InstantiatedDefinition {
  const scope: CompileScope = { callPath, symbols: new Map(inputCells) }
  const structure = instantiateFrame(func.body, scope, `${path}.body`, state)
  instantiateSchemaUses(func.schemaUses, scope, `${path}.schemaUses`, state)

  const outputs = new Map<string, ValueCell>()
  func.outputs.forEach((output, index) => {
    outputs.set(
      output.name,
      createFunctionOutputCell(output, scope, `${path}.outputs[${index}]`, state)
    )
  })
  return { structure, outputs }
}

function instantiateFrame(
  frame: FrameNode,
  scope: CompileScope,
  path: string,
  state: CompilerState
): StructuralResult {
  const children = mergeStructuralResults(
    frame.children.map((node, index) =>
      instantiateNode(node, scope, `${path}.children[${index}]`, state)
    )
  )
  if (!frame.choiceCollector) return children

  const pages: number[][] = []
  let offset = 0
  for (const page of frame.choiceCollector.pages) {
    pages.push(children.uncollectedQuestionIndices.slice(offset, offset + page.questionCount))
    offset += page.questionCount
  }
  return {
    uncollectedQuestionIndices: [],
    candidates: [...children.candidates, { pages }]
  }
}

function instantiateNode(
  node: TemplateNode,
  scope: CompileScope,
  path: string,
  state: CompilerState
): StructuralResult {
  switch (node.type) {
    case 'frame':
      return instantiateFrame(node, scope, path, state)
    case 'page':
      instantiatePage(node, scope, path, state)
      return emptyStructuralResult()
    case 'choice-question':
      return instantiateQuestion(node, scope, path, state)
    case 'function':
      return instantiateFunctionCall(node, scope, path, state)
  }
}

function instantiatePage(
  page: PageNode,
  scope: CompileScope,
  path: string,
  state: CompilerState
): void {
  const recordIndices = new Map<number, number>()
  page.timeline.forEach((step, index) => {
    if (step.type !== 'record') return
    const recordIndex = state.nextRecordIndex++
    state.recordingIndices.push(recordIndex)
    recordIndices.set(index, recordIndex)
    scope.symbols.set(
      step.outputName,
      fixedValueCell({ type: 'audio', recordIndex }, `${path}.timeline[${index}].outputName`)
    )
  })

  state.pages.push(() => resolvePage(page, scope, path, recordIndices, state))
}

function resolvePage(
  page: PageNode,
  scope: CompileScope,
  path: string,
  recordIndices: ReadonlyMap<number, number>,
  state: CompilerState
): ExamPage {
  const pageId = expandedId('page', scope.callPath, page.id)
  const content = page.content.blocks.map<ResolvedContentBlock>((block, index) => {
    const blockPath = `${path}.content.blocks[${index}]`
    const id = expandedId('block', scope.callPath, page.id, block.id)
    switch (block.type) {
      case 'text':
        return {
          id,
          type: 'text',
          x: block.x,
          y: block.y,
          ...(block.width === undefined ? {} : { width: block.width }),
          ...(block.fontSize === undefined ? {} : { fontSize: block.fontSize }),
          ...(block.bold === undefined ? {} : { bold: block.bold }),
          ...(block.align === undefined ? {} : { align: block.align }),
          text: resolveTextExpression(block.text, scope, state, `${blockPath}.text`)
        }
      case 'image':
        return {
          id,
          type: 'image',
          x: block.x,
          y: block.y,
          width: block.width,
          height: block.height,
          src: resolveValueExpression(block.src, 'file', scope, state, `${blockPath}.src`) as string
        }
      case 'choice-view':
        return {
          id,
          type: 'choice-view',
          x: block.x,
          y: block.y,
          width: block.width,
          height: block.height,
          defaultViewport: resolveChoiceViewport(
            block.defaultViewport,
            scope.callPath,
            `${blockPath}.defaultViewport`,
            state
          )
        }
    }
  })

  const timeline = page.timeline.map<ResolvedTimelineStep>((step, index) => {
    const stepPath = `${path}.timeline[${index}]`
    const choiceViewOverrides = resolveChoiceViewOverrides(
      step.choiceViewOverrides,
      page,
      scope.callPath,
      stepPath,
      state
    )
    switch (step.type) {
      case 'play':
        return {
          type: 'play',
          text: resolveTextExpression(step.text, scope, state, `${stepPath}.text`),
          ...(choiceViewOverrides ? { choiceViewOverrides } : {})
        }
      case 'countdown':
        return {
          type: 'countdown',
          seconds: resolveValueExpression(
            step.seconds,
            'number',
            scope,
            state,
            `${stepPath}.seconds`
          ) as number,
          ...(choiceViewOverrides ? { choiceViewOverrides } : {})
        }
      case 'record':
        return {
          type: 'record',
          duration: resolveValueExpression(
            step.duration,
            'number',
            scope,
            state,
            `${stepPath}.duration`
          ) as number,
          recordIndex: recordIndices.get(index) as number,
          ...(choiceViewOverrides ? { choiceViewOverrides } : {})
        }
    }
  })

  return { id: pageId, content, timeline }
}

function resolveChoiceViewOverrides(
  overrides: PageNode['timeline'][number]['choiceViewOverrides'],
  page: PageNode,
  callPath: readonly string[],
  path: string,
  state: CompilerState
): Record<string, ResolvedChoiceViewport> | undefined {
  if (!overrides) return undefined
  return Object.fromEntries(
    Object.entries(overrides).map(([blockId, viewport]) => [
      expandedId('block', callPath, page.id, blockId),
      resolveChoiceViewport(
        viewport,
        callPath,
        `${path}.choiceViewOverrides[${JSON.stringify(blockId)}]`,
        state
      )
    ])
  )
}

function instantiateQuestion(
  question: Extract<TemplateNode, { type: 'choice-question' }>,
  scope: CompileScope,
  path: string,
  state: CompilerState
): StructuralResult {
  const choiceIndex = state.nextChoiceIndex++
  state.questionIndicesByAddress.set(questionAddressKey(scope.callPath, question.id), choiceIndex)
  scope.symbols.set(
    question.outputName,
    fixedValueCell({ type: 'choice', choiceIndex }, `${path}.outputName`)
  )
  state.questions.push(() => resolveQuestion(question, choiceIndex, scope, path, state))
  return { uncollectedQuestionIndices: [choiceIndex], candidates: [] }
}

function resolveQuestion(
  question: Extract<TemplateNode, { type: 'choice-question' }>,
  choiceIndex: number,
  scope: CompileScope,
  path: string,
  state: CompilerState
): PlayerChoiceQuestion {
  return {
    choiceIndex,
    stem: resolveTextExpression(question.stem, scope, state, `${path}.stem`),
    options: question.options.map((option, index) => ({
      label: optionLabel(index),
      content: resolveTextExpression(
        option.content,
        scope,
        state,
        `${path}.options[${index}].content`
      )
    }))
  }
}

function instantiateFunctionCall(
  node: Extract<TemplateNode, { type: 'function' }>,
  callerScope: CompileScope,
  path: string,
  state: CompilerState
): StructuralResult {
  const func = state.functionsById.get(node.functionRef) as FunctionDef
  const inputCells = new Map<string, ValueCell>()
  func.inputs.forEach((input) => {
    inputCells.set(
      input.name,
      lazyValueCell(state, input.type, `${path}.inputs[${JSON.stringify(input.name)}]`, () =>
        resolveStaticExpression(
          node.inputs[input.name],
          input.type,
          callerScope,
          state,
          `${path}.inputs[${JSON.stringify(input.name)}]`
        )
      )
    )
  })

  const callPath = [...callerScope.callPath, node.id]
  const instantiated = instantiateDefinition(func, inputCells, callPath, `${path}.function`, state)
  func.outputs.forEach((output) => {
    callerScope.symbols.set(
      node.outputNames[output.name],
      instantiated.outputs.get(output.name) as ValueCell
    )
  })
  return instantiated.structure
}

function createFunctionOutputCell(
  output: FunctionOutputDef,
  scope: CompileScope,
  path: string,
  state: CompilerState
): ValueCell {
  switch (output.type) {
    case 'string':
    case 'number':
    case 'file':
      return lazyValueCell(state, output.type, `${path}.expression`, () =>
        resolveStaticExpression(output.expression, output.type, scope, state, `${path}.expression`)
      )
    case 'audio':
      return runtimeAliasCell('audio', output.expression.name, scope, `${path}.expression`)
    case 'choice':
      return runtimeAliasCell('choice', output.expression.name, scope, `${path}.expression`)
  }
}

function runtimeAliasCell(
  type: 'audio' | 'choice',
  sourceName: string,
  scope: CompileScope,
  path: string
): ValueCell {
  return {
    type,
    label: path,
    get: () => resolveRuntimeOutput(scope, sourceName, type, path)
  }
}

function instantiateSchemaUses(
  uses: readonly SchemaUse[],
  scope: CompileScope,
  path: string,
  state: CompilerState
): void {
  uses.forEach((use, index) => {
    state.schemaUsages.push(() => resolveSchemaUse(use, scope, `${path}[${index}]`, state))
  })
}

function resolveSchemaUse(
  use: SchemaUse,
  scope: CompileScope,
  path: string,
  state: CompilerState
): CompiledSchemaBlock {
  const schema = state.schemasById.get(use.schemaId)
  const block = schema?.blocks.find((candidate) => candidate.blockId === use.blockId)
  if (!block) fail('UNRESOLVED_VALUE', path, { schemaId: use.schemaId, blockId: use.blockId })

  const inputs = block.inputs.map<CompiledSchemaInput>((input) => {
    const expression = use.bindings[input.inputId]
    const fieldPath = `${path}.bindings[${JSON.stringify(input.inputId)}]`
    switch (input.type) {
      case 'string':
        if (expression.type === 'choice-output') {
          const value = resolveRuntimeOutput(scope, expression.name, 'choice', fieldPath)
          return {
            inputId: input.inputId,
            type: 'string',
            source: 'choice',
            choiceIndex: (value as Extract<typeof value, { type: 'choice' }>).choiceIndex
          }
        }
        return {
          inputId: input.inputId,
          type: 'string',
          source: 'static',
          value: resolveSchemaTextBinding(expression, scope, state, fieldPath)
        }
      case 'audio': {
        const value = resolveRuntimeOutput(
          scope,
          (expression as Extract<typeof expression, { type: 'record-output' }>).name,
          'audio',
          fieldPath
        )
        return {
          inputId: input.inputId,
          type: 'audio',
          source: 'recording',
          recordIndex: (value as Extract<typeof value, { type: 'audio' }>).recordIndex
        }
      }
    }
  })

  return {
    instanceId: expandedSchemaUseId(scope.callPath, use.useId),
    schemaId: use.schemaId,
    blockId: use.blockId,
    inputs
  }
}

function resolveChoiceViewport(
  viewport: ChoiceViewport,
  currentCallPath: readonly string[],
  path: string,
  state: CompilerState
): ResolvedChoiceViewport {
  if (viewport.mode === 'free') return { ...viewport }
  if (viewport.mode === 'range') return { ...viewport }

  return {
    mode: 'focus',
    choiceIndex: resolveQuestionRef(viewport.questionRef, currentCallPath, path, state)
  }
}

function resolveQuestionRef(
  ref: ChoiceQuestionRef,
  currentCallPath: readonly string[],
  path: string,
  state: CompilerState
): number {
  const base = ref.scope === 'relative' ? currentCallPath : []
  const key = questionAddressKey([...base, ...ref.callPath], ref.questionId)
  const choiceIndex = state.questionIndicesByAddress.get(key)
  if (choiceIndex === undefined) {
    fail('UNKNOWN_FOCUS_QUESTION', path, {
      scope: ref.scope,
      callPath: ref.callPath.join('/'),
      questionId: ref.questionId
    })
  }
  return choiceIndex
}

function optionLabel(index: number): ChoiceOptionLabel {
  return String.fromCharCode('A'.charCodeAt(0) + index) as ChoiceOptionLabel
}
