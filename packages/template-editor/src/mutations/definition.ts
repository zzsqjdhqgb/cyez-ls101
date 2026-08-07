import type { FrameNode, FunctionNode, StaticValueExpression, TemplateNode } from '../types'
import {
  allocateId,
  allocateGeneratedName,
  error,
  hasIndex,
  insertAt,
  insertionIndex,
  invalidIndex,
  moveAt,
  moveTargetIndex,
  removeAt,
  reserveName,
  replaceAt
} from './identifiers'
import { prepareTimelineStep, removeChoiceOverrides, renameChoiceOverrides } from './page'
import { collectLocalNames, defaultExpression, prepareInsertedSubtree } from './rewrite'
import type {
  DefinitionOperation,
  DefinitionState,
  DocumentEditChange,
  DocumentEditError,
  FunctionCallSignature,
  MutationResult
} from './types'

export function applyDefinitionOperation(
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
        name: operation.signature.name ?? '函数调用',
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
    case 'set-node-name':
      return updateNode(state, operation.nodeId, (node) => ({ ...node, name: operation.value }))
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

function updateNode(
  state: DefinitionState,
  nodeId: string,
  update: (node: TemplateNode) => TemplateNode
): MutationResult {
  const found = findNode(state.root, nodeId)
  if (!found) return { error: error('NODE_NOT_FOUND', 'nodeId', { nodeId }) }
  return {
    state: { ...state, root: replaceNode(state.root, nodeId, update) },
    changes: [{ kind: 'update', path: found.path }]
  }
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
