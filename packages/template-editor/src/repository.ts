import { parseFunctionDocument, parseTemplateDocument } from './document-parser'
import { verifyFunctionResourceId } from './id'
import type { FunctionDef, FunctionDocument, TemplateDocument } from './types'

const TEMPLATE_FILE = 'template.json'
const FUNCTION_FILE = 'function.json'
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  saveTemplate(document: TemplateDocument): Promise<TemplateDocument>
  deleteTemplate(templateId: string): Promise<void>

  listFunctionIds(): Promise<string[]>
  getFunction(functionId: string): Promise<FunctionDocument | null>
  saveFunction(document: FunctionDocument): Promise<FunctionDocument>
  deleteFunction(functionId: string): Promise<void>
}

export class TemplateRepositoryError extends Error {
  constructor(
    public readonly code: 'INVALID_ID' | 'INVALID_DATA' | 'REVISION_CONFLICT',
    message: string,
    public readonly params: Readonly<Record<string, string | number>> = {}
  ) {
    super(message)
    this.name = 'TemplateRepositoryError'
  }
}

export class FileTemplateRepository implements TemplateRepository {
  private readonly templates: TemplateStore
  private readonly functions: TemplateStore

  constructor(root: TemplateStore) {
    this.templates = root.scope('templates')
    this.functions = root.scope('functions')
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

  async listFunctionIds(): Promise<string[]> {
    return listUuidScopes(this.functions)
  }

  async getFunction(functionId: string): Promise<FunctionDocument | null> {
    assertUuid(functionId, 'functionId')
    const value = await readStoredValue(
      this.functions.scope(functionId),
      FUNCTION_FILE,
      `Function ${functionId}`
    )
    if (value === null) return null
    const document = parseFunctionDocument(value)
    if (!document || document.functionId !== functionId) {
      throw invalidData(`Function ${functionId} is invalid`)
    }
    return document
  }

  async saveFunction(document: FunctionDocument): Promise<FunctionDocument> {
    if (!parseFunctionDocument(document)) throw invalidData('Function is invalid')
    assertUuid(document.functionId, 'functionId')
    const scope = this.functions.scope(document.functionId)
    const stored = await readStoredValue(scope, FUNCTION_FILE, `Function ${document.functionId}`)
    if (stored === null) {
      if (document.revision !== 0) {
        throw revisionConflict('Function', document.functionId, 0, document.revision)
      }
      if (!(await scope.compareAndSwapText(FUNCTION_FILE, null, document))) {
        throw await latestRevisionConflict(
          'Function',
          document.functionId,
          document.revision,
          scope,
          FUNCTION_FILE,
          parseFunctionDocument
        )
      }
      return document
    }
    const current = parseFunctionDocument(stored)
    if (!current || current.functionId !== document.functionId) {
      throw invalidData(`Function ${document.functionId} is invalid`)
    }
    if (current.revision !== document.revision) {
      throw revisionConflict('Function', document.functionId, current.revision, document.revision)
    }
    const updated = { ...document, revision: document.revision + 1 }
    if (!(await scope.compareAndSwapText(FUNCTION_FILE, stored, updated))) {
      throw await latestRevisionConflict(
        'Function',
        document.functionId,
        document.revision,
        scope,
        FUNCTION_FILE,
        parseFunctionDocument
      )
    }
    return updated
  }

  async deleteFunction(functionId: string): Promise<void> {
    assertUuid(functionId, 'functionId')
    await this.functions.scope(functionId).clear()
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
  kind: 'Template' | 'Function',
  id: string,
  providedRevision: number,
  store: TemplateStore,
  filename: string,
  parse: (value: unknown) => T | null
): Promise<TemplateRepositoryError> {
  const stored = await readStoredValue(store, filename, `${kind} ${id}`)
  if (stored === null) return revisionConflict(kind, id, 0, providedRevision)
  const current = parse(stored)
  if (!current) throw invalidData(`${kind} ${id} is invalid`)
  return revisionConflict(kind, id, current.revision, providedRevision)
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

function invalidData(message: string): TemplateRepositoryError {
  return new TemplateRepositoryError('INVALID_DATA', message)
}

function revisionConflict(
  kind: 'Template' | 'Function',
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
