import type { FunctionContent, FunctionDocument, TemplateNode } from '../types'
import { applyDefinitionOperation } from './definition'
import { error, insertAt, insertionIndex, invalidIndex, removeAt, replaceAt } from './identifiers'
import { applied, rejected } from './result'
import { renameLocalReferences } from './rewrite'
import type { DefinitionOperation, DocumentEditResult, FunctionDocumentOperation } from './types'

export function editFunctionDocument(
  document: FunctionDocument,
  operation: FunctionDocumentOperation
): DocumentEditResult<FunctionDocument, FunctionDocumentOperation> {
  const direct = editFunctionMetadata(document, operation)
  if (direct) return direct

  const outputRename = detectLocalOutputRename(
    document.content.body,
    operation as DefinitionOperation
  )

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
  let content: FunctionContent = {
    ...document.content,
    body: result.state.root,
    schemaUses: result.state.schemaUses
  }
  if (outputRename) {
    content = renameLocalReferences(content, outputRename.previous, outputRename.next)
  }
  return applied(
    document,
    operation,
    {
      ...document,
      content,
      editorState: result.state.editorState
    },
    result.changes
  )
}

function detectLocalOutputRename(
  root: FunctionContent['body'],
  operation: DefinitionOperation
): { previous: string; next: string } | null {
  const node = findNode(root, 'nodeId' in operation ? operation.nodeId : '')
  if (
    operation.type === 'set-function-call-output-name' &&
    operation.value !== null &&
    node?.type === 'function'
  ) {
    return changedName(node.outputNames[operation.outputName], operation.value)
  }
  if (
    operation.type === 'set-choice-question' &&
    operation.outputName !== undefined &&
    node?.type === 'choice-question'
  ) {
    return changedName(node.outputName, operation.outputName)
  }
  if (
    operation.type === 'set-variable' &&
    operation.variableName !== undefined &&
    node?.type === 'variable'
  ) {
    return changedName(node.variableName, operation.variableName)
  }
  if (operation.type === 'update-timeline-step') {
    const page = findNode(root, operation.pageId)
    const step = page?.type === 'page' ? page.timeline[operation.index] : undefined
    if (step?.type === 'record' && operation.step.type === 'record') {
      return changedName(step.outputName, operation.step.outputName)
    }
  }
  return null
}

function changedName(
  previous: string | undefined,
  next: string
): { previous: string; next: string } | null {
  return previous !== undefined && previous !== next ? { previous, next } : null
}

function findNode(node: TemplateNode, nodeId: string): TemplateNode | null {
  if (node.id === nodeId) return node
  if (node.type !== 'frame') return null
  for (const child of node.children) {
    const found = findNode(child, nodeId)
    if (found) return found
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
