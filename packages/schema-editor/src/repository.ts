import type { SchemaData, SchemaDefinition, SchemaDraftLibraryDocument } from '@ls101/core-types'
import {
  createSchemaDefinition,
  isSchemaDraftId,
  isSchemaId,
  isSchemaLibraryId,
  updateSchemaDefinition,
  verifySchemaDefinition
} from './identity'
import { parseSchemaDefinition, parseSchemaDraftLibrary } from './parser'
import {
  validateSchemaData,
  validateSchemaDefinition,
  validateSchemaDraft,
  type SchemaValidationError
} from './validation'

const LIBRARY_FILE = 'library.json'
const SCHEMA_FILE = 'schema.json'

/** @ls101/file-store 的 ScopedStore 满足此结构，测试可使用内存实现。 */
export interface SchemaStore {
  scope(name: string): SchemaStore
  readText<T>(filename: string): Promise<T | null>
  writeText<T>(filename: string, data: T): Promise<void>
  compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean>
  listScopes(): Promise<string[]>
  clear(): Promise<void>
}

export interface SchemaRepository {
  listDraftLibraryIds(): Promise<string[]>
  getDraftLibrary(libraryId: string): Promise<SchemaDraftLibraryDocument | null>
  saveDraftLibrary(library: SchemaDraftLibraryDocument): Promise<SchemaDraftLibraryDocument>
  deleteDraftLibrary(libraryId: string): Promise<void>

  listSchemaIds(): Promise<string[]>
  listBuiltinSchemaIds(): Promise<string[]>
  getSchema(schemaId: string): Promise<SchemaDefinition | null>
  registerBuiltinSchema(definition: SchemaDefinition): Promise<SchemaDefinition>
  publishDraft(libraryId: string, draftId: string, data: SchemaData): Promise<SchemaDefinition>
  updateSchemaData(
    schemaId: string,
    expectedRevision: number,
    data: SchemaData
  ): Promise<SchemaDefinition>
  deleteSchema(schemaId: string): Promise<void>
}

export class SchemaRepositoryError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_DATA'
      | 'INVALID_ID'
      | 'NOT_FOUND'
      | 'REVISION_CONFLICT'
      | 'IDENTITY_CONFLICT'
      | 'BUILTIN_SCHEMA',
    message: string,
    public readonly details: Readonly<Record<string, string | number>> = {}
  ) {
    super(message)
    this.name = 'SchemaRepositoryError'
  }
}

export class FileSchemaRepository implements SchemaRepository {
  private readonly draftLibraries: SchemaStore
  private readonly published: SchemaStore
  private readonly builtinSchemaIds = new Set<string>()

  constructor(root: SchemaStore) {
    this.draftLibraries = root.scope('draft-libraries')
    this.published = root.scope('published')
  }

  async listDraftLibraryIds(): Promise<string[]> {
    const ids = await this.draftLibraries.listScopes()
    if (ids.some((id) => !isSchemaLibraryId(id))) {
      throw invalidData('Schema draft library storage contains an invalid ID')
    }
    return ids.sort()
  }

  async getDraftLibrary(libraryId: string): Promise<SchemaDraftLibraryDocument | null> {
    assertId(isSchemaLibraryId(libraryId), 'libraryId', libraryId)
    const value = await this.draftLibraries.scope(libraryId).readText<unknown>(LIBRARY_FILE)
    if (value === null) return null
    const library = parseSchemaDraftLibrary(value)
    if (!library || library.libraryId !== libraryId) {
      throw invalidData(`Invalid Schema draft library: ${libraryId}`)
    }
    return library
  }

  async saveDraftLibrary(library: SchemaDraftLibraryDocument): Promise<SchemaDraftLibraryDocument> {
    if (!parseSchemaDraftLibrary(library)) throw invalidData('Invalid Schema draft library')
    assertId(isSchemaLibraryId(library.libraryId), 'libraryId', library.libraryId)
    const scope = this.draftLibraries.scope(library.libraryId)
    const storedValue = await scope.readText<unknown>(LIBRARY_FILE)
    if (storedValue === null) {
      if (library.revision !== 0) {
        throw revisionConflict('SchemaDraftLibrary', library.libraryId, 0, library.revision)
      }
      const created = structuredClone(library)
      if (!(await scope.compareAndSwapText(LIBRARY_FILE, null, created))) {
        throw await this.latestLibraryConflict(library.libraryId, library.revision)
      }
      return created
    }

    const current = parseSchemaDraftLibrary(storedValue)
    if (!current || current.libraryId !== library.libraryId) {
      throw invalidData(`Invalid stored Schema draft library: ${library.libraryId}`)
    }
    if (current.revision !== library.revision) {
      throw revisionConflict(
        'SchemaDraftLibrary',
        library.libraryId,
        current.revision,
        library.revision
      )
    }
    const updated = structuredClone({ ...library, revision: library.revision + 1 })
    if (!(await scope.compareAndSwapText(LIBRARY_FILE, current, updated))) {
      throw await this.latestLibraryConflict(library.libraryId, library.revision)
    }
    return updated
  }

  async deleteDraftLibrary(libraryId: string): Promise<void> {
    assertId(isSchemaLibraryId(libraryId), 'libraryId', libraryId)
    await this.draftLibraries.scope(libraryId).clear()
  }

  async listSchemaIds(): Promise<string[]> {
    const ids = await this.published.listScopes()
    if (ids.some((id) => !isSchemaId(id))) {
      throw invalidData('Published Schema storage contains an invalid ID')
    }
    return ids.sort()
  }

  async listBuiltinSchemaIds(): Promise<string[]> {
    return [...this.builtinSchemaIds].sort()
  }

  async getSchema(schemaId: string): Promise<SchemaDefinition | null> {
    assertId(isSchemaId(schemaId), 'schemaId', schemaId)
    const value = await this.published.scope(schemaId).readText<unknown>(SCHEMA_FILE)
    if (value === null) return null
    const definition = parseSchemaDefinition(value)
    if (
      !definition ||
      definition.schemaId !== schemaId ||
      !validateSchemaDefinition(definition).valid ||
      !(await verifySchemaDefinition(definition))
    ) {
      throw invalidData(`Invalid published Schema: ${schemaId}`)
    }
    return definition
  }

  async registerBuiltinSchema(definition: SchemaDefinition): Promise<SchemaDefinition> {
    if (
      !parseSchemaDefinition(definition) ||
      !validateSchemaDefinition(definition).valid ||
      !(await verifySchemaDefinition(definition))
    ) {
      throw invalidData('Schema definition is invalid')
    }
    const scope = this.published.scope(definition.schemaId)
    const storedValue = await scope.readText<unknown>(SCHEMA_FILE)
    if (storedValue === null) {
      const created = structuredClone(definition)
      if (await scope.compareAndSwapText(SCHEMA_FILE, null, created)) {
        this.builtinSchemaIds.add(definition.schemaId)
        return created
      }
      return this.registerBuiltinSchema(definition)
    }

    const current = parseSchemaDefinition(storedValue)
    if (
      !current ||
      current.schemaId !== definition.schemaId ||
      !validateSchemaDefinition(current).valid ||
      !(await verifySchemaDefinition(current))
    ) {
      throw invalidData(`Invalid published Schema: ${definition.schemaId}`)
    }
    if (current.structureHash !== definition.structureHash) {
      throw new SchemaRepositoryError(
        'IDENTITY_CONFLICT',
        `Schema structure conflicts with registered definition: ${definition.schemaId}`,
        { schemaId: definition.schemaId }
      )
    }
    this.builtinSchemaIds.add(definition.schemaId)
    return current
  }

  async publishDraft(
    libraryId: string,
    draftId: string,
    data: SchemaData
  ): Promise<SchemaDefinition> {
    assertId(isSchemaLibraryId(libraryId), 'libraryId', libraryId)
    assertId(isSchemaDraftId(draftId), 'draftId', draftId)
    const library = await this.getDraftLibrary(libraryId)
    if (!library) throw notFound(`Schema draft library not found: ${libraryId}`)
    const draft = library.drafts.find((item) => item.draftId === draftId)
    if (!draft) throw notFound(`Schema draft not found: ${draftId}`)

    assertValid(validateSchemaDraft(draft).errors)
    assertValid(validateSchemaData(data, draft.structure).errors)
    const definition = await createSchemaDefinition(draft, data)
    assertValid(validateSchemaDefinition(definition).errors)

    const scope = this.published.scope(definition.schemaId)
    if (!(await scope.compareAndSwapText(SCHEMA_FILE, null, definition))) {
      throw new SchemaRepositoryError(
        'IDENTITY_CONFLICT',
        `Published Schema ID already exists: ${definition.schemaId}`,
        { schemaId: definition.schemaId }
      )
    }
    return definition
  }

  async updateSchemaData(
    schemaId: string,
    expectedRevision: number,
    data: SchemaData
  ): Promise<SchemaDefinition> {
    assertId(isSchemaId(schemaId), 'schemaId', schemaId)
    const current = await this.getSchema(schemaId)
    if (!current) throw notFound(`Published Schema not found: ${schemaId}`)
    if (current.revision !== expectedRevision) {
      throw revisionConflict('Schema', schemaId, current.revision, expectedRevision)
    }
    assertValid(validateSchemaData(data, current.structure).errors)

    const updated = updateSchemaDefinition(current, data)
    const scope = this.published.scope(schemaId)
    if (!(await scope.compareAndSwapText(SCHEMA_FILE, current, updated))) {
      const latest = await this.getSchema(schemaId)
      throw revisionConflict('Schema', schemaId, latest?.revision ?? 0, expectedRevision)
    }
    return updated
  }

  async deleteSchema(schemaId: string): Promise<void> {
    assertId(isSchemaId(schemaId), 'schemaId', schemaId)
    if (this.builtinSchemaIds.has(schemaId)) {
      throw new SchemaRepositoryError(
        'BUILTIN_SCHEMA',
        `Builtin Schema cannot be deleted: ${schemaId}`,
        { schemaId }
      )
    }
    await this.published.scope(schemaId).clear()
  }

  private async latestLibraryConflict(
    libraryId: string,
    providedRevision: number
  ): Promise<SchemaRepositoryError> {
    const latest = await this.getDraftLibrary(libraryId)
    return revisionConflict(
      'SchemaDraftLibrary',
      libraryId,
      latest?.revision ?? 0,
      providedRevision
    )
  }
}

function assertValid(errors: readonly SchemaValidationError[]): void {
  if (errors.length === 0) return
  throw new SchemaRepositoryError('INVALID_DATA', 'Schema validation failed', {
    errorCount: errors.length
  })
}

function invalidData(message: string): SchemaRepositoryError {
  return new SchemaRepositoryError('INVALID_DATA', message)
}

function assertId(valid: boolean, field: string, value: string): void {
  if (valid) return
  throw new SchemaRepositoryError('INVALID_ID', `Invalid ${field}: ${value}`, { [field]: value })
}

function notFound(message: string): SchemaRepositoryError {
  return new SchemaRepositoryError('NOT_FOUND', message)
}

function revisionConflict(
  kind: string,
  id: string,
  currentRevision: number,
  providedRevision: number
): SchemaRepositoryError {
  return new SchemaRepositoryError('REVISION_CONFLICT', `${kind} revision conflict: ${id}`, {
    currentRevision,
    providedRevision
  })
}
