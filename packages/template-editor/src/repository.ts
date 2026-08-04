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
  listScopes(): Promise<string[]>
  clear(): Promise<void>
}

export interface TemplateRepository {
  listTemplateIds(): Promise<string[]>
  getTemplate(templateId: string): Promise<TemplateDocument | null>
  saveTemplate(document: TemplateDocument): Promise<void>
  deleteTemplate(templateId: string): Promise<void>

  listFunctionIds(): Promise<string[]>
  getFunction(functionId: string): Promise<FunctionDocument | null>
  saveFunction(document: FunctionDocument): Promise<void>
  deleteFunction(functionId: string): Promise<void>
}

export class TemplateRepositoryError extends Error {
  constructor(
    public readonly code: 'INVALID_ID' | 'INVALID_DATA',
    message: string
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
    const value = await this.templates.scope(templateId).readText<unknown>(TEMPLATE_FILE)
    if (value === null) return null
    if (!isTemplateDocument(value) || value.templateId !== templateId) {
      throw invalidData(`Template ${templateId} is invalid`)
    }
    await assertFunctionResources(value.resources.functions)
    return value
  }

  async saveTemplate(document: TemplateDocument): Promise<void> {
    if (!isTemplateDocument(document)) throw invalidData('Template is invalid')
    assertUuid(document.templateId, 'templateId')
    await assertFunctionResources(document.resources.functions)
    await this.templates.scope(document.templateId).writeText(TEMPLATE_FILE, document)
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
    const value = await this.functions.scope(functionId).readText<unknown>(FUNCTION_FILE)
    if (value === null) return null
    if (!isFunctionDocument(value) || value.functionId !== functionId) {
      throw invalidData(`Function ${functionId} is invalid`)
    }
    return value
  }

  async saveFunction(document: FunctionDocument): Promise<void> {
    if (!isFunctionDocument(document)) throw invalidData('Function is invalid')
    assertUuid(document.functionId, 'functionId')
    await this.functions.scope(document.functionId).writeText(FUNCTION_FILE, document)
  }

  async deleteFunction(functionId: string): Promise<void> {
    assertUuid(functionId, 'functionId')
    await this.functions.scope(functionId).clear()
  }
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

function isTemplateDocument(value: unknown): value is TemplateDocument {
  if (!isRecord(value) || typeof value.templateId !== 'string') return false
  if (!isRecord(value.content) || !isRecord(value.resources) || !isRecord(value.editorState)) {
    return false
  }
  const content = value.content
  return (
    typeof content.name === 'string' &&
    typeof content.description === 'string' &&
    Array.isArray(content.interfaces) &&
    isRecord(content.root) &&
    Array.isArray(content.schemaUses) &&
    Array.isArray(value.resources.functions) &&
    value.resources.functions.every(isFunctionDef) &&
    isJsonObject(value.editorState)
  )
}

function isFunctionDocument(value: unknown): value is FunctionDocument {
  return (
    isRecord(value) &&
    typeof value.functionId === 'string' &&
    isFunctionContent(value.content) &&
    isRecord(value.editorState) &&
    isJsonObject(value.editorState)
  )
}

function isFunctionDef(value: unknown): value is FunctionDef {
  return isRecord(value) && typeof value.id === 'string' && isFunctionContent(value)
}

function isFunctionContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.inputs) &&
    isRecord(value.body) &&
    Array.isArray(value.outputs) &&
    Array.isArray(value.schemaUses)
  )
}

function isJsonObject(value: Record<string, unknown>): boolean {
  return Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertUuid(value: string, label: string): void {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new TemplateRepositoryError('INVALID_ID', `Invalid ${label}: ${value}`)
  }
}

function invalidData(message: string): TemplateRepositoryError {
  return new TemplateRepositoryError('INVALID_DATA', message)
}
