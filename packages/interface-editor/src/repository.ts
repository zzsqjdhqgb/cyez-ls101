import type { InterfaceInstance } from '@ls101/core-types'
import { compareInterfaceIdentity, isInterfaceId, publishInterface, verifyInterfaceId } from './id'
import { flattenFields } from './queries'
import type { InterfaceDef, InterfaceDraft } from './types'
import { validateInterfaceDef } from './validation'

const DRAFT_FILE = 'draft.json'
const INTERFACE_FILE = 'interface.json'
const INSTANCE_FILE = 'instance.json'
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ASSET_FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

export type SaveEntityResult = 'created' | 'existing'

/** @ls101/file-store 的 ScopedStore 满足此结构，也可由测试内存实现替代。 */
export interface InterfaceStore {
  scope(name: string): InterfaceStore
  readText<T>(filename: string): Promise<T | null>
  writeText<T>(filename: string, data: T): Promise<void>
  readAsset(filename: string): Promise<Uint8Array | null>
  writeAsset(filename: string, data: Uint8Array): Promise<void>
  listAssets(): Promise<string[]>
  getAssetUrl(filename: string): string
  listScopes(): Promise<string[]>
  clear(): Promise<void>
}

export interface StoredInterfaceInstance {
  instance: InterfaceInstance
  assetFilenames: string[]
}

interface StoredInstanceFile {
  instance: InterfaceInstance
  assets: string[]
}

export interface InterfaceRepository {
  listDraftIds(): Promise<string[]>
  getDraft(draftId: string): Promise<InterfaceDraft | null>
  saveDraft(draft: InterfaceDraft): Promise<void>
  deleteDraft(draftId: string): Promise<void>

  listInterfaceIds(): Promise<string[]>
  getInterface(interfaceId: string): Promise<InterfaceDef | null>
  saveInterface(def: InterfaceDef): Promise<SaveEntityResult>
  publishDraft(draftId: string): Promise<InterfaceDef>
  deleteInterface(interfaceId: string): Promise<void>

  listInstanceIds(interfaceId: string): Promise<string[]>
  getInstance(interfaceId: string, instanceId: string): Promise<StoredInterfaceInstance | null>
  saveInstance(
    instance: InterfaceInstance,
    assets?: Readonly<Record<string, Uint8Array>>
  ): Promise<SaveEntityResult>
  readInstanceAsset(
    interfaceId: string,
    instanceId: string,
    filename: string
  ): Promise<Uint8Array | null>
  getInstanceAssetUrl(interfaceId: string, instanceId: string, filename: string): string
  deleteInstance(interfaceId: string, instanceId: string): Promise<void>
}

export class InterfaceRepositoryError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_ID'
      | 'INVALID_DATA'
      | 'NOT_FOUND'
      | 'IDENTITY_CONFLICT'
      | 'MISSING_ASSET',
    message: string
  ) {
    super(message)
    this.name = 'InterfaceRepositoryError'
  }
}

export class FileInterfaceRepository implements InterfaceRepository {
  private readonly drafts: InterfaceStore
  private readonly published: InterfaceStore

  constructor(root: InterfaceStore) {
    this.drafts = root.scope('drafts')
    this.published = root.scope('published')
  }

  listDraftIds(): Promise<string[]> {
    return this.drafts.listScopes()
  }

  async getDraft(draftId: string): Promise<InterfaceDraft | null> {
    assertUuid(draftId, 'draftId')
    const value = await this.drafts.scope(draftId).readText<unknown>(DRAFT_FILE)
    if (value === null) return null
    if (!isInterfaceDraft(value) || value.draftId !== draftId) {
      throw invalidData(`Draft ${draftId} is invalid`)
    }
    return value
  }

  async saveDraft(draft: InterfaceDraft): Promise<void> {
    if (!isInterfaceDraft(draft)) throw invalidData('Draft is invalid')
    await this.drafts.scope(draft.draftId).writeText(DRAFT_FILE, draft)
  }

  async deleteDraft(draftId: string): Promise<void> {
    assertUuid(draftId, 'draftId')
    await this.drafts.scope(draftId).clear()
  }

  async listInterfaceIds(): Promise<string[]> {
    return (await this.published.listScopes())
      .filter((digest) => /^[0-9a-f]{64}$/.test(digest))
      .map((digest) => `sha256:${digest}`)
  }

  async getInterface(interfaceId: string): Promise<InterfaceDef | null> {
    const scope = this.published.scope(interfaceDigest(interfaceId))
    const value = await scope.readText<unknown>(INTERFACE_FILE)
    if (value === null) return null
    if (!isInterfaceDef(value) || value.id !== interfaceId || !(await verifyInterfaceId(value))) {
      throw invalidData(`Interface ${interfaceId} is invalid`)
    }
    return value
  }

  async saveInterface(def: InterfaceDef): Promise<SaveEntityResult> {
    if (
      !isInterfaceDef(def) ||
      !validateInterfaceDef(def).valid ||
      !(await verifyInterfaceId(def))
    ) {
      throw invalidData('Interface content ID does not match its content')
    }

    const existing = await this.getInterface(def.id)
    if (existing) {
      if (compareInterfaceIdentity(existing, def) === 'same') return 'existing'
      throw identityConflict(`Interface ID collision: ${def.id}`)
    }

    await this.published.scope(interfaceDigest(def.id)).writeText(INTERFACE_FILE, def)
    return 'created'
  }

  async publishDraft(draftId: string): Promise<InterfaceDef> {
    const draft = await this.getDraft(draftId)
    if (!draft) throw new InterfaceRepositoryError('NOT_FOUND', `Draft not found: ${draftId}`)
    const def = await publishInterface(draft)
    await this.saveInterface(def)
    return def
  }

  async deleteInterface(interfaceId: string): Promise<void> {
    await this.interfaceScope(interfaceId).clear()
  }

  async listInstanceIds(interfaceId: string): Promise<string[]> {
    return (await this.instancesScope(interfaceId).listScopes()).filter((id) =>
      UUID_V4_PATTERN.test(id)
    )
  }

  async getInstance(
    interfaceId: string,
    instanceId: string
  ): Promise<StoredInterfaceInstance | null> {
    const scope = this.instanceScope(interfaceId, instanceId)
    const value = await scope.readText<unknown>(INSTANCE_FILE)
    if (value === null) return null
    if (!isStoredInstanceFile(value)) throw invalidData(`Instance ${instanceId} is invalid`)
    if (value.instance.interfaceId !== interfaceId || value.instance.instanceId !== instanceId) {
      throw invalidData(`Instance ${instanceId} does not match its storage scope`)
    }

    const storedAssets = await scope.listAssets()
    if (!sameStrings(storedAssets, value.assets)) {
      throw invalidData(`Instance ${instanceId} asset manifest does not match stored assets`)
    }
    return { instance: value.instance, assetFilenames: value.assets }
  }

  async saveInstance(
    instance: InterfaceInstance,
    assets: Readonly<Record<string, Uint8Array>> = {}
  ): Promise<SaveEntityResult> {
    assertInstance(instance)
    const def = await this.getInterface(instance.interfaceId)
    if (!def) {
      throw new InterfaceRepositoryError(
        'NOT_FOUND',
        `Interface not found: ${instance.interfaceId}`
      )
    }
    const expectedVarNames = flattenFields(def.fields)
      .map(({ leaf }) => leaf.varName)
      .sort()
    const actualVarNames = Object.keys(instance.values).sort()
    if (!sameStrings(expectedVarNames, actualVarNames)) {
      throw invalidData('Instance values do not match the Interface variables')
    }
    assertAssets(assets)

    const existing = await this.getInstance(instance.interfaceId, instance.instanceId)
    if (existing) {
      if (await this.instanceMatches(existing, instance, assets)) return 'existing'
      throw identityConflict(`Instance ID conflict: ${instance.instanceId}`)
    }

    const scope = this.instanceScope(instance.interfaceId, instance.instanceId)
    const filenames = Object.keys(assets).sort()
    try {
      for (const filename of filenames) await scope.writeAsset(filename, assets[filename])
      await scope.writeText<StoredInstanceFile>(INSTANCE_FILE, { instance, assets: filenames })
    } catch (error) {
      await scope.clear()
      throw error
    }
    return 'created'
  }

  readInstanceAsset(
    interfaceId: string,
    instanceId: string,
    filename: string
  ): Promise<Uint8Array | null> {
    assertAssetFilename(filename)
    return this.instanceScope(interfaceId, instanceId).readAsset(filename)
  }

  getInstanceAssetUrl(interfaceId: string, instanceId: string, filename: string): string {
    assertAssetFilename(filename)
    return this.instanceScope(interfaceId, instanceId).getAssetUrl(filename)
  }

  async deleteInstance(interfaceId: string, instanceId: string): Promise<void> {
    await this.instanceScope(interfaceId, instanceId).clear()
  }

  private instanceScope(interfaceId: string, instanceId: string): InterfaceStore {
    assertUuid(instanceId, 'instanceId')
    return this.instancesScope(interfaceId).scope(instanceId)
  }

  private instancesScope(interfaceId: string): InterfaceStore {
    return this.interfaceScope(interfaceId).scope('instances')
  }

  private interfaceScope(interfaceId: string): InterfaceStore {
    return this.published.scope(interfaceDigest(interfaceId))
  }

  private async instanceMatches(
    existing: StoredInterfaceInstance,
    incoming: InterfaceInstance,
    assets: Readonly<Record<string, Uint8Array>>
  ): Promise<boolean> {
    if (canonicalInstance(existing.instance) !== canonicalInstance(incoming)) return false
    const filenames = Object.keys(assets).sort()
    if (!sameStrings(existing.assetFilenames, filenames)) return false

    for (const filename of filenames) {
      const stored = await this.readInstanceAsset(
        incoming.interfaceId,
        incoming.instanceId,
        filename
      )
      if (!stored || !sameBytes(stored, assets[filename])) return false
    }
    return true
  }
}

function interfaceDigest(interfaceId: string): string {
  if (!isInterfaceId(interfaceId)) {
    throw new InterfaceRepositoryError('INVALID_ID', `Invalid Interface ID: ${interfaceId}`)
  }
  return interfaceId.slice('sha256:'.length)
}

function assertUuid(value: string, label: string): void {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new InterfaceRepositoryError('INVALID_ID', `Invalid ${label}: ${value}`)
  }
}

function assertInstance(value: InterfaceInstance): void {
  assertUuid(value.instanceId, 'instanceId')
  interfaceDigest(value.interfaceId)
  if (Number.isNaN(Date.parse(value.generatedAt))) throw invalidData('generatedAt is invalid')
  if (!isStringRecord(value.values)) throw invalidData('Instance values must contain strings')
}

function assertAssets(assets: Readonly<Record<string, Uint8Array>>): void {
  for (const [filename, data] of Object.entries(assets)) {
    assertAssetFilename(filename)
    if (!(data instanceof Uint8Array)) throw invalidData(`Asset ${filename} is not binary data`)
  }
}

function assertAssetFilename(filename: string): void {
  if (!ASSET_FILENAME_PATTERN.test(filename)) {
    throw invalidData(`Invalid asset filename: ${filename}`)
  }
}

function isInterfaceDraft(value: unknown): value is InterfaceDraft {
  return (
    isRecord(value) &&
    typeof value.draftId === 'string' &&
    UUID_V4_PATTERN.test(value.draftId) &&
    isContent(value)
  )
}

function isInterfaceDef(value: unknown): value is InterfaceDef {
  return (
    isRecord(value) && typeof value.id === 'string' && isInterfaceId(value.id) && isContent(value)
  )
}

function isContent(value: Record<string, unknown>): boolean {
  return (
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.promptTemplate === 'string' &&
    isFieldRecord(value.fields)
  )
}

function isFieldRecord(value: unknown): boolean {
  if (!isRecord(value)) return false
  return Object.values(value).every((node) => {
    if (!isRecord(node) || typeof node.type !== 'string') return false
    if (node.type === 'group') return isFieldRecord(node.children)
    return (
      (node.type === 'text' || node.type === 'image') &&
      typeof node.varName === 'string' &&
      typeof node.description === 'string' &&
      typeof node.example === 'string'
    )
  })
}

function isStoredInstanceFile(value: unknown): value is StoredInstanceFile {
  if (!isRecord(value) || !isRecord(value.instance) || !Array.isArray(value.assets)) return false
  const instance = value.instance
  return (
    typeof instance.instanceId === 'string' &&
    UUID_V4_PATTERN.test(instance.instanceId) &&
    typeof instance.interfaceId === 'string' &&
    isInterfaceId(instance.interfaceId) &&
    typeof instance.generatedAt === 'string' &&
    !Number.isNaN(Date.parse(instance.generatedAt)) &&
    isStringRecord(instance.values) &&
    value.assets.every((item) => typeof item === 'string' && ASSET_FILENAME_PATTERN.test(item)) &&
    new Set(value.assets).size === value.assets.length
  )
}

function canonicalInstance(instance: InterfaceInstance): string {
  return JSON.stringify({
    interfaceId: instance.interfaceId,
    generatedAt: instance.generatedAt,
    values: Object.fromEntries(
      Object.entries(instance.values).sort(([a], [b]) => a.localeCompare(b))
    )
  })
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function invalidData(message: string): InterfaceRepositoryError {
  return new InterfaceRepositoryError('INVALID_DATA', message)
}

function identityConflict(message: string): InterfaceRepositoryError {
  return new InterfaceRepositoryError('IDENTITY_CONFLICT', message)
}
