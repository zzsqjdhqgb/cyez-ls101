import type { InterfaceVarManifest, SchemaDefinition } from '@ls101/core-types'
import { initializeBuiltinFunctionLibraries } from './builtin-initializer'
import { compileTemplate, compileTemplatePreview } from './compiler'
import type {
  GeneratedTimelineAudio,
  LocatedInterfaceInstance,
  TemplateCompileResult,
  TemplatePreviewResult,
  TemplateInterfaceBinding
} from './compiler/shared'
import {
  canonicalizeFunctionContent,
  createFunctionDocument,
  createFunctionId,
  createFunctionResource,
  createLocalFunctionLibraryDocument,
  createTemplateDocument
} from './id'
import { editFunctionDocument, editTemplateDocument } from './mutations'
import type { TemplateRepository } from './repository'
import type {
  DslEditorState,
  FrameNode,
  FunctionContent,
  FunctionDef,
  FunctionDocument,
  FunctionLibraryLocator,
  FunctionLibraryEntry,
  FunctionLibraryRelease,
  FunctionLocator,
  LocalFunctionLibraryDocument,
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
  component?: TemplateNode
}

export interface FunctionLibrarySummary {
  source: FunctionLibraryLocator['source']
  libraryId: string
  version?: number
  name: string
  functions: FunctionSummary[]
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
  listFunctionLibraries(): Promise<FunctionLibrarySummary[]>
  listInterfaces(): Promise<InterfaceVarManifest[]>
  listInterfaceInstances(interfaceId: string): Promise<TemplateInterfaceInstanceSummary[]>
}

export interface TemplateInterfaceInstanceSummary {
  instanceId: string
  name: string
  generatedAt: string
}

export interface TemplateCompileOptions {
  synthesizeSpeech?(text: string): Promise<GeneratedTimelineAudio>
}

export interface TemplateDocumentApplication {
  create(
    initial?: Partial<TemplateContent>,
    editorState?: DslEditorState
  ): Promise<TemplateDocument>
  get(templateId: string): Promise<TemplateDocument | null>
  save(document: TemplateDocument): Promise<TemplateDocument>
  delete(templateId: string): Promise<void>
  embedFunction(templateId: string, locator: FunctionLocator): Promise<EmbeddedFunctionResult>
  insertFunctionCall(
    templateId: string,
    locator: FunctionLocator,
    parentId: string,
    index?: number
  ): Promise<InsertedFunctionCallResult>
  pruneFunctionResources(templateId: string): Promise<TemplateDocument>
  validate(templateId: string): Promise<TemplateValidationResult>
  compile(
    templateId: string,
    selections: readonly TemplateInterfaceBinding[],
    options?: TemplateCompileOptions
  ): Promise<TemplateCompileResult>
  preview(
    document: TemplateDocument,
    selections: readonly TemplateInterfaceBinding[]
  ): Promise<TemplatePreviewResult>
}

export interface LocalFunctionLibraryApplication {
  create(name?: string): Promise<LocalFunctionLibraryDocument>
  get(libraryId: string): Promise<LocalFunctionLibraryDocument | null>
  save(document: LocalFunctionLibraryDocument): Promise<LocalFunctionLibraryDocument>
  delete(libraryId: string): Promise<void>
  createFunction(
    libraryId: string,
    initial?: Partial<FunctionContent>,
    editorState?: DslEditorState
  ): Promise<{ library: LocalFunctionLibraryDocument; function: FunctionDocument }>
  getFunction(libraryId: string, functionId: string): Promise<FunctionDocument | null>
  saveFunction(
    library: LocalFunctionLibraryDocument,
    functionDocument: FunctionDocument
  ): Promise<LocalFunctionLibraryDocument>
  insertFunctionCall(
    libraryId: string,
    functionId: string,
    locator: FunctionLocator,
    parentId: string,
    index?: number
  ): Promise<{
    library: LocalFunctionLibraryDocument
    function: FunctionDocument
    callNodeId: string
  }>
  deleteFunction(
    library: LocalFunctionLibraryDocument,
    functionId: string
  ): Promise<LocalFunctionLibraryDocument>
}

export interface ImportedFunctionLibraryApplication {
  register(release: FunctionLibraryRelease): Promise<FunctionLibraryRelease>
  delete(libraryId: string, version: number): Promise<void>
}

export interface FunctionLibraryApplication {
  readonly local: LocalFunctionLibraryApplication
  readonly imported: ImportedFunctionLibraryApplication
}

export interface TemplateApplication {
  initialize(): Promise<void>
  readonly browser: TemplateBrowserApplication
  readonly templates: TemplateDocumentApplication
  readonly functionLibraries: FunctionLibraryApplication
}

export interface TemplateApplicationDependencies {
  repository: TemplateRepository
  getBuiltinFunctionLibraryManifest?(): Promise<unknown | null>
  listInterfaceManifests?(): Promise<InterfaceVarManifest[]>
  listInterfaceInstances?(interfaceId: string): Promise<TemplateInterfaceInstanceSummary[]>
  getInterfaceManifest(interfaceId: string): Promise<InterfaceVarManifest | null>
  getSchema(schemaId: string): Promise<SchemaDefinition | null>
  locateInterfaceInstance(
    instanceId: string
  ): LocatedInterfaceInstance | null | Promise<LocatedInterfaceInstance | null>
}

export class TemplateApplicationError extends Error {
  constructor(
    public readonly code:
      | 'TEMPLATE_NOT_FOUND'
      | 'FUNCTION_LIBRARY_NOT_FOUND'
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
  root: { id: 'root', name: '根框架', type: 'frame', children: [] },
  schemaUses: []
}

const EMPTY_FUNCTION_CONTENT: FunctionContent = {
  name: '',
  inputs: [],
  body: { id: 'root', name: '根框架', type: 'frame', children: [] },
  outputs: [],
  schemaUses: []
}

export function createTemplateApplication(
  dependencies: TemplateApplicationDependencies
): TemplateApplication {
  const { repository } = dependencies
  let initialization: Promise<void> | null = null

  const initialize = (): Promise<void> => {
    if (!initialization) {
      initialization = (async () => {
        if (!dependencies.getBuiltinFunctionLibraryManifest) return
        const manifest = await dependencies.getBuiltinFunctionLibraryManifest()
        if (manifest === null) {
          throw new Error('Builtin function library manifest is missing')
        }
        await initializeBuiltinFunctionLibraries(repository, manifest)
      })()
    }
    return initialization
  }

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
      Promise.all(schemaIds.map((id) => dependencies.getSchema(id)))
    ])
    return {
      interfaceManifests: interfaces.filter((item) => item !== null),
      schemaDefinitions: schemas.filter((item) => item !== null)
    }
  }

  const embedFunctionClosure = async (
    template: TemplateDocument,
    locator: FunctionLocator
  ): Promise<{ template: TemplateDocument; resource: FunctionDef }> => {
    const resources = new Map(template.resources.functions.map((item) => [item.id, item]))
    const bySourceId = new Map<string, FunctionDef>()
    const library = await loadFunctionLibrary(repository, locator.library)
    if (!library) {
      throw new TemplateApplicationError(
        'FUNCTION_LIBRARY_NOT_FOUND',
        `Function library not found: ${locator.library.libraryId}`,
        {
          source: locator.library.source,
          libraryId: locator.library.libraryId
        }
      )
    }
    const functions = new Map(library.content.functions.map((entry) => [entry.functionId, entry]))

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
      const source = functions.get(sourceId)
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

    const resource = await snapshot(locator.functionId, [])
    return {
      template: {
        ...template,
        resources: { functions: [...resources.values()] }
      },
      resource
    }
  }

  return {
    initialize,
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
      async listFunctionLibraries() {
        const [localIds, importedIds, builtinIds] = await Promise.all([
          repository.listLocalFunctionLibraryIds(),
          repository.listImportedFunctionLibraryIds(),
          repository.listBuiltinFunctionLibraryIds()
        ])
        const [locals, importedVersions, builtins] = await Promise.all([
          Promise.all(localIds.map((id) => repository.getLocalFunctionLibrary(id))),
          Promise.all(
            importedIds.map(async (libraryId) => {
              const versions = await repository.listImportedFunctionLibraryVersions(libraryId)
              return Promise.all(
                versions.map((version) => repository.getImportedFunctionLibrary(libraryId, version))
              )
            })
          ),
          Promise.all(builtinIds.map((id) => repository.getActiveBuiltinFunctionLibrary(id)))
        ])
        return [
          ...builtins
            .filter((item) => item !== null)
            .map((release) => summarizeLibrary('builtin', release)),
          ...importedVersions
            .flat()
            .filter((item) => item !== null)
            .map((release) => summarizeLibrary('imported', release)),
          ...locals.filter((item) => item !== null).map(summarizeLocalLibrary)
        ]
      },
      async listInterfaces() {
        return dependencies.listInterfaceManifests?.() ?? []
      },
      async listInterfaceInstances(interfaceId) {
        return dependencies.listInterfaceInstances?.(interfaceId) ?? []
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
      async embedFunction(templateId, locator) {
        const template = await loadTemplate(templateId)
        const embedded = await embedFunctionClosure(template, locator)
        const saved = await repository.saveTemplate(embedded.template)
        return { template: saved, functionRef: embedded.resource.id }
      },
      async insertFunctionCall(templateId, locator, parentId, index) {
        const template = await loadTemplate(templateId)
        const embedded = await embedFunctionClosure(template, locator)
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
      async compile(templateId, selections, options = {}) {
        const document = await loadTemplate(templateId)
        const manifests = await loadValidationContext(document)
        return compileTemplate(document, {
          ...manifests,
          interfaceBindings: selections,
          synthesizeSpeech: options.synthesizeSpeech,
          locateInterfaceInstance: dependencies.locateInterfaceInstance
        })
      },
      async preview(document, selections) {
        const manifests = await loadValidationContext(document)
        return compileTemplatePreview(document, {
          ...manifests,
          interfaceBindings: selections,
          locateInterfaceInstance: dependencies.locateInterfaceInstance
        })
      }
    },
    functionLibraries: {
      imported: {
        register: (release) => repository.registerImportedFunctionLibrary(release),
        delete: (libraryId, version) => repository.deleteImportedFunctionLibrary(libraryId, version)
      },
      local: {
        async create(name = '') {
          return repository.saveLocalFunctionLibrary(createLocalFunctionLibraryDocument(name))
        },
        get: (libraryId) => repository.getLocalFunctionLibrary(libraryId),
        save: (document) => repository.saveLocalFunctionLibrary(document),
        delete: (libraryId) => repository.deleteLocalFunctionLibrary(libraryId),
        async createFunction(libraryId, initial = {}, editorState = {}) {
          const library = await loadLocalFunctionLibrary(repository, libraryId)
          const functionDocument = createFunctionDocument(
            { ...structuredClone(EMPTY_FUNCTION_CONTENT), ...structuredClone(initial) },
            editorState
          )
          const updated: LocalFunctionLibraryDocument = {
            ...library,
            content: {
              ...library.content,
              functions: [
                ...library.content.functions,
                { functionId: functionDocument.functionId, content: functionDocument.content }
              ]
            },
            editorState: {
              ...library.editorState,
              functions: {
                ...library.editorState.functions,
                [functionDocument.functionId]: functionDocument.editorState
              }
            }
          }
          return {
            library: await repository.saveLocalFunctionLibrary(updated),
            function: functionDocument
          }
        },
        async getFunction(libraryId, functionId) {
          const library = await repository.getLocalFunctionLibrary(libraryId)
          if (!library) return null
          return projectFunctionDocument(library, functionId)
        },
        async saveFunction(library, functionDocument) {
          const index = library.content.functions.findIndex(
            (entry) => entry.functionId === functionDocument.functionId
          )
          if (index < 0) throw functionNotFound(functionDocument.functionId)
          const functions = [...library.content.functions]
          functions[index] = {
            ...functions[index],
            functionId: functionDocument.functionId,
            content: structuredClone(functionDocument.content)
          }
          const retainedFunctions = pruneInternalFunctionEntries(functions)
          const functionStates = retainFunctionEditorStates(
            {
              ...library.editorState.functions,
              [functionDocument.functionId]: structuredClone(functionDocument.editorState)
            },
            retainedFunctions
          )
          return repository.saveLocalFunctionLibrary({
            ...library,
            content: { ...library.content, functions: retainedFunctions },
            editorState: {
              ...library.editorState,
              functions: functionStates
            }
          })
        },
        async insertFunctionCall(libraryId, functionId, locator, parentId, index) {
          const destination = await loadLocalFunctionLibrary(repository, libraryId)
          const target = projectFunctionDocument(destination, functionId)
          if (!target) throw functionNotFound(functionId)
          const sourceLibrary = await loadFunctionLibrary(repository, locator.library)
          if (!sourceLibrary) {
            throw new TemplateApplicationError(
              'FUNCTION_LIBRARY_NOT_FOUND',
              `Function library not found: ${locator.library.libraryId}`,
              {
                source: locator.library.source,
                libraryId: locator.library.libraryId
              }
            )
          }
          const closure = collectFunctionEntryClosure(
            sourceLibrary.content.functions,
            locator.functionId
          )
          if (
            locator.library.source === 'local' &&
            locator.library.libraryId === libraryId &&
            closure.some((entry) => entry.functionId === functionId)
          ) {
            throw new TemplateApplicationError(
              'RECURSIVE_FUNCTION_DEPENDENCY',
              `Recursive function dependency: ${functionId} -> ${locator.functionId}`,
              { functionId, dependencyId: locator.functionId }
            )
          }

          const idMap = new Map(closure.map((entry) => [entry.functionId, createFunctionId()]))
          const copiedEntries = closure.map((entry) => ({
            functionId: requireMappedFunctionId(idMap, entry.functionId),
            exposed: false,
            content: {
              ...structuredClone(entry.content),
              body: rewriteCopiedFunctionRefs(entry.content.body, idMap)
            }
          }))
          const copiedRoot = copiedEntries.find(
            (entry) => entry.functionId === requireMappedFunctionId(idMap, locator.functionId)
          )
          if (!copiedRoot) throw functionNotFound(locator.functionId)
          const edited = editFunctionDocument(target, {
            type: 'insert-function-call',
            parentId,
            index,
            functionRef: copiedRoot.functionId,
            signature: copiedRoot.content
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
              { code: 'MISSING_INSERT_RESULT', path: 'content.body' }
            )
          }
          const functions = destination.content.functions.map((entry) =>
            entry.functionId === functionId
              ? { ...entry, content: structuredClone(edited.document.content) }
              : entry
          )
          const copiedEditorStates = Object.fromEntries(
            copiedEntries.map((entry) => [entry.functionId, {}])
          )
          const savedLibrary = await repository.saveLocalFunctionLibrary({
            ...destination,
            content: { ...destination.content, functions: [...functions, ...copiedEntries] },
            editorState: {
              ...destination.editorState,
              functions: {
                ...destination.editorState.functions,
                ...copiedEditorStates,
                [functionId]: structuredClone(edited.document.editorState)
              }
            }
          })
          const savedFunction = projectFunctionDocument(savedLibrary, functionId)
          if (!savedFunction) throw functionNotFound(functionId)
          return { library: savedLibrary, function: savedFunction, callNodeId }
        },
        async deleteFunction(library, functionId) {
          if (!library.content.functions.some((entry) => entry.functionId === functionId)) {
            throw functionNotFound(functionId)
          }
          const functionStates = { ...library.editorState.functions }
          delete functionStates[functionId]
          const retainedFunctions = pruneInternalFunctionEntries(
            library.content.functions.filter((entry) => entry.functionId !== functionId)
          )
          return repository.saveLocalFunctionLibrary({
            ...library,
            content: {
              ...library.content,
              functions: retainedFunctions
            },
            editorState: {
              ...library.editorState,
              functions: retainFunctionEditorStates(functionStates, retainedFunctions)
            }
          })
        }
      }
    }
  }
}

async function loadFunctionLibrary(
  repository: TemplateRepository,
  locator: FunctionLibraryLocator
): Promise<LocalFunctionLibraryDocument | FunctionLibraryRelease | null> {
  if (locator.source === 'local') {
    return repository.getLocalFunctionLibrary(locator.libraryId)
  }
  if (locator.source === 'imported') {
    return repository.getImportedFunctionLibrary(locator.libraryId, locator.version)
  }
  return repository.getActiveBuiltinFunctionLibrary(locator.libraryId)
}

async function loadLocalFunctionLibrary(
  repository: TemplateRepository,
  libraryId: string
): Promise<LocalFunctionLibraryDocument> {
  const library = await repository.getLocalFunctionLibrary(libraryId)
  if (!library) {
    throw new TemplateApplicationError(
      'FUNCTION_LIBRARY_NOT_FOUND',
      `Function library not found: ${libraryId}`,
      { source: 'local', libraryId }
    )
  }
  return library
}

function summarizeLibrary(
  source: 'builtin' | 'imported',
  release: FunctionLibraryRelease
): FunctionLibrarySummary {
  return {
    source,
    libraryId: release.libraryId,
    version: release.version,
    name: release.content.name,
    functions: release.content.functions
      .filter((entry) => entry.exposed !== false)
      .map(({ functionId, content }) => {
        const component =
          source === 'builtin' &&
          release.libraryId === 'builtin:basic' &&
          content.body.children.length === 1
            ? { ...structuredClone(content.body.children[0]), name: content.name }
            : undefined
        return { functionId, name: content.name, ...(component ? { component } : {}) }
      })
  }
}

function summarizeLocalLibrary(library: LocalFunctionLibraryDocument): FunctionLibrarySummary {
  return {
    source: 'local',
    libraryId: library.libraryId,
    name: library.content.name,
    functions: library.content.functions
      .filter((entry) => entry.exposed !== false)
      .map(({ functionId, content }) => ({
        functionId,
        name: content.name
      }))
  }
}

function projectFunctionDocument(
  library: LocalFunctionLibraryDocument,
  functionId: string
): FunctionDocument | null {
  const entry = library.content.functions.find((item) => item.functionId === functionId)
  if (!entry) return null
  return {
    functionId,
    content: structuredClone(entry.content),
    editorState: structuredClone(library.editorState.functions[functionId] ?? {})
  }
}

function functionNotFound(functionId: string): TemplateApplicationError {
  return new TemplateApplicationError('FUNCTION_NOT_FOUND', `Function not found: ${functionId}`, {
    functionId
  })
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

function collectFunctionEntryClosure(
  entries: readonly FunctionLibraryEntry[],
  rootFunctionId: string
): FunctionLibraryEntry[] {
  const byId = new Map(entries.map((entry) => [entry.functionId, entry]))
  const result: FunctionLibraryEntry[] = []
  const visited = new Set<string>()
  const active = new Set<string>()

  const visit = (functionId: string): void => {
    if (visited.has(functionId)) return
    if (active.has(functionId)) {
      throw new TemplateApplicationError(
        'RECURSIVE_FUNCTION_DEPENDENCY',
        `Recursive function dependency: ${[...active, functionId].join(' -> ')}`,
        { functionId }
      )
    }
    const entry = byId.get(functionId)
    if (!entry) throw functionNotFound(functionId)
    active.add(functionId)
    collectFrameFunctionRefs(entry.content.body).forEach(visit)
    active.delete(functionId)
    visited.add(functionId)
    result.push(entry)
  }

  visit(rootFunctionId)
  return result
}

function collectFrameFunctionRefs(frame: FrameNode): string[] {
  const refs: string[] = []
  const scan = (node: TemplateNode): void => {
    if (node.type === 'frame') node.children.forEach(scan)
    else if (node.type === 'function') refs.push(node.functionRef)
  }
  scan(frame)
  return refs
}

function rewriteCopiedFunctionRefs(
  frame: FrameNode,
  idMap: ReadonlyMap<string, string>
): FrameNode {
  return {
    ...structuredClone(frame),
    children: frame.children.map((node): TemplateNode => {
      if (node.type === 'frame') return rewriteCopiedFunctionRefs(node, idMap)
      if (node.type !== 'function') return structuredClone(node)
      return {
        ...structuredClone(node),
        functionRef: requireMappedFunctionId(idMap, node.functionRef)
      }
    })
  }
}

function requireMappedFunctionId(idMap: ReadonlyMap<string, string>, sourceId: string): string {
  const mapped = idMap.get(sourceId)
  if (!mapped) throw functionNotFound(sourceId)
  return mapped
}

function pruneInternalFunctionEntries(
  entries: readonly FunctionLibraryEntry[]
): FunctionLibraryEntry[] {
  const byId = new Map(entries.map((entry) => [entry.functionId, entry]))
  const reachable = new Set<string>()
  const visit = (functionId: string): void => {
    if (reachable.has(functionId)) return
    const entry = byId.get(functionId)
    if (!entry) return
    reachable.add(functionId)
    collectFrameFunctionRefs(entry.content.body).forEach(visit)
  }
  entries.filter((entry) => entry.exposed !== false).forEach((entry) => visit(entry.functionId))
  return entries.filter((entry) => entry.exposed !== false || reachable.has(entry.functionId))
}

function retainFunctionEditorStates(
  states: LocalFunctionLibraryDocument['editorState']['functions'],
  entries: readonly FunctionLibraryEntry[]
): LocalFunctionLibraryDocument['editorState']['functions'] {
  const retainedIds = new Set(entries.map((entry) => entry.functionId))
  return Object.fromEntries(
    Object.entries(states).filter(([functionId]) => retainedIds.has(functionId))
  )
}
