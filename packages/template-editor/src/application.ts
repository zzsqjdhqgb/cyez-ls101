import type { InterfaceVarManifest, SchemaBlockManifest } from '@ls101/core-types'
import { compileTemplate } from './compiler'
import type {
  LocatedInterfaceInstance,
  TemplateCompileResult,
  TemplateInterfaceBinding
} from './compiler/shared'
import {
  canonicalizeFunctionContent,
  createFunctionDocument,
  createFunctionResource,
  createTemplateDocument
} from './id'
import { editTemplateDocument } from './mutations'
import type { TemplateRepository } from './repository'
import type {
  DslEditorState,
  FrameNode,
  FunctionContent,
  FunctionDef,
  FunctionDocument,
  SchemaUse,
  TemplateContent,
  TemplateDocument,
  TemplateNode
} from './types'
import {
  validateTemplateDocument,
  type TemplateDocumentValidationContext,
  type TemplateValidationResult
} from './validation'

export interface TemplateSummary {
  templateId: string
  name: string
  description: string
}

export interface FunctionSummary {
  functionId: string
  name: string
}

export interface EmbeddedFunctionResult {
  template: TemplateDocument
  functionRef: string
}

export interface InsertedFunctionCallResult extends EmbeddedFunctionResult {
  callNodeId: string
}

export interface TemplateBrowserApplication {
  listTemplates(): Promise<TemplateSummary[]>
  listFunctions(): Promise<FunctionSummary[]>
}

export interface TemplateDocumentApplication {
  create(
    initial?: Partial<TemplateContent>,
    editorState?: DslEditorState
  ): Promise<TemplateDocument>
  get(templateId: string): Promise<TemplateDocument | null>
  save(document: TemplateDocument): Promise<TemplateDocument>
  delete(templateId: string): Promise<void>
  embedFunction(templateId: string, functionId: string): Promise<EmbeddedFunctionResult>
  insertFunctionCall(
    templateId: string,
    functionId: string,
    parentId: string,
    index?: number
  ): Promise<InsertedFunctionCallResult>
  pruneFunctionResources(templateId: string): Promise<TemplateDocument>
  validate(templateId: string): Promise<TemplateValidationResult>
  compile(
    templateId: string,
    selections: readonly TemplateInterfaceBinding[]
  ): Promise<TemplateCompileResult>
}

export interface FunctionDocumentApplication {
  create(
    initial?: Partial<FunctionContent>,
    editorState?: DslEditorState
  ): Promise<FunctionDocument>
  get(functionId: string): Promise<FunctionDocument | null>
  save(document: FunctionDocument): Promise<FunctionDocument>
  delete(functionId: string): Promise<void>
}

export interface TemplateApplication {
  readonly browser: TemplateBrowserApplication
  readonly templates: TemplateDocumentApplication
  readonly functions: FunctionDocumentApplication
}

export interface TemplateApplicationDependencies {
  repository: TemplateRepository
  getInterfaceManifest(interfaceId: string): Promise<InterfaceVarManifest | null>
  getSchemaManifest(schemaId: string): Promise<SchemaBlockManifest | null>
  locateInterfaceInstance(
    instanceId: string
  ): LocatedInterfaceInstance | null | Promise<LocatedInterfaceInstance | null>
}

export class TemplateApplicationError extends Error {
  constructor(
    public readonly code:
      | 'TEMPLATE_NOT_FOUND'
      | 'FUNCTION_NOT_FOUND'
      | 'RECURSIVE_FUNCTION_DEPENDENCY'
      | 'FUNCTION_RESOURCE_COLLISION'
      | 'EDIT_REJECTED',
    message: string,
    public readonly params: Readonly<Record<string, string>> = {}
  ) {
    super(message)
    this.name = 'TemplateApplicationError'
  }
}

const EMPTY_TEMPLATE_CONTENT: TemplateContent = {
  name: '',
  description: '',
  interfaces: [],
  root: { id: 'root', type: 'frame', children: [] },
  schemaUses: []
}

const EMPTY_FUNCTION_CONTENT: FunctionContent = {
  name: '',
  inputs: [],
  body: { id: 'root', type: 'frame', children: [] },
  outputs: [],
  schemaUses: []
}

export function createTemplateApplication(
  dependencies: TemplateApplicationDependencies
): TemplateApplication {
  const { repository } = dependencies

  const loadTemplate = async (templateId: string): Promise<TemplateDocument> => {
    const document = await repository.getTemplate(templateId)
    if (!document) {
      throw new TemplateApplicationError(
        'TEMPLATE_NOT_FOUND',
        `Template not found: ${templateId}`,
        {
          templateId
        }
      )
    }
    return document
  }

  const loadValidationContext = async (
    document: TemplateDocument
  ): Promise<TemplateDocumentValidationContext> => {
    const interfaceIds = unique(document.content.interfaces.map((item) => item.interfaceId))
    const schemaIds = collectSchemaIds(document)
    const [interfaces, schemas] = await Promise.all([
      Promise.all(interfaceIds.map((id) => dependencies.getInterfaceManifest(id))),
      Promise.all(schemaIds.map((id) => dependencies.getSchemaManifest(id)))
    ])
    return {
      interfaceManifests: interfaces.filter((item) => item !== null),
      schemaManifests: schemas.filter((item) => item !== null)
    }
  }

  const embedFunctionClosure = async (
    template: TemplateDocument,
    functionId: string
  ): Promise<{ template: TemplateDocument; resource: FunctionDef }> => {
    const resources = new Map(template.resources.functions.map((item) => [item.id, item]))
    const bySourceId = new Map<string, FunctionDef>()

    const snapshot = async (sourceId: string, stack: readonly string[]): Promise<FunctionDef> => {
      const cached = bySourceId.get(sourceId)
      if (cached) return cached
      if (stack.includes(sourceId)) {
        const chain = [...stack, sourceId]
        throw new TemplateApplicationError(
          'RECURSIVE_FUNCTION_DEPENDENCY',
          `Recursive function dependency: ${chain.join(' -> ')}`,
          { functionId: sourceId, chain: chain.join(' -> ') }
        )
      }
      const source = await repository.getFunction(sourceId)
      if (!source) {
        throw new TemplateApplicationError(
          'FUNCTION_NOT_FOUND',
          `Function not found: ${sourceId}`,
          { functionId: sourceId }
        )
      }
      const body = await rewriteFunctionRefs(source.content.body, (nestedId) =>
        snapshot(nestedId, [...stack, sourceId])
      )
      const resource = await createFunctionResource({ ...source.content, body })
      const existing = resources.get(resource.id)
      if (
        existing &&
        canonicalizeFunctionContent(existing) !== canonicalizeFunctionContent(resource)
      ) {
        throw new TemplateApplicationError(
          'FUNCTION_RESOURCE_COLLISION',
          `Function resource ID collision: ${resource.id}`,
          { resourceId: resource.id }
        )
      }
      resources.set(resource.id, existing ?? resource)
      bySourceId.set(sourceId, existing ?? resource)
      return existing ?? resource
    }

    const resource = await snapshot(functionId, [])
    return {
      template: {
        ...template,
        resources: { functions: [...resources.values()] }
      },
      resource
    }
  }

  return {
    browser: {
      async listTemplates() {
        const documents = await Promise.all(
          (await repository.listTemplateIds()).map((id) => repository.getTemplate(id))
        )
        return documents
          .filter((item) => item !== null)
          .map(({ templateId, content }) => ({
            templateId,
            name: content.name,
            description: content.description
          }))
      },
      async listFunctions() {
        const documents = await Promise.all(
          (await repository.listFunctionIds()).map((id) => repository.getFunction(id))
        )
        return documents
          .filter((item) => item !== null)
          .map(({ functionId, content }) => ({ functionId, name: content.name }))
      }
    },
    templates: {
      async create(initial = {}, editorState = {}) {
        const document = createTemplateDocument(
          { ...structuredClone(EMPTY_TEMPLATE_CONTENT), ...structuredClone(initial) },
          { functions: [] },
          editorState
        )
        return repository.saveTemplate(document)
      },
      get: (templateId) => repository.getTemplate(templateId),
      save: (document) => repository.saveTemplate(document),
      delete: (templateId) => repository.deleteTemplate(templateId),
      async embedFunction(templateId, functionId) {
        const template = await loadTemplate(templateId)
        const embedded = await embedFunctionClosure(template, functionId)
        const saved = await repository.saveTemplate(embedded.template)
        return { template: saved, functionRef: embedded.resource.id }
      },
      async insertFunctionCall(templateId, functionId, parentId, index) {
        const template = await loadTemplate(templateId)
        const embedded = await embedFunctionClosure(template, functionId)
        const edited = editTemplateDocument(embedded.template, {
          type: 'insert-function-call',
          parentId,
          index,
          functionRef: embedded.resource.id,
          signature: embedded.resource
        })
        if (!edited.applied) {
          throw new TemplateApplicationError(
            'EDIT_REJECTED',
            `Function call insertion rejected: ${edited.error.code} at ${edited.error.path}`,
            { code: edited.error.code, path: edited.error.path }
          )
        }
        const callNodeId = edited.changes.find(
          (change) => change.kind === 'insert' && change.subjectId !== undefined
        )?.subjectId
        if (!callNodeId) {
          throw new TemplateApplicationError(
            'EDIT_REJECTED',
            'Function call insertion did not report the inserted node',
            { code: 'MISSING_INSERT_RESULT', path: 'content.root' }
          )
        }
        const saved = await repository.saveTemplate(edited.document)
        return { template: saved, functionRef: embedded.resource.id, callNodeId }
      },
      async pruneFunctionResources(templateId) {
        const template = await loadTemplate(templateId)
        const resources = new Map(template.resources.functions.map((item) => [item.id, item]))
        const reachable = collectReachableFunctionIds(template.content.root, resources)
        const updated = {
          ...template,
          resources: {
            functions: template.resources.functions.filter((item) => reachable.has(item.id))
          }
        }
        return repository.saveTemplate(updated)
      },
      async validate(templateId) {
        const document = await loadTemplate(templateId)
        return validateTemplateDocument(document, await loadValidationContext(document))
      },
      async compile(templateId, selections) {
        const document = await loadTemplate(templateId)
        const manifests = await loadValidationContext(document)
        return compileTemplate(document, {
          ...manifests,
          interfaceBindings: selections,
          locateInterfaceInstance: dependencies.locateInterfaceInstance
        })
      }
    },
    functions: {
      async create(initial = {}, editorState = {}) {
        const document = createFunctionDocument(
          { ...structuredClone(EMPTY_FUNCTION_CONTENT), ...structuredClone(initial) },
          editorState
        )
        return repository.saveFunction(document)
      },
      get: (functionId) => repository.getFunction(functionId),
      save: (document) => repository.saveFunction(document),
      delete: (functionId) => repository.deleteFunction(functionId)
    }
  }
}

async function rewriteFunctionRefs(
  frame: FrameNode,
  resolve: (functionId: string) => Promise<FunctionDef>
): Promise<FrameNode> {
  const children: TemplateNode[] = []
  for (const child of frame.children) {
    if (child.type === 'frame') {
      children.push(await rewriteFunctionRefs(child, resolve))
    } else if (child.type === 'function') {
      const resource = await resolve(child.functionRef)
      children.push({ ...structuredClone(child), functionRef: resource.id })
    } else {
      children.push(structuredClone(child))
    }
  }
  return { ...structuredClone(frame), children }
}

function collectReachableFunctionIds(
  root: FrameNode,
  resources: ReadonlyMap<string, FunctionDef>
): Set<string> {
  const reachable = new Set<string>()
  const visitFrame = (frame: FrameNode): void => {
    frame.children.forEach((node) => {
      if (node.type === 'frame') {
        visitFrame(node)
        return
      }
      if (node.type !== 'function' || reachable.has(node.functionRef)) return
      reachable.add(node.functionRef)
      const resource = resources.get(node.functionRef)
      if (resource) visitFrame(resource.body)
    })
  }
  visitFrame(root)
  return reachable
}

function collectSchemaIds(document: TemplateDocument): string[] {
  const resources = new Map(document.resources.functions.map((item) => [item.id, item]))
  const reachable = collectReachableFunctionIds(document.content.root, resources)
  const uses: SchemaUse[] = [...document.content.schemaUses]
  reachable.forEach((id) => {
    const resource = resources.get(id)
    if (resource) uses.push(...resource.schemaUses)
  })
  return unique(uses.map((use) => use.schemaId))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
