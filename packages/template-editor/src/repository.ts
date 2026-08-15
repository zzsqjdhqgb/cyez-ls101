import {
  parseFunctionLibraryRelease,
  parseLegacyLocalFunctionLibraryDocument,
  parseLocalFunctionLibraryDocument,
  parseTemplateDocument
} from './document-parser'
import {
  canonicalizeFunctionLibraryContent,
  verifyFunctionLibraryRelease,
  verifyFunctionResourceId
} from './id'
import type {
  FunctionDef,
  FunctionLibraryContent,
  FunctionLibraryRelease,
  LocalFunctionLibraryDocument,
  TemplateDocument
} from './types'

const TEMPLATE_FILE = 'template.json'
const LIBRARY_FILE = 'library.json'
const ACTIVE_FILE = 'active.json'
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BUILTIN_LIBRARY_ID_PATTERN = /^builtin:([a-z0-9][a-z0-9_-]*)$/
const BUILTIN_FUNCTION_ID_PATTERN = /^builtin:[a-z0-9][a-z0-9_-]*$/
const VERSION_SCOPE_PATTERN = /^v([1-9][0-9]*)$/

/** @ls101/file-store 的 ScopedStore 满足此结构，也可由测试内存实现替代。 */
export interface TemplateStore {
  scope(name: string): TemplateStore
  readText<T>(filename: string): Promise<T | null>
  writeText<T>(filename: string, data: T): Promise<void>
  compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean>
  listScopes(): Promise<string[]>
  clear(): Promise<void>
}

export interface TemplateRepository {
  listTemplateIds(): Promise<string[]>
  getTemplate(templateId: string): Promise<TemplateDocument | null>
  createTemplate(document: TemplateDocument): Promise<TemplateDocument>
  saveTemplate(document: TemplateDocument): Promise<TemplateDocument>
  deleteTemplate(templateId: string): Promise<void>

  listLocalFunctionLibraryIds(): Promise<string[]>
  getLocalFunctionLibrary(libraryId: string): Promise<LocalFunctionLibraryDocument | null>
  saveLocalFunctionLibrary(
    document: LocalFunctionLibraryDocument
  ): Promise<LocalFunctionLibraryDocument>
  deleteLocalFunctionLibrary(libraryId: string): Promise<void>

  listImportedFunctionLibraryIds(): Promise<string[]>
  listImportedFunctionLibraryVersions(libraryId: string): Promise<number[]>
  getImportedFunctionLibrary(
    libraryId: string,
    version: number
  ): Promise<FunctionLibraryRelease | null>
  registerImportedFunctionLibrary(release: FunctionLibraryRelease): Promise<FunctionLibraryRelease>
  deleteImportedFunctionLibrary(libraryId: string, version: number): Promise<void>

  listBuiltinFunctionLibraryIds(): Promise<string[]>
  getActiveBuiltinFunctionLibrary(libraryId: string): Promise<FunctionLibraryRelease | null>
  getBuiltinFunctionLibrary(
    libraryId: string,
    version: number
  ): Promise<FunctionLibraryRelease | null>
  registerBuiltinFunctionLibrary(release: FunctionLibraryRelease): Promise<FunctionLibraryRelease>
  setActiveBuiltinFunctionLibraryVersion(libraryId: string, version: number): Promise<void>
  setActiveBuiltinFunctionLibraries(
    libraries: readonly { libraryId: string; version: number }[]
  ): Promise<void>
}

export class TemplateRepositoryError extends Error {
  constructor(
    public readonly code: 'INVALID_ID' | 'INVALID_DATA' | 'REVISION_CONFLICT' | 'RELEASE_CONFLICT',
    message: string,
    public readonly params: Readonly<Record<string, string | number>> = {}
  ) {
    super(message)
    this.name = 'TemplateRepositoryError'
  }
}

export class FileTemplateRepository implements TemplateRepository {
  private readonly templates: TemplateStore
  private readonly localLibraries: TemplateStore
  private readonly importedLibraries: TemplateStore
  private readonly builtinLibraries: TemplateStore

  constructor(root: TemplateStore) {
    this.templates = root.scope('templates')
    const libraries = root.scope('function-libraries')
    this.localLibraries = libraries.scope('local')
    this.importedLibraries = libraries.scope('imported')
    this.builtinLibraries = libraries.scope('builtin')
  }

  async listTemplateIds(): Promise<string[]> {
    return listUuidScopes(this.templates)
  }

  async getTemplate(templateId: string): Promise<TemplateDocument | null> {
    assertUuid(templateId, 'templateId')
    const value = await readStoredValue(
      this.templates.scope(templateId),
      TEMPLATE_FILE,
      `Template ${templateId}`
    )
    if (value === null) return null
    const document = parseTemplateDocument(value)
    if (!document || document.templateId !== templateId) {
      throw invalidData(`Template ${templateId} is invalid`)
    }
    await assertFunctionResources(document.resources.functions)
    return document
  }

  async createTemplate(document: TemplateDocument): Promise<TemplateDocument> {
    if (!parseTemplateDocument(document)) throw invalidData('Template is invalid')
    assertUuid(document.templateId, 'templateId')
    if (document.revision !== 0) {
      throw revisionConflict('Template', document.templateId, 0, document.revision)
    }
    await assertFunctionResources(document.resources.functions)
    const scope = this.templates.scope(document.templateId)
    if (!(await scope.compareAndSwapText(TEMPLATE_FILE, null, document))) {
      throw await latestRevisionConflict(
        'Template',
        document.templateId,
        document.revision,
        scope,
        TEMPLATE_FILE,
        parseTemplateDocument
      )
    }
    return document
  }

  async saveTemplate(document: TemplateDocument): Promise<TemplateDocument> {
    if (!parseTemplateDocument(document)) throw invalidData('Template is invalid')
    assertUuid(document.templateId, 'templateId')
    await assertFunctionResources(document.resources.functions)
    const scope = this.templates.scope(document.templateId)
    const stored = await readStoredValue(scope, TEMPLATE_FILE, `Template ${document.templateId}`)
    if (stored === null) {
      if (document.revision !== 0) {
        throw revisionConflict('Template', document.templateId, 0, document.revision)
      }
      if (!(await scope.compareAndSwapText(TEMPLATE_FILE, null, document))) {
        throw await latestRevisionConflict(
          'Template',
          document.templateId,
          document.revision,
          scope,
          TEMPLATE_FILE,
          parseTemplateDocument
        )
      }
      return document
    }
    const current = parseTemplateDocument(stored)
    if (!current || current.templateId !== document.templateId) {
      throw invalidData(`Template ${document.templateId} is invalid`)
    }
    await assertFunctionResources(current.resources.functions)
    if (current.revision !== document.revision) {
      throw revisionConflict('Template', document.templateId, current.revision, document.revision)
    }
    const updated = { ...document, revision: document.revision + 1 }
    if (!(await scope.compareAndSwapText(TEMPLATE_FILE, stored, updated))) {
      throw await latestRevisionConflict(
        'Template',
        document.templateId,
        document.revision,
        scope,
        TEMPLATE_FILE,
        parseTemplateDocument
      )
    }
    return updated
  }

  async deleteTemplate(templateId: string): Promise<void> {
    assertUuid(templateId, 'templateId')
    await this.templates.scope(templateId).clear()
  }

  async listLocalFunctionLibraryIds(): Promise<string[]> {
    return listUuidScopes(this.localLibraries)
  }

  async getLocalFunctionLibrary(libraryId: string): Promise<LocalFunctionLibraryDocument | null> {
    assertUuid(libraryId, 'libraryId')
    const scope = this.localLibraries.scope(libraryId)
    let value: unknown | null
    try {
      value = await readStoredValue(scope, LIBRARY_FILE, `Local function library ${libraryId}`)
    } catch (error) {
      if (error instanceof TemplateRepositoryError && error.code === 'INVALID_DATA') {
        throw invalidLocalLibrary(libraryId, error.message)
      }
      throw error
    }
    if (value === null) return null
    const document = parseLocalFunctionLibraryDocument(value)
    if (document?.libraryId === libraryId) {
      assertReadableLocalLibrary(document)
      return document
    }

    const migrated = parseLegacyLocalFunctionLibraryDocument(value)
    if (!migrated || migrated.libraryId !== libraryId) {
      throw invalidLocalLibrary(libraryId)
    }
    assertReadableLocalLibrary(migrated)
    if (await scope.compareAndSwapText(LIBRARY_FILE, value, migrated)) return migrated
    return this.getLocalFunctionLibrary(libraryId)
  }

  async saveLocalFunctionLibrary(
    document: LocalFunctionLibraryDocument
  ): Promise<LocalFunctionLibraryDocument> {
    if (!parseLocalFunctionLibraryDocument(document)) {
      throw invalidData('Local function library is invalid')
    }
    assertUuid(document.libraryId, 'libraryId')
    assertLocalLibrary(document)
    const scope = this.localLibraries.scope(document.libraryId)
    const stored = await readStoredValue(
      scope,
      LIBRARY_FILE,
      `Local function library ${document.libraryId}`
    )
    if (stored === null) {
      if (document.storageRevision !== 0) {
        throw revisionConflict('FunctionLibrary', document.libraryId, 0, document.storageRevision)
      }
      if (!(await scope.compareAndSwapText(LIBRARY_FILE, null, document))) {
        throw await latestRevisionConflict(
          'FunctionLibrary',
          document.libraryId,
          document.storageRevision,
          scope,
          LIBRARY_FILE,
          parseLocalFunctionLibraryDocument,
          (library) => library.storageRevision
        )
      }
      return document
    }
    const current = parseLocalFunctionLibraryDocument(stored)
    if (!current || current.libraryId !== document.libraryId) {
      throw invalidData(`Local function library ${document.libraryId} is invalid`)
    }
    assertLocalLibrary(current)
    if (current.storageRevision !== document.storageRevision) {
      throw revisionConflict(
        'FunctionLibrary',
        document.libraryId,
        current.storageRevision,
        document.storageRevision
      )
    }
    const updated = { ...document, storageRevision: document.storageRevision + 1 }
    if (!(await scope.compareAndSwapText(LIBRARY_FILE, stored, updated))) {
      throw await latestRevisionConflict(
        'FunctionLibrary',
        document.libraryId,
        document.storageRevision,
        scope,
        LIBRARY_FILE,
        parseLocalFunctionLibraryDocument,
        (library) => library.storageRevision
      )
    }
    return updated
  }

  async deleteLocalFunctionLibrary(libraryId: string): Promise<void> {
    assertUuid(libraryId, 'libraryId')
    await this.localLibraries.scope(libraryId).clear()
  }

  async listImportedFunctionLibraryIds(): Promise<string[]> {
    const ids = await listUuidScopes(this.importedLibraries)
    const populated = await Promise.all(
      ids.map(async (libraryId) => ({
        libraryId,
        versions: await this.listImportedFunctionLibraryVersions(libraryId)
      }))
    )
    return populated.filter(({ versions }) => versions.length > 0).map(({ libraryId }) => libraryId)
  }

  async listImportedFunctionLibraryVersions(libraryId: string): Promise<number[]> {
    assertUuid(libraryId, 'libraryId')
    return listVersionScopes(this.importedLibraries.scope(libraryId).scope('releases'))
  }

  async getImportedFunctionLibrary(
    libraryId: string,
    version: number
  ): Promise<FunctionLibraryRelease | null> {
    assertUuid(libraryId, 'libraryId')
    return this.getRelease(this.importedLibraries, libraryId, version, 'Imported')
  }

  async registerImportedFunctionLibrary(
    release: FunctionLibraryRelease
  ): Promise<FunctionLibraryRelease> {
    assertUuid(release.libraryId, 'libraryId')
    await validateFunctionLibraryRelease(release, 'imported')
    return this.registerRelease(this.importedLibraries, release, 'Imported')
  }

  async deleteImportedFunctionLibrary(libraryId: string, version: number): Promise<void> {
    assertUuid(libraryId, 'libraryId')
    assertVersion(version)
    await releaseScope(this.importedLibraries, libraryId, version).clear()
  }

  async listBuiltinFunctionLibraryIds(): Promise<string[]> {
    const active = await this.readActiveBuiltinFunctionLibraries()
    return active.libraries.map(({ libraryId }) => libraryId)
  }

  async getActiveBuiltinFunctionLibrary(libraryId: string): Promise<FunctionLibraryRelease | null> {
    assertBuiltinLibraryId(libraryId)
    const active = await this.readActiveBuiltinFunctionLibraries()
    const entry = active.libraries.find((item) => item.libraryId === libraryId)
    if (!entry) return null
    const release = await this.getBuiltinFunctionLibrary(libraryId, entry.version)
    if (!release) {
      throw invalidData(
        `Builtin function library ${libraryId} active release v${entry.version} is missing`
      )
    }
    return release
  }

  async getBuiltinFunctionLibrary(
    libraryId: string,
    version: number
  ): Promise<FunctionLibraryRelease | null> {
    const key = assertBuiltinLibraryId(libraryId)
    return this.getRelease(this.builtinLibraries, key, version, 'Builtin', libraryId)
  }

  async registerBuiltinFunctionLibrary(
    release: FunctionLibraryRelease
  ): Promise<FunctionLibraryRelease> {
    const key = assertBuiltinLibraryId(release.libraryId)
    await validateFunctionLibraryRelease(release, 'builtin')
    return this.registerRelease(this.builtinLibraries, release, 'Builtin', key)
  }

  async setActiveBuiltinFunctionLibraryVersion(libraryId: string, version: number): Promise<void> {
    const active = await this.readActiveBuiltinFunctionLibraries()
    const libraries = active.libraries.filter((item) => item.libraryId !== libraryId)
    libraries.push({ libraryId, version })
    await this.setActiveBuiltinFunctionLibraries(libraries)
  }

  async setActiveBuiltinFunctionLibraries(
    libraries: readonly { libraryId: string; version: number }[]
  ): Promise<void> {
    const normalized = [...libraries].sort((left, right) =>
      left.libraryId.localeCompare(right.libraryId)
    )
    const ids = new Set<string>()
    for (const { libraryId, version } of normalized) {
      assertBuiltinLibraryId(libraryId)
      assertVersion(version)
      if (ids.has(libraryId)) {
        throw invalidData(`Duplicate active builtin function library: ${libraryId}`)
      }
      ids.add(libraryId)
      if (!(await this.getBuiltinFunctionLibrary(libraryId, version))) {
        throw invalidData(`Builtin function library ${libraryId} release v${version} is missing`)
      }
    }
    await this.builtinLibraries.writeText(ACTIVE_FILE, { libraries: normalized })
  }

  private async readActiveBuiltinFunctionLibraries(): Promise<ActiveBuiltinFunctionLibraries> {
    const value = await readStoredValue(
      this.builtinLibraries,
      ACTIVE_FILE,
      'Active builtin function libraries'
    )
    if (value === null) return { libraries: [] }
    if (!isActiveBuiltinFunctionLibraries(value)) {
      throw invalidData('Active builtin function libraries are invalid')
    }
    return value
  }

  private async getRelease(
    root: TemplateStore,
    physicalLibraryId: string,
    version: number,
    label: 'Imported' | 'Builtin',
    logicalLibraryId = physicalLibraryId
  ): Promise<FunctionLibraryRelease | null> {
    assertVersion(version)
    const value = await readStoredValue(
      releaseScope(root, physicalLibraryId, version),
      LIBRARY_FILE,
      `${label} function library ${logicalLibraryId} v${version}`
    )
    if (value === null) return null
    const release = parseFunctionLibraryRelease(value)
    if (
      !release ||
      release.libraryId !== logicalLibraryId ||
      release.version !== version ||
      !(await verifyFunctionLibraryRelease(release))
    ) {
      throw invalidData(`${label} function library ${logicalLibraryId} v${version} is invalid`)
    }
    await validateFunctionLibraryRelease(release, label === 'Builtin' ? 'builtin' : 'imported')
    return release
  }

  private async registerRelease(
    root: TemplateStore,
    release: FunctionLibraryRelease,
    label: 'Imported' | 'Builtin',
    physicalLibraryId = release.libraryId
  ): Promise<FunctionLibraryRelease> {
    const scope = releaseScope(root, physicalLibraryId, release.version)
    const stored = await readStoredValue(
      scope,
      LIBRARY_FILE,
      `${label} function library ${release.libraryId} v${release.version}`
    )
    if (stored !== null) {
      const current = parseFunctionLibraryRelease(stored)
      if (!current || !(await verifyFunctionLibraryRelease(current))) {
        throw invalidData(
          `${label} function library ${release.libraryId} v${release.version} is invalid`
        )
      }
      if (
        current.libraryId === release.libraryId &&
        current.version === release.version &&
        current.contentHash === release.contentHash &&
        canonicalizeFunctionLibraryContent(current.content) ===
          canonicalizeFunctionLibraryContent(release.content)
      ) {
        return current
      }
      throw releaseConflict(release.libraryId, release.version)
    }
    if (!(await scope.compareAndSwapText(LIBRARY_FILE, null, release))) {
      const current = await this.getRelease(
        root,
        physicalLibraryId,
        release.version,
        label,
        release.libraryId
      )
      if (
        current &&
        current.contentHash === release.contentHash &&
        canonicalizeFunctionLibraryContent(current.content) ===
          canonicalizeFunctionLibraryContent(release.content)
      ) {
        return current
      }
      throw releaseConflict(release.libraryId, release.version)
    }
    return release
  }
}

async function readStoredValue(
  store: TemplateStore,
  filename: string,
  label: string
): Promise<unknown | null> {
  try {
    return await store.readText<unknown>(filename)
  } catch (error) {
    if (isSyntaxError(error)) throw invalidData(`${label} contains invalid JSON`)
    throw error
  }
}

async function latestRevisionConflict<T extends { revision: number }>(
  kind: 'Template' | 'FunctionLibrary',
  id: string,
  providedRevision: number,
  store: TemplateStore,
  filename: string,
  parse: (value: unknown) => T | null,
  selectRevision: (value: T) => number = (value) => value.revision
): Promise<TemplateRepositoryError> {
  const stored = await readStoredValue(store, filename, `${kind} ${id}`)
  if (stored === null) return revisionConflict(kind, id, 0, providedRevision)
  const current = parse(stored)
  if (!current) throw invalidData(`${kind} ${id} is invalid`)
  return revisionConflict(kind, id, selectRevision(current), providedRevision)
}

function isSyntaxError(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (typeof error === 'object' && error !== null && Reflect.get(error, 'name') === 'SyntaxError')
  )
}

async function listUuidScopes(store: TemplateStore): Promise<string[]> {
  const ids = await store.listScopes()
  ids.forEach((id) => assertUuid(id, 'stored ID'))
  return ids.sort()
}

async function listVersionScopes(store: TemplateStore): Promise<number[]> {
  const scopes = await store.listScopes()
  return scopes
    .map((scope) => {
      const match = VERSION_SCOPE_PATTERN.exec(scope)
      if (!match) throw invalidData(`Invalid stored function library version: ${scope}`)
      const version = Number(match[1])
      assertVersion(version)
      return version
    })
    .sort((left, right) => left - right)
}

function releaseScope(root: TemplateStore, libraryId: string, version: number): TemplateStore {
  assertVersion(version)
  return root.scope(libraryId).scope('releases').scope(`v${version}`)
}

function assertLocalLibrary(document: LocalFunctionLibraryDocument): void {
  assertFunctionLibraryContent(document.content, 'local')
  assertFunctionLibraryDependencyGraph(document.content, 'local')
  const ids = new Set(document.content.functions.map((entry) => entry.functionId))
  for (const functionId of Object.keys(document.editorState.functions)) {
    if (!ids.has(functionId)) {
      throw invalidData(`Editor state references unknown function: ${functionId}`)
    }
  }
}

export async function validateFunctionLibraryRelease(
  release: FunctionLibraryRelease,
  source: 'builtin' | 'imported'
): Promise<void> {
  if (!parseFunctionLibraryRelease(release) || !(await verifyFunctionLibraryRelease(release))) {
    throw invalidData('Function library release is invalid')
  }
  assertVersion(release.version)
  if (source === 'builtin') assertBuiltinLibraryId(release.libraryId)
  else assertUuid(release.libraryId, 'libraryId')
  assertFunctionLibraryContent(release.content, source)
  assertFunctionLibraryDependencyGraph(release.content, source)
}

function assertFunctionLibraryContent(
  content: FunctionLibraryContent,
  source: 'builtin' | 'imported' | 'local'
): void {
  const ids = new Set<string>()
  for (const entry of content.functions) {
    if (source === 'builtin') {
      if (!BUILTIN_FUNCTION_ID_PATTERN.test(entry.functionId)) {
        throw new TemplateRepositoryError(
          'INVALID_ID',
          `Invalid builtin functionId: ${entry.functionId}`
        )
      }
    } else {
      assertUuid(entry.functionId, 'functionId')
    }
    if (ids.has(entry.functionId)) {
      throw invalidData(`Duplicate function in library: ${entry.functionId}`)
    }
    ids.add(entry.functionId)
  }
}

function assertFunctionLibraryDependencyGraph(
  content: FunctionLibraryContent,
  source: 'builtin' | 'imported' | 'local'
): void {
  const functions = new Map(content.functions.map((entry) => [entry.functionId, entry]))
  const dependencies = new Map<string, string[]>()

  for (const entry of content.functions) {
    const refs: string[] = []
    visitFunctionRefs(entry.content.body, (functionRef) => {
      if (source === 'builtin') {
        if (!BUILTIN_FUNCTION_ID_PATTERN.test(functionRef)) {
          throw new TemplateRepositoryError(
            'INVALID_ID',
            `Invalid builtin functionRef: ${functionRef}`
          )
        }
      } else {
        assertUuid(functionRef, 'functionRef')
      }
      if (!functions.has(functionRef)) {
        throw invalidData(`Unknown function dependency in ${entry.functionId}: ${functionRef}`)
      }
      refs.push(functionRef)
    })
    dependencies.set(entry.functionId, refs)
  }

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const stack: string[] = []
  const visit = (functionId: string): void => {
    if (visited.has(functionId)) return
    if (visiting.has(functionId)) {
      const start = stack.indexOf(functionId)
      const chain = [...stack.slice(start), functionId]
      throw invalidData(`Recursive function dependency: ${chain.join(' -> ')}`)
    }
    visiting.add(functionId)
    stack.push(functionId)
    for (const dependency of dependencies.get(functionId) ?? []) visit(dependency)
    stack.pop()
    visiting.delete(functionId)
    visited.add(functionId)
  }
  for (const functionId of functions.keys()) visit(functionId)
}

function visitFunctionRefs(
  frame: FunctionContent['body'],
  visit: (functionRef: string) => void
): void {
  for (const node of frame.children) {
    if (node.type === 'frame') visitFunctionRefs(node, visit)
    else if (node.type === 'function') visit(node.functionRef)
  }
}

async function assertFunctionResources(resources: readonly FunctionDef[]): Promise<void> {
  const ids = new Set<string>()
  for (const resource of resources) {
    if (ids.has(resource.id)) throw invalidData(`Duplicate function resource: ${resource.id}`)
    ids.add(resource.id)
    if (!(await verifyFunctionResourceId(resource))) {
      throw invalidData(`Function resource integrity check failed: ${resource.id}`)
    }
  }
}

function assertUuid(value: string, label: string): void {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new TemplateRepositoryError('INVALID_ID', `Invalid ${label}: ${value}`)
  }
}

function assertBuiltinLibraryId(libraryId: string): string {
  const match = BUILTIN_LIBRARY_ID_PATTERN.exec(libraryId)
  if (!match) {
    throw new TemplateRepositoryError('INVALID_ID', `Invalid builtin libraryId: ${libraryId}`)
  }
  return match[1]
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TemplateRepositoryError('INVALID_ID', `Invalid function library version: ${version}`)
  }
}

interface ActiveBuiltinFunctionLibraries {
  libraries: { libraryId: string; version: number }[]
}

function isActiveBuiltinFunctionLibraries(value: unknown): value is ActiveBuiltinFunctionLibraries {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.ownKeys(value).length === 1 &&
    Array.isArray(Reflect.get(value, 'libraries')) &&
    (Reflect.get(value, 'libraries') as unknown[]).every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        Reflect.ownKeys(item).length === 2 &&
        typeof Reflect.get(item, 'libraryId') === 'string' &&
        BUILTIN_LIBRARY_ID_PATTERN.test(Reflect.get(item, 'libraryId') as string) &&
        Number.isSafeInteger(Reflect.get(item, 'version')) &&
        (Reflect.get(item, 'version') as number) >= 1
    ) &&
    new Set(
      (Reflect.get(value, 'libraries') as { libraryId: string }[]).map(({ libraryId }) => libraryId)
    ).size === (Reflect.get(value, 'libraries') as unknown[]).length
  )
}

function invalidData(message: string): TemplateRepositoryError {
  return new TemplateRepositoryError('INVALID_DATA', message)
}

function invalidLocalLibrary(libraryId: string, message?: string): TemplateRepositoryError {
  return new TemplateRepositoryError(
    'INVALID_DATA',
    message ?? `Local function library ${libraryId} is invalid`,
    { libraryId }
  )
}

function assertReadableLocalLibrary(document: LocalFunctionLibraryDocument): void {
  try {
    assertLocalLibrary(document)
  } catch (error) {
    if (error instanceof TemplateRepositoryError && error.code === 'INVALID_DATA') {
      throw invalidLocalLibrary(document.libraryId, error.message)
    }
    throw error
  }
}

function revisionConflict(
  kind: 'Template' | 'FunctionLibrary',
  id: string,
  currentRevision: number,
  providedRevision: number
): TemplateRepositoryError {
  return new TemplateRepositoryError('REVISION_CONFLICT', `${kind} revision conflict: ${id}`, {
    id,
    currentRevision,
    providedRevision
  })
}

function releaseConflict(libraryId: string, version: number): TemplateRepositoryError {
  return new TemplateRepositoryError(
    'RELEASE_CONFLICT',
    `Function library release conflict: ${libraryId} v${version}`,
    { libraryId, version }
  )
}
