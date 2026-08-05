import type {
  ChoiceOptionDef,
  ChoicePageSpec,
  ChoiceViewport,
  ContentBlock,
  FrameNode,
  FunctionContent,
  FunctionDocument,
  FunctionInputDef,
  FunctionNode,
  FunctionOutputDef,
  JsonValue,
  SchemaBindingExpression,
  SchemaUse,
  StaticValueExpression,
  TemplateDocument,
  TemplateInterfaceRequirement,
  TemplateNode,
  TextExpression,
  TimelineStep,
  ValueType,
  VariableRef
} from './types'

export interface FunctionCallSignature {
  inputs: readonly FunctionInputDef[]
  outputs: readonly Pick<FunctionOutputDef, 'name' | 'type'>[]
}

export type DefinitionOperation =
  | {
      type: 'insert-node'
      parentId: string
      index?: number
      node: TemplateNode
    }
  | {
      type: 'insert-function-call'
      parentId: string
      index?: number
      functionRef: string
      signature: FunctionCallSignature
      inputs?: Readonly<Record<string, StaticValueExpression>>
      nodeId?: string
    }
  | { type: 'remove-node'; nodeId: string }
  | { type: 'move-node'; nodeId: string; parentId: string; index?: number }
  | { type: 'copy-node'; nodeId: string; parentId: string; index?: number }
  | {
      type: 'set-frame-choice-collector'
      frameId: string
      pages: readonly ChoicePageSpec[] | null
    }
  | { type: 'insert-content-block'; pageId: string; index?: number; block: ContentBlock }
  | { type: 'update-content-block'; pageId: string; blockId: string; block: ContentBlock }
  | { type: 'remove-content-block'; pageId: string; blockId: string }
  | { type: 'move-content-block'; pageId: string; blockId: string; index: number }
  | { type: 'copy-content-block'; pageId: string; blockId: string; index?: number }
  | { type: 'insert-timeline-step'; pageId: string; index?: number; step: TimelineStep }
  | { type: 'update-timeline-step'; pageId: string; index: number; step: TimelineStep }
  | { type: 'remove-timeline-step'; pageId: string; index: number }
  | { type: 'move-timeline-step'; pageId: string; index: number; targetIndex: number }
  | { type: 'copy-timeline-step'; pageId: string; index: number; targetIndex?: number }
  | {
      type: 'set-choice-question'
      nodeId: string
      stem?: TextExpression
      outputName?: string
    }
  | { type: 'insert-choice-option'; nodeId: string; index?: number; option: ChoiceOptionDef }
  | { type: 'update-choice-option'; nodeId: string; optionId: string; option: ChoiceOptionDef }
  | { type: 'remove-choice-option'; nodeId: string; optionId: string }
  | { type: 'move-choice-option'; nodeId: string; optionId: string; index: number }
  | { type: 'copy-choice-option'; nodeId: string; optionId: string; index?: number }
  | {
      type: 'set-function-call-input'
      nodeId: string
      inputName: string
      expression: StaticValueExpression | null
    }
  | {
      type: 'set-function-call-output-name'
      nodeId: string
      outputName: string
      value: string | null
    }
  | { type: 'reconcile-function-call'; nodeId: string; signature: FunctionCallSignature }
  | { type: 'insert-schema-use'; index?: number; use: SchemaUse }
  | { type: 'update-schema-use'; useId: string; use: SchemaUse }
  | { type: 'remove-schema-use'; useId: string }
  | {
      type: 'set-schema-binding'
      useId: string
      fieldName: string
      expression: SchemaBindingExpression | null
    }
  | { type: 'set-editor-state'; key: string; value: JsonValue | undefined }

export type TemplateDocumentOperation =
  | DefinitionOperation
  | { type: 'set-template-name'; value: string }
  | { type: 'set-template-description'; value: string }
  | {
      type: 'insert-interface-requirement'
      index?: number
      requirement: TemplateInterfaceRequirement
    }
  | {
      type: 'update-interface-requirement'
      alias: string
      requirement: TemplateInterfaceRequirement
    }
  | { type: 'remove-interface-requirement'; alias: string }

export type FunctionDocumentOperation =
  | DefinitionOperation
  | { type: 'set-function-name'; value: string }
  | { type: 'insert-function-input'; index?: number; input: FunctionInputDef }
  | { type: 'update-function-input'; name: string; input: FunctionInputDef }
  | { type: 'remove-function-input'; name: string }
  | { type: 'insert-function-output'; index?: number; output: FunctionOutputDef }
  | { type: 'update-function-output'; name: string; output: FunctionOutputDef }
  | { type: 'remove-function-output'; name: string }

export type DocumentEditErrorCode =
  | 'NODE_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_NOT_FRAME'
  | 'ROOT_NODE_IMMUTABLE'
  | 'MOVE_INTO_DESCENDANT'
  | 'INVALID_INDEX'
  | 'WRONG_NODE_TYPE'
  | 'CONTENT_BLOCK_NOT_FOUND'
  | 'CONTENT_BLOCK_ID_CONFLICT'
  | 'TIMELINE_STEP_NOT_FOUND'
  | 'CHOICE_OPTION_NOT_FOUND'
  | 'CHOICE_OPTION_ID_CONFLICT'
  | 'SCHEMA_USE_NOT_FOUND'
  | 'SCHEMA_USE_ID_CONFLICT'
  | 'INTERFACE_REQUIREMENT_NOT_FOUND'
  | 'INTERFACE_ALIAS_CONFLICT'
  | 'FUNCTION_INPUT_NOT_FOUND'
  | 'FUNCTION_INPUT_NAME_CONFLICT'
  | 'FUNCTION_OUTPUT_NOT_FOUND'
  | 'FUNCTION_OUTPUT_NAME_CONFLICT'

export interface DocumentEditError {
  code: DocumentEditErrorCode
  path: string
  params: Readonly<Record<string, string | number>>
}

export interface DocumentEditChange {
  kind: 'insert' | 'update' | 'remove' | 'move' | 'cleanup'
  path: string
  previousPath?: string
  subjectId?: string
}

export type DocumentEditResult<TDocument, TOperation> =
  | {
      applied: true
      document: TDocument
      previousDocument: TDocument
      operation: TOperation
      changes: readonly DocumentEditChange[]
    }
  | {
      applied: false
      document: TDocument
      operation: TOperation
      error: DocumentEditError
    }

interface DefinitionState {
  root: FrameNode
  schemaUses: SchemaUse[]
  editorState: Record<string, JsonValue>
  reservedNames: readonly string[]
}

interface MutationSuccess {
  state: DefinitionState
  changes: DocumentEditChange[]
}

type MutationResult = MutationSuccess | { error: DocumentEditError }

export function editTemplateDocument(
  document: TemplateDocument,
  operation: TemplateDocumentOperation
): DocumentEditResult<TemplateDocument, TemplateDocumentOperation> {
  const direct = editTemplateMetadata(document, operation)
  if (direct) return direct

  const result = applyDefinitionOperation(
    {
      root: document.content.root,
      schemaUses: document.content.schemaUses,
      editorState: document.editorState,
      reservedNames: []
    },
    operation as DefinitionOperation
  )
  if ('error' in result) return rejected(document, operation, result.error)

  const resources =
    operation.type === 'remove-node'
      ? pruneResources(result.state.root, document)
      : document.resources
  const changes = [...result.changes]
  if (resources !== document.resources) {
    changes.push({ kind: 'cleanup', path: 'resources.functions' })
  }
  return applied(
    document,
    operation,
    {
      ...document,
      content: {
        ...document.content,
        root: result.state.root,
        schemaUses: result.state.schemaUses
      },
      resources,
      editorState: result.state.editorState
    },
    changes
  )
}

export function editFunctionDocument(
  document: FunctionDocument,
  operation: FunctionDocumentOperation
): DocumentEditResult<FunctionDocument, FunctionDocumentOperation> {
  const direct = editFunctionMetadata(document, operation)
  if (direct) return direct

  const result = applyDefinitionOperation(
    {
      root: document.content.body,
      schemaUses: document.content.schemaUses,
      editorState: document.editorState,
      reservedNames: [
        ...document.content.inputs.map((input) => input.name),
        ...document.content.outputs.map((output) => output.name)
      ]
    },
    operation as DefinitionOperation
  )
  if ('error' in result) return rejected(document, operation, result.error)
  return applied(
    document,
    operation,
    {
      ...document,
      content: {
        ...document.content,
        body: result.state.root,
        schemaUses: result.state.schemaUses
      },
      editorState: result.state.editorState
    },
    result.changes
  )
}

function editTemplateMetadata(
  document: TemplateDocument,
  operation: TemplateDocumentOperation
): DocumentEditResult<TemplateDocument, TemplateDocumentOperation> | null {
  if (operation.type === 'set-template-name') {
    return applied(
      document,
      operation,
      {
        ...document,
        content: { ...document.content, name: operation.value }
      },
      [{ kind: 'update', path: 'content.name' }]
    )
  }
  if (operation.type === 'set-template-description') {
    return applied(
      document,
      operation,
      {
        ...document,
        content: { ...document.content, description: operation.value }
      },
      [{ kind: 'update', path: 'content.description' }]
    )
  }
  if (operation.type === 'insert-interface-requirement') {
    if (document.content.interfaces.some((item) => item.alias === operation.requirement.alias)) {
      return rejected(
        document,
        operation,
        error('INTERFACE_ALIAS_CONFLICT', 'content.interfaces', {
          alias: operation.requirement.alias
        })
      )
    }
    const index = insertionIndex(operation.index, document.content.interfaces.length)
    if (index === null)
      return rejected(document, operation, invalidIndex('content.interfaces', operation.index))
    const interfaces = insertAt(
      document.content.interfaces,
      index,
      structuredClone(operation.requirement)
    )
    return applied(
      document,
      operation,
      {
        ...document,
        content: { ...document.content, interfaces }
      },
      [{ kind: 'insert', path: `content.interfaces[${index}]` }]
    )
  }
  if (operation.type === 'update-interface-requirement') {
    const index = document.content.interfaces.findIndex((item) => item.alias === operation.alias)
    if (index < 0) {
      return rejected(
        document,
        operation,
        error('INTERFACE_REQUIREMENT_NOT_FOUND', 'content.interfaces', {
          alias: operation.alias
        })
      )
    }
    if (
      operation.requirement.alias !== operation.alias &&
      document.content.interfaces.some((item) => item.alias === operation.requirement.alias)
    ) {
      return rejected(
        document,
        operation,
        error('INTERFACE_ALIAS_CONFLICT', 'content.interfaces', {
          alias: operation.requirement.alias
        })
      )
    }
    const interfaces = replaceAt(
      document.content.interfaces,
      index,
      structuredClone(operation.requirement)
    )
    let root = document.content.root
    let schemaUses = document.content.schemaUses
    if (operation.requirement.alias !== operation.alias) {
      root = mapFrameExpressions(root, (ref) =>
        ref.scope === 'interface' && ref.alias === operation.alias
          ? { ...ref, alias: operation.requirement.alias }
          : ref
      )
      schemaUses = mapSchemaUses(document.content.schemaUses, (ref) =>
        ref.scope === 'interface' && ref.alias === operation.alias
          ? { ...ref, alias: operation.requirement.alias }
          : ref
      )
    }
    return applied(
      document,
      operation,
      {
        ...document,
        content: { ...document.content, interfaces, root, schemaUses }
      },
      [{ kind: 'update', path: `content.interfaces[${index}]` }]
    )
  }
  if (operation.type === 'remove-interface-requirement') {
    const index = document.content.interfaces.findIndex((item) => item.alias === operation.alias)
    if (index < 0) {
      return rejected(
        document,
        operation,
        error('INTERFACE_REQUIREMENT_NOT_FOUND', 'content.interfaces', {
          alias: operation.alias
        })
      )
    }
    return applied(
      document,
      operation,
      {
        ...document,
        content: {
          ...document.content,
          interfaces: removeAt(document.content.interfaces, index)
        }
      },
      [{ kind: 'remove', path: `content.interfaces[${index}]` }]
    )
  }
  return null
}

function editFunctionMetadata(
  document: FunctionDocument,
  operation: FunctionDocumentOperation
): DocumentEditResult<FunctionDocument, FunctionDocumentOperation> | null {
  if (operation.type === 'set-function-name') {
    return applied(
      document,
      operation,
      {
        ...document,
        content: { ...document.content, name: operation.value }
      },
      [{ kind: 'update', path: 'content.name' }]
    )
  }
  if (operation.type === 'insert-function-input') {
    if (document.content.inputs.some((item) => item.name === operation.input.name)) {
      return rejected(
        document,
        operation,
        error('FUNCTION_INPUT_NAME_CONFLICT', 'content.inputs', {
          name: operation.input.name
        })
      )
    }
    const index = insertionIndex(operation.index, document.content.inputs.length)
    if (index === null)
      return rejected(document, operation, invalidIndex('content.inputs', operation.index))
    return applied(
      document,
      operation,
      {
        ...document,
        content: {
          ...document.content,
          inputs: insertAt(document.content.inputs, index, structuredClone(operation.input))
        }
      },
      [{ kind: 'insert', path: `content.inputs[${index}]` }]
    )
  }
  if (operation.type === 'update-function-input') {
    const index = document.content.inputs.findIndex((item) => item.name === operation.name)
    if (index < 0) {
      return rejected(
        document,
        operation,
        error('FUNCTION_INPUT_NOT_FOUND', 'content.inputs', {
          name: operation.name
        })
      )
    }
    if (
      operation.input.name !== operation.name &&
      document.content.inputs.some((item) => item.name === operation.input.name)
    ) {
      return rejected(
        document,
        operation,
        error('FUNCTION_INPUT_NAME_CONFLICT', 'content.inputs', {
          name: operation.input.name
        })
      )
    }
    let content: FunctionContent = {
      ...document.content,
      inputs: replaceAt(document.content.inputs, index, structuredClone(operation.input))
    }
    if (operation.input.name !== operation.name) {
      content = renameLocalReferences(content, operation.name, operation.input.name)
    }
    return applied(document, operation, { ...document, content }, [
      { kind: 'update', path: `content.inputs[${index}]` }
    ])
  }
  if (operation.type === 'remove-function-input') {
    const index = document.content.inputs.findIndex((item) => item.name === operation.name)
    if (index < 0) {
      return rejected(
        document,
        operation,
        error('FUNCTION_INPUT_NOT_FOUND', 'content.inputs', {
          name: operation.name
        })
      )
    }
    return applied(
      document,
      operation,
      {
        ...document,
        content: { ...document.content, inputs: removeAt(document.content.inputs, index) }
      },
      [{ kind: 'remove', path: `content.inputs[${index}]` }]
    )
  }
  if (operation.type === 'insert-function-output') {
    if (document.content.outputs.some((item) => item.name === operation.output.name)) {
      return rejected(
        document,
        operation,
        error('FUNCTION_OUTPUT_NAME_CONFLICT', 'content.outputs', {
          name: operation.output.name
        })
      )
    }
    const index = insertionIndex(operation.index, document.content.outputs.length)
    if (index === null)
      return rejected(document, operation, invalidIndex('content.outputs', operation.index))
    return applied(
      document,
      operation,
      {
        ...document,
        content: {
          ...document.content,
          outputs: insertAt(document.content.outputs, index, structuredClone(operation.output))
        }
      },
      [{ kind: 'insert', path: `content.outputs[${index}]` }]
    )
  }
  if (operation.type === 'update-function-output') {
    const index = document.content.outputs.findIndex((item) => item.name === operation.name)
    if (index < 0) {
      return rejected(
        document,
        operation,
        error('FUNCTION_OUTPUT_NOT_FOUND', 'content.outputs', {
          name: operation.name
        })
      )
    }
    if (
      operation.output.name !== operation.name &&
      document.content.outputs.some((item) => item.name === operation.output.name)
    ) {
      return rejected(
        document,
        operation,
        error('FUNCTION_OUTPUT_NAME_CONFLICT', 'content.outputs', {
          name: operation.output.name
        })
      )
    }
    return applied(
      document,
      operation,
      {
        ...document,
        content: {
          ...document.content,
          outputs: replaceAt(document.content.outputs, index, structuredClone(operation.output))
        }
      },
      [{ kind: 'update', path: `content.outputs[${index}]` }]
    )
  }
  if (operation.type === 'remove-function-output') {
    const index = document.content.outputs.findIndex((item) => item.name === operation.name)
    if (index < 0) {
      return rejected(
        document,
        operation,
        error('FUNCTION_OUTPUT_NOT_FOUND', 'content.outputs', {
          name: operation.name
        })
      )
    }
    return applied(
      document,
      operation,
      {
        ...document,
        content: { ...document.content, outputs: removeAt(document.content.outputs, index) }
      },
      [{ kind: 'remove', path: `content.outputs[${index}]` }]
    )
  }
  return null
}

function applyDefinitionOperation(
  state: DefinitionState,
  operation: DefinitionOperation
): MutationResult {
  switch (operation.type) {
    case 'insert-node':
      return insertNode(state, operation.parentId, operation.index, operation.node)
    case 'insert-function-call': {
      const names = collectLocalNames(state.root, state.reservedNames)
      const outputNames: Record<string, string> = {}
      operation.signature.outputs.forEach((output) => {
        outputNames[output.name] = allocateGeneratedName(output.name, names)
      })
      const inputs: Record<string, StaticValueExpression> = {}
      operation.signature.inputs.forEach((input) => {
        inputs[input.name] = structuredClone(
          operation.inputs?.[input.name] ?? defaultExpression(input.type)
        )
      })
      const node: FunctionNode = {
        id: operation.nodeId ?? '',
        type: 'function',
        functionRef: operation.functionRef,
        inputs,
        outputNames
      }
      return insertNode(state, operation.parentId, operation.index, node)
    }
    case 'remove-node':
      return removeNode(state, operation.nodeId)
    case 'move-node':
      return moveNode(state, operation.nodeId, operation.parentId, operation.index)
    case 'copy-node':
      return copyNode(state, operation.nodeId, operation.parentId, operation.index)
    case 'set-frame-choice-collector':
      return updateNodeByType(state, operation.frameId, 'frame', (frame) => {
        if (operation.pages === null) {
          const withoutCollector = { ...frame }
          delete withoutCollector.choiceCollector
          return withoutCollector
        }
        return {
          ...frame,
          choiceCollector: { pages: structuredClone([...operation.pages]) }
        }
      })
    case 'insert-content-block':
      return editPage(state, operation.pageId, (page, path) => {
        const index = insertionIndex(operation.index, page.content.blocks.length)
        if (index === null)
          return { error: invalidIndex(`${path}.content.blocks`, operation.index) }
        const used = new Set(page.content.blocks.map((block) => block.id))
        const block = structuredClone(operation.block)
        block.id = allocateId(block.id, block.type, used)
        return {
          node: {
            ...page,
            content: { ...page.content, blocks: insertAt(page.content.blocks, index, block) }
          },
          changes: [{ kind: 'insert', path: `${path}.content.blocks[${index}]` }]
        }
      })
    case 'update-content-block':
      return editPage(state, operation.pageId, (page, path) => {
        const index = page.content.blocks.findIndex((block) => block.id === operation.blockId)
        if (index < 0)
          return {
            error: error('CONTENT_BLOCK_NOT_FOUND', `${path}.content.blocks`, {
              blockId: operation.blockId
            })
          }
        if (
          operation.block.id !== operation.blockId &&
          page.content.blocks.some((block) => block.id === operation.block.id)
        ) {
          return {
            error: error('CONTENT_BLOCK_ID_CONFLICT', `${path}.content.blocks`, {
              blockId: operation.block.id
            })
          }
        }
        const previous = page.content.blocks[index]
        let timeline = page.timeline
        if (previous.type === 'choice-view' && operation.block.type !== 'choice-view') {
          timeline = removeChoiceOverrides(timeline, operation.blockId)
        } else if (previous.type === 'choice-view' && operation.block.id !== operation.blockId) {
          timeline = renameChoiceOverrides(timeline, operation.blockId, operation.block.id)
        }
        return {
          node: {
            ...page,
            content: {
              ...page.content,
              blocks: replaceAt(page.content.blocks, index, structuredClone(operation.block))
            },
            timeline
          },
          changes: [{ kind: 'update', path: `${path}.content.blocks[${index}]` }]
        }
      })
    case 'remove-content-block':
      return editPage(state, operation.pageId, (page, path) => {
        const index = page.content.blocks.findIndex((block) => block.id === operation.blockId)
        if (index < 0)
          return {
            error: error('CONTENT_BLOCK_NOT_FOUND', `${path}.content.blocks`, {
              blockId: operation.blockId
            })
          }
        const removed = page.content.blocks[index]
        return {
          node: {
            ...page,
            content: { ...page.content, blocks: removeAt(page.content.blocks, index) },
            timeline:
              removed.type === 'choice-view'
                ? removeChoiceOverrides(page.timeline, operation.blockId)
                : page.timeline
          },
          changes: [{ kind: 'remove', path: `${path}.content.blocks[${index}]` }]
        }
      })
    case 'move-content-block':
      return editPage(state, operation.pageId, (page, path) => {
        const index = page.content.blocks.findIndex((block) => block.id === operation.blockId)
        if (index < 0)
          return {
            error: error('CONTENT_BLOCK_NOT_FOUND', `${path}.content.blocks`, {
              blockId: operation.blockId
            })
          }
        const target = moveTargetIndex(operation.index, page.content.blocks.length)
        if (target === null)
          return { error: invalidIndex(`${path}.content.blocks`, operation.index) }
        return {
          node: {
            ...page,
            content: { ...page.content, blocks: moveAt(page.content.blocks, index, target) }
          },
          changes: [
            {
              kind: 'move',
              path: `${path}.content.blocks[${target}]`,
              previousPath: `${path}.content.blocks[${index}]`
            }
          ]
        }
      })
    case 'copy-content-block':
      return editPage(state, operation.pageId, (page, path) => {
        const index = page.content.blocks.findIndex((block) => block.id === operation.blockId)
        if (index < 0)
          return {
            error: error('CONTENT_BLOCK_NOT_FOUND', `${path}.content.blocks`, {
              blockId: operation.blockId
            })
          }
        const target = insertionIndex(operation.index ?? index + 1, page.content.blocks.length)
        if (target === null)
          return { error: invalidIndex(`${path}.content.blocks`, operation.index) }
        const block = structuredClone(page.content.blocks[index])
        block.id = allocateId(
          block.id,
          block.type,
          new Set(page.content.blocks.map((item) => item.id))
        )
        return {
          node: {
            ...page,
            content: { ...page.content, blocks: insertAt(page.content.blocks, target, block) }
          },
          changes: [{ kind: 'insert', path: `${path}.content.blocks[${target}]` }]
        }
      })
    case 'insert-timeline-step':
      return editPage(state, operation.pageId, (page, path) => {
        const index = insertionIndex(operation.index, page.timeline.length)
        if (index === null) return { error: invalidIndex(`${path}.timeline`, operation.index) }
        const step = prepareTimelineStep(
          operation.step,
          collectLocalNames(state.root, state.reservedNames)
        )
        return {
          node: { ...page, timeline: insertAt(page.timeline, index, step) },
          changes: [{ kind: 'insert', path: `${path}.timeline[${index}]` }]
        }
      })
    case 'update-timeline-step':
      return editPage(state, operation.pageId, (page, path) => {
        if (!hasIndex(page.timeline, operation.index))
          return {
            error: error('TIMELINE_STEP_NOT_FOUND', `${path}.timeline`, { index: operation.index })
          }
        return {
          node: {
            ...page,
            timeline: replaceAt(page.timeline, operation.index, structuredClone(operation.step))
          },
          changes: [{ kind: 'update', path: `${path}.timeline[${operation.index}]` }]
        }
      })
    case 'remove-timeline-step':
      return editPage(state, operation.pageId, (page, path) => {
        if (!hasIndex(page.timeline, operation.index))
          return {
            error: error('TIMELINE_STEP_NOT_FOUND', `${path}.timeline`, { index: operation.index })
          }
        return {
          node: { ...page, timeline: removeAt(page.timeline, operation.index) },
          changes: [{ kind: 'remove', path: `${path}.timeline[${operation.index}]` }]
        }
      })
    case 'move-timeline-step':
      return editPage(state, operation.pageId, (page, path) => {
        if (!hasIndex(page.timeline, operation.index))
          return {
            error: error('TIMELINE_STEP_NOT_FOUND', `${path}.timeline`, { index: operation.index })
          }
        const target = moveTargetIndex(operation.targetIndex, page.timeline.length)
        if (target === null)
          return { error: invalidIndex(`${path}.timeline`, operation.targetIndex) }
        return {
          node: { ...page, timeline: moveAt(page.timeline, operation.index, target) },
          changes: [
            {
              kind: 'move',
              path: `${path}.timeline[${target}]`,
              previousPath: `${path}.timeline[${operation.index}]`
            }
          ]
        }
      })
    case 'copy-timeline-step':
      return editPage(state, operation.pageId, (page, path) => {
        if (!hasIndex(page.timeline, operation.index))
          return {
            error: error('TIMELINE_STEP_NOT_FOUND', `${path}.timeline`, { index: operation.index })
          }
        const target = insertionIndex(
          operation.targetIndex ?? operation.index + 1,
          page.timeline.length
        )
        if (target === null)
          return { error: invalidIndex(`${path}.timeline`, operation.targetIndex) }
        const step = prepareTimelineStep(
          page.timeline[operation.index],
          collectLocalNames(state.root, state.reservedNames)
        )
        return {
          node: { ...page, timeline: insertAt(page.timeline, target, step) },
          changes: [{ kind: 'insert', path: `${path}.timeline[${target}]` }]
        }
      })
    case 'set-choice-question':
      return updateNodeByType(state, operation.nodeId, 'choice-question', (node) => ({
        ...node,
        ...(operation.stem === undefined ? {} : { stem: structuredClone(operation.stem) }),
        ...(operation.outputName === undefined ? {} : { outputName: operation.outputName })
      }))
    case 'insert-choice-option':
      return editChoiceQuestion(state, operation.nodeId, (node, path) => {
        const index = insertionIndex(operation.index, node.options.length)
        if (index === null) return { error: invalidIndex(`${path}.options`, operation.index) }
        const option = structuredClone(operation.option)
        option.id = allocateId(option.id, 'option', new Set(node.options.map((item) => item.id)))
        return {
          node: { ...node, options: insertAt(node.options, index, option) },
          changes: [{ kind: 'insert', path: `${path}.options[${index}]` }]
        }
      })
    case 'update-choice-option':
      return editChoiceQuestion(state, operation.nodeId, (node, path) => {
        const index = node.options.findIndex((item) => item.id === operation.optionId)
        if (index < 0)
          return {
            error: error('CHOICE_OPTION_NOT_FOUND', `${path}.options`, {
              optionId: operation.optionId
            })
          }
        if (
          operation.option.id !== operation.optionId &&
          node.options.some((item) => item.id === operation.option.id)
        ) {
          return {
            error: error('CHOICE_OPTION_ID_CONFLICT', `${path}.options`, {
              optionId: operation.option.id
            })
          }
        }
        return {
          node: {
            ...node,
            options: replaceAt(node.options, index, structuredClone(operation.option))
          },
          changes: [{ kind: 'update', path: `${path}.options[${index}]` }]
        }
      })
    case 'remove-choice-option':
      return editChoiceQuestion(state, operation.nodeId, (node, path) => {
        const index = node.options.findIndex((item) => item.id === operation.optionId)
        if (index < 0)
          return {
            error: error('CHOICE_OPTION_NOT_FOUND', `${path}.options`, {
              optionId: operation.optionId
            })
          }
        return {
          node: { ...node, options: removeAt(node.options, index) },
          changes: [{ kind: 'remove', path: `${path}.options[${index}]` }]
        }
      })
    case 'move-choice-option':
      return editChoiceQuestion(state, operation.nodeId, (node, path) => {
        const index = node.options.findIndex((item) => item.id === operation.optionId)
        if (index < 0)
          return {
            error: error('CHOICE_OPTION_NOT_FOUND', `${path}.options`, {
              optionId: operation.optionId
            })
          }
        const target = moveTargetIndex(operation.index, node.options.length)
        if (target === null) return { error: invalidIndex(`${path}.options`, operation.index) }
        return {
          node: { ...node, options: moveAt(node.options, index, target) },
          changes: [
            {
              kind: 'move',
              path: `${path}.options[${target}]`,
              previousPath: `${path}.options[${index}]`
            }
          ]
        }
      })
    case 'copy-choice-option':
      return editChoiceQuestion(state, operation.nodeId, (node, path) => {
        const index = node.options.findIndex((item) => item.id === operation.optionId)
        if (index < 0)
          return {
            error: error('CHOICE_OPTION_NOT_FOUND', `${path}.options`, {
              optionId: operation.optionId
            })
          }
        const target = insertionIndex(operation.index ?? index + 1, node.options.length)
        if (target === null) return { error: invalidIndex(`${path}.options`, operation.index) }
        const option = structuredClone(node.options[index])
        option.id = allocateId(option.id, 'option', new Set(node.options.map((item) => item.id)))
        return {
          node: { ...node, options: insertAt(node.options, target, option) },
          changes: [{ kind: 'insert', path: `${path}.options[${target}]` }]
        }
      })
    case 'set-function-call-input':
      return updateNodeByType(state, operation.nodeId, 'function', (node) => {
        const inputs = { ...node.inputs }
        if (operation.expression === null) delete inputs[operation.inputName]
        else inputs[operation.inputName] = structuredClone(operation.expression)
        return { ...node, inputs }
      })
    case 'set-function-call-output-name':
      return updateNodeByType(state, operation.nodeId, 'function', (node) => {
        const outputNames = { ...node.outputNames }
        if (operation.value === null) delete outputNames[operation.outputName]
        else outputNames[operation.outputName] = operation.value
        return { ...node, outputNames }
      })
    case 'reconcile-function-call':
      return reconcileFunctionCall(state, operation.nodeId, operation.signature)
    case 'insert-schema-use': {
      if (state.schemaUses.some((use) => use.useId === operation.use.useId)) {
        return {
          error: error('SCHEMA_USE_ID_CONFLICT', 'schemaUses', { useId: operation.use.useId })
        }
      }
      const index = insertionIndex(operation.index, state.schemaUses.length)
      if (index === null) return { error: invalidIndex('schemaUses', operation.index) }
      return {
        state: {
          ...state,
          schemaUses: insertAt(state.schemaUses, index, structuredClone(operation.use))
        },
        changes: [{ kind: 'insert', path: `schemaUses[${index}]` }]
      }
    }
    case 'update-schema-use': {
      const index = state.schemaUses.findIndex((use) => use.useId === operation.useId)
      if (index < 0)
        return { error: error('SCHEMA_USE_NOT_FOUND', 'schemaUses', { useId: operation.useId }) }
      if (
        operation.use.useId !== operation.useId &&
        state.schemaUses.some((use) => use.useId === operation.use.useId)
      ) {
        return {
          error: error('SCHEMA_USE_ID_CONFLICT', 'schemaUses', { useId: operation.use.useId })
        }
      }
      return {
        state: {
          ...state,
          schemaUses: replaceAt(state.schemaUses, index, structuredClone(operation.use))
        },
        changes: [{ kind: 'update', path: `schemaUses[${index}]` }]
      }
    }
    case 'remove-schema-use': {
      const index = state.schemaUses.findIndex((use) => use.useId === operation.useId)
      if (index < 0)
        return { error: error('SCHEMA_USE_NOT_FOUND', 'schemaUses', { useId: operation.useId }) }
      return {
        state: { ...state, schemaUses: removeAt(state.schemaUses, index) },
        changes: [{ kind: 'remove', path: `schemaUses[${index}]` }]
      }
    }
    case 'set-schema-binding': {
      const index = state.schemaUses.findIndex((use) => use.useId === operation.useId)
      if (index < 0)
        return { error: error('SCHEMA_USE_NOT_FOUND', 'schemaUses', { useId: operation.useId }) }
      const use = state.schemaUses[index]
      const bindings = { ...use.bindings }
      if (operation.expression === null) delete bindings[operation.fieldName]
      else bindings[operation.fieldName] = structuredClone(operation.expression)
      return {
        state: { ...state, schemaUses: replaceAt(state.schemaUses, index, { ...use, bindings }) },
        changes: [
          {
            kind: 'update',
            path: `schemaUses[${index}].bindings[${JSON.stringify(operation.fieldName)}]`
          }
        ]
      }
    }
    case 'set-editor-state': {
      const editorState = { ...state.editorState }
      if (operation.value === undefined) delete editorState[operation.key]
      else editorState[operation.key] = structuredClone(operation.value)
      return {
        state: { ...state, editorState },
        changes: [{ kind: 'update', path: `editorState[${JSON.stringify(operation.key)}]` }]
      }
    }
  }
}

function insertNode(
  state: DefinitionState,
  parentId: string,
  requestedIndex: number | undefined,
  source: TemplateNode
): MutationResult {
  const parent = findNode(state.root, parentId)
  if (!parent) return { error: error('PARENT_NOT_FOUND', 'parentId', { parentId }) }
  if (parent.node.type !== 'frame')
    return { error: error('PARENT_NOT_FRAME', parent.path, { parentId }) }
  const index = insertionIndex(requestedIndex, parent.node.children.length)
  if (index === null) return { error: invalidIndex(`${parent.path}.children`, requestedIndex) }
  const prepared = prepareInsertedSubtree(source, state)
  const root = replaceNode(state.root, parentId, (node) => {
    if (node.type !== 'frame') return node
    return { ...node, children: insertAt(node.children, index, prepared) }
  })
  return {
    state: { ...state, root },
    changes: [{ kind: 'insert', path: `${parent.path}.children[${index}]`, subjectId: prepared.id }]
  }
}

function removeNode(state: DefinitionState, nodeId: string): MutationResult {
  if (state.root.id === nodeId) return { error: error('ROOT_NODE_IMMUTABLE', 'root', { nodeId }) }
  const found = findNode(state.root, nodeId)
  if (!found) return { error: error('NODE_NOT_FOUND', 'nodeId', { nodeId }) }
  const removed = detachNode(state.root, nodeId)
  if (!removed) return { error: error('NODE_NOT_FOUND', 'nodeId', { nodeId }) }
  return {
    state: { ...state, root: removed.root },
    changes: [{ kind: 'remove', path: found.path, subjectId: nodeId }]
  }
}

function moveNode(
  state: DefinitionState,
  nodeId: string,
  parentId: string,
  requestedIndex: number | undefined
): MutationResult {
  if (state.root.id === nodeId) return { error: error('ROOT_NODE_IMMUTABLE', 'root', { nodeId }) }
  const source = findNode(state.root, nodeId)
  if (!source) return { error: error('NODE_NOT_FOUND', 'nodeId', { nodeId }) }
  if (containsNode(source.node, parentId)) {
    return { error: error('MOVE_INTO_DESCENDANT', 'parentId', { nodeId, parentId }) }
  }
  const detached = detachNode(state.root, nodeId)
  if (!detached) return { error: error('NODE_NOT_FOUND', 'nodeId', { nodeId }) }
  const parent = findNode(detached.root, parentId)
  if (!parent) return { error: error('PARENT_NOT_FOUND', 'parentId', { parentId }) }
  if (parent.node.type !== 'frame')
    return { error: error('PARENT_NOT_FRAME', parent.path, { parentId }) }
  const index = insertionIndex(requestedIndex, parent.node.children.length)
  if (index === null) return { error: invalidIndex(`${parent.path}.children`, requestedIndex) }
  const root = replaceNode(detached.root, parentId, (node) =>
    node.type === 'frame'
      ? { ...node, children: insertAt(node.children, index, detached.node) }
      : node
  )
  return {
    state: { ...state, root },
    changes: [
      {
        kind: 'move',
        path: `${parent.path}.children[${index}]`,
        previousPath: source.path,
        subjectId: nodeId
      }
    ]
  }
}

function copyNode(
  state: DefinitionState,
  nodeId: string,
  parentId: string,
  requestedIndex: number | undefined
): MutationResult {
  const source = findNode(state.root, nodeId)
  if (!source) return { error: error('NODE_NOT_FOUND', 'nodeId', { nodeId }) }
  return insertNode(state, parentId, requestedIndex, source.node)
}

function reconcileFunctionCall(
  state: DefinitionState,
  nodeId: string,
  signature: FunctionCallSignature
): MutationResult {
  const names = collectLocalNames(state.root, state.reservedNames, nodeId)
  const found = findNode(state.root, nodeId)
  if (!found) return { error: error('NODE_NOT_FOUND', 'nodeId', { nodeId }) }
  if (found.node.type !== 'function')
    return {
      error: error('WRONG_NODE_TYPE', found.path, { expected: 'function', actual: found.node.type })
    }
  const inputs: Record<string, StaticValueExpression> = {}
  signature.inputs.forEach((input) => {
    const current = found.node.type === 'function' ? found.node.inputs[input.name] : undefined
    inputs[input.name] = structuredClone(
      current?.type === input.type ? current : defaultExpression(input.type)
    )
  })
  const outputNames: Record<string, string> = {}
  signature.outputs.forEach((output) => {
    const current = found.node.type === 'function' ? found.node.outputNames[output.name] : undefined
    outputNames[output.name] =
      current && !names.has(current)
        ? reserveName(current, names)
        : allocateGeneratedName(output.name, names)
  })
  const root = replaceNode(state.root, nodeId, (node) =>
    node.type === 'function' ? { ...node, inputs, outputNames } : node
  )
  return {
    state: { ...state, root },
    changes: [{ kind: 'update', path: found.path }]
  }
}

type NodeEditResult<T extends TemplateNode> =
  | { node: T; changes: DocumentEditChange[] }
  | { error: DocumentEditError }

function editPage(
  state: DefinitionState,
  nodeId: string,
  edit: (
    node: Extract<TemplateNode, { type: 'page' }>,
    path: string
  ) => NodeEditResult<Extract<TemplateNode, { type: 'page' }>>
): MutationResult {
  return editTypedNode(state, nodeId, 'page', edit)
}

function editChoiceQuestion(
  state: DefinitionState,
  nodeId: string,
  edit: (
    node: Extract<TemplateNode, { type: 'choice-question' }>,
    path: string
  ) => NodeEditResult<Extract<TemplateNode, { type: 'choice-question' }>>
): MutationResult {
  return editTypedNode(state, nodeId, 'choice-question', edit)
}

function editTypedNode<TType extends TemplateNode['type']>(
  state: DefinitionState,
  nodeId: string,
  type: TType,
  edit: (
    node: Extract<TemplateNode, { type: TType }>,
    path: string
  ) => NodeEditResult<Extract<TemplateNode, { type: TType }>>
): MutationResult {
  const found = findNode(state.root, nodeId)
  if (!found) return { error: error('NODE_NOT_FOUND', 'nodeId', { nodeId }) }
  if (found.node.type !== type) {
    return {
      error: error('WRONG_NODE_TYPE', found.path, { expected: type, actual: found.node.type })
    }
  }
  const edited = edit(found.node as Extract<TemplateNode, { type: TType }>, found.path)
  if ('error' in edited) return edited
  return {
    state: { ...state, root: replaceNode(state.root, nodeId, () => edited.node) },
    changes: edited.changes
  }
}

function updateNodeByType<TType extends TemplateNode['type']>(
  state: DefinitionState,
  nodeId: string,
  type: TType,
  update: (node: Extract<TemplateNode, { type: TType }>) => Extract<TemplateNode, { type: TType }>
): MutationResult {
  return editTypedNode(state, nodeId, type, (node, path) => ({
    node: update(node),
    changes: [{ kind: 'update', path }]
  }))
}

interface FoundNode {
  node: TemplateNode
  path: string
}

function findNode(root: FrameNode, nodeId: string): FoundNode | null {
  const visit = (node: TemplateNode, path: string): FoundNode | null => {
    if (node.id === nodeId) return { node, path }
    if (node.type !== 'frame') return null
    for (let index = 0; index < node.children.length; index += 1) {
      const found = visit(node.children[index], `${path}.children[${index}]`)
      if (found) return found
    }
    return null
  }
  return visit(root, 'root')
}

function replaceNode(
  node: TemplateNode,
  nodeId: string,
  update: (node: TemplateNode) => TemplateNode
): FrameNode
function replaceNode(
  node: TemplateNode,
  nodeId: string,
  update: (node: TemplateNode) => TemplateNode
): TemplateNode {
  if (node.id === nodeId) return update(node)
  if (node.type !== 'frame') return node
  let changed = false
  const children = node.children.map((child) => {
    const next = replaceNode(child, nodeId, update)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...node, children } : node
}

function detachNode(
  root: FrameNode,
  nodeId: string
): { root: FrameNode; node: TemplateNode } | null {
  let detached: TemplateNode | null = null
  const visit = (frame: FrameNode): FrameNode => {
    let changed = false
    const children: TemplateNode[] = []
    frame.children.forEach((child) => {
      if (!detached && child.id === nodeId) {
        detached = child
        changed = true
        return
      }
      if (!detached && child.type === 'frame') {
        const next = visit(child)
        if (next !== child) changed = true
        children.push(next)
      } else {
        children.push(child)
      }
    })
    return changed ? { ...frame, children } : frame
  }
  const nextRoot = visit(root)
  return detached ? { root: nextRoot, node: detached } : null
}

function containsNode(node: TemplateNode, nodeId: string): boolean {
  return (
    node.id === nodeId ||
    (node.type === 'frame' && node.children.some((child) => containsNode(child, nodeId)))
  )
}

function prepareInsertedSubtree(source: TemplateNode, state: DefinitionState): TemplateNode {
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

function prepareTimelineStep(step: TimelineStep, usedNames: Set<string>): TimelineStep {
  const copy = structuredClone(step)
  return copy.type === 'record'
    ? { ...copy, outputName: allocateName(copy.outputName, 'recording', usedNames) }
    : copy
}

function collectNodeIds(root: FrameNode): Set<string> {
  const ids = new Set<string>()
  const visit = (node: TemplateNode): void => {
    ids.add(node.id)
    if (node.type === 'frame') node.children.forEach(visit)
  }
  visit(root)
  return ids
}

function collectLocalNames(
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

function mapFrameExpressions(
  frame: FrameNode,
  mapRef: (ref: VariableRef) => VariableRef
): FrameNode {
  return mapNodeExpressions(frame, mapRef) as FrameNode
}

function mapNodeExpressions(
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

function mapTimelineExpression(
  step: TimelineStep,
  mapRef: (ref: VariableRef) => VariableRef
): TimelineStep {
  if (step.type === 'play')
    return { ...step, src: mapStaticExpression(step.src, mapRef) as typeof step.src }
  if (step.type === 'countdown')
    return { ...step, seconds: mapStaticExpression(step.seconds, mapRef) as typeof step.seconds }
  return { ...step, duration: mapStaticExpression(step.duration, mapRef) as typeof step.duration }
}

function mapStaticExpression(
  expression: StaticValueExpression,
  mapRef: (ref: VariableRef) => VariableRef
): StaticValueExpression {
  if ('parts' in expression) return mapTextExpression(expression, mapRef)
  return expression.source === 'variable'
    ? { ...expression, ref: mapRef(expression.ref) }
    : expression
}

function mapTextExpression(
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

function mapSchemaUses(
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

function mapSchemaExpression(
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

function renameLocalReferences(
  content: FunctionContent,
  previous: string,
  next: string
): FunctionContent {
  const mapRef = (ref: VariableRef): VariableRef =>
    ref.scope === 'local' && ref.name === previous ? { ...ref, name: next } : ref
  return {
    ...content,
    body: mapFrameExpressions(content.body, mapRef),
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
          expression: mapStaticExpression(output.expression, mapRef) as typeof output.expression
        }
      }
      if (output.type === 'number') {
        return {
          ...output,
          expression: mapStaticExpression(output.expression, mapRef) as typeof output.expression
        }
      }
      return {
        ...output,
        expression: mapStaticExpression(output.expression, mapRef) as typeof output.expression
      }
    }),
    schemaUses: mapSchemaUses(content.schemaUses, mapRef).map((use) => ({
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
}

function rewriteChoiceViewport(
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

function removeChoiceOverrides(timeline: readonly TimelineStep[], blockId: string): TimelineStep[] {
  return timeline.map((step) => {
    if (!step.choiceViewOverrides || !(blockId in step.choiceViewOverrides)) return step
    const choiceViewOverrides = { ...step.choiceViewOverrides }
    delete choiceViewOverrides[blockId]
    if (Object.keys(choiceViewOverrides).length > 0) return { ...step, choiceViewOverrides }
    const withoutOverrides = { ...step }
    delete withoutOverrides.choiceViewOverrides
    return withoutOverrides
  })
}

function renameChoiceOverrides(
  timeline: readonly TimelineStep[],
  previous: string,
  next: string
): TimelineStep[] {
  return timeline.map((step) => {
    if (!step.choiceViewOverrides || !(previous in step.choiceViewOverrides)) return step
    const choiceViewOverrides = {
      ...step.choiceViewOverrides,
      [next]: step.choiceViewOverrides[previous]
    }
    delete choiceViewOverrides[previous]
    return { ...step, choiceViewOverrides }
  })
}

function defaultExpression(type: ValueType): StaticValueExpression {
  if (type === 'number') return { type: 'number', source: 'literal', value: 0 }
  if (type === 'file') return { type: 'file', source: 'literal', value: '' }
  return { type: 'string', source: 'literal', value: '' }
}

function allocateId(suggestion: string, fallback: string, used: Set<string>): string {
  const base = suggestion.trim() || fallback
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let suffix = 1
  while (used.has(`${base}-${suffix}`)) suffix += 1
  const value = `${base}-${suffix}`
  used.add(value)
  return value
}

function allocateName(suggestion: string, fallback: string, used: Set<string>): string {
  const normalized = normalizeLocalName(suggestion) || fallback
  if (!used.has(normalized)) return reserveName(normalized, used)
  return allocateGeneratedName(normalized, used)
}

function allocateGeneratedName(suggestion: string, used: Set<string>): string {
  const base = normalizeLocalName(suggestion) || 'output'
  let suffix = 1
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return reserveName(`${base}-${suffix}`, used)
}

function reserveName(value: string, used: Set<string>): string {
  used.add(value)
  return value
}

function normalizeLocalName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!normalized) return ''
  return /^[a-zA-Z_]/.test(normalized) ? normalized : `value-${normalized}`
}

function nodeIdBase(type: TemplateNode['type']): string {
  return type === 'choice-question'
    ? 'choice-question'
    : type === 'function'
      ? 'function-call'
      : type
}

function pruneResources(
  root: FrameNode,
  document: TemplateDocument
): TemplateDocument['resources'] {
  const byId = new Map(document.resources.functions.map((resource) => [resource.id, resource]))
  const reachable = new Set<string>()
  const visit = (frame: FrameNode): void => {
    frame.children.forEach((node) => {
      if (node.type === 'frame') visit(node)
      if (node.type !== 'function' || reachable.has(node.functionRef)) return
      reachable.add(node.functionRef)
      const resource = byId.get(node.functionRef)
      if (resource) visit(resource.body)
    })
  }
  visit(root)
  if (reachable.size === document.resources.functions.length) return document.resources
  return {
    functions: document.resources.functions.filter((resource) => reachable.has(resource.id))
  }
}

function insertionIndex(index: number | undefined, length: number): number | null {
  const value = index ?? length
  return Number.isInteger(value) && value >= 0 && value <= length ? value : null
}

function moveTargetIndex(index: number, length: number): number | null {
  return Number.isInteger(index) && index >= 0 && index < length ? index : null
}

function hasIndex<T>(values: readonly T[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < values.length
}

function insertAt<T>(values: readonly T[], index: number, value: T): T[] {
  return [...values.slice(0, index), value, ...values.slice(index)]
}

function replaceAt<T>(values: readonly T[], index: number, value: T): T[] {
  return values.map((item, current) => (current === index ? value : item))
}

function removeAt<T>(values: readonly T[], index: number): T[] {
  return values.filter((_item, current) => current !== index)
}

function moveAt<T>(values: readonly T[], index: number, target: number): T[] {
  if (index === target) return [...values]
  const copy = [...values]
  const [value] = copy.splice(index, 1)
  copy.splice(target, 0, value)
  return copy
}

function invalidIndex(path: string, index: number | undefined): DocumentEditError {
  return error('INVALID_INDEX', path, { index: index ?? -1 })
}

function error(
  code: DocumentEditErrorCode,
  path: string,
  params: Readonly<Record<string, string | number>> = {}
): DocumentEditError {
  return { code, path, params }
}

function applied<TDocument, TOperation>(
  previousDocument: TDocument,
  operation: TOperation,
  document: TDocument,
  changes: readonly DocumentEditChange[]
): DocumentEditResult<TDocument, TOperation> {
  return { applied: true, document, previousDocument, operation, changes }
}

function rejected<TDocument, TOperation>(
  document: TDocument,
  operation: TOperation,
  editError: DocumentEditError
): DocumentEditResult<TDocument, TOperation> {
  return { applied: false, document, operation, error: editError }
}
