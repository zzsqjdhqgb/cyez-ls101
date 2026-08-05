import type { TemplateDocument } from '../types'
import { applyDefinitionOperation } from './definition'
import { error, insertAt, insertionIndex, invalidIndex, removeAt, replaceAt } from './identifiers'
import { pruneResources } from './resources'
import { applied, rejected } from './result'
import { mapFrameExpressions, mapSchemaUses } from './rewrite'
import type { DefinitionOperation, DocumentEditResult, TemplateDocumentOperation } from './types'

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
