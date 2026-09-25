import type { InterfaceInstance } from '@ls101/core-types'
import { compareInterfaceIdentity, isInterfaceId, publishInterface, verifyInterfaceId } from './id'
import { flattenFields } from './queries'
import type { InterfaceDef, InterfaceDraft } from './types'
import { validateInterfaceDef } from './validation'

const DRAFT_FILE = 'draft.json'
const INTERFACE_FILE = 'interface.json'
const INSTANCE_FILE = 'instance.json'
const CURRENT_FILE = 'current.json'
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ASSET_FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

export type SaveEntityResult = 'created' | 'existing'
export type InstallBuiltinInterfaceResult = SaveEntityResult | 'adopted'

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

export interface LocatedInterfaceInstance extends StoredInterfaceInstance {
  interfaceId: string
}

export interface BuiltinInterfaceEntry {
  builtinKey: string
  currentInterfaceId: string
}

interface StoredInstanceFile {
  instance: InterfaceInstance
  assets: string[]
}

type InterfaceLocation =
  | { kind: 'published'; scope: InterfaceStore }
  | { kind: 'builtin'; builtinKey: string; scope: InterfaceStore }

export interface InterfaceRepository {
  listDraftIds(): Promise<string[]>
  getDraft(draftId: string): Promise<InterfaceDraft | null>
  saveDraft(draft: InterfaceDraft): Promise<void>
  deleteDraft(draftId: string): Promise<void>

  listInterfaceIds(): Promise<string[]>
  listPublishedInterfaceIds(): Promise<string[]>
  listBuiltinKeys(): Promise<string[]>
  listBuiltinVersionIds(builtinKey: string): Promise<string[]>
  getInterface(interfaceId: string): Promise<InterfaceDef | null>
  saveInterface(def: InterfaceDef): Promise<SaveEntityResult>
  publishDraft(draftId: string): Promise<InterfaceDef>
  deleteInterface(interfaceId: string): Promise<void>

  getBuiltin(builtinKey: string): Promise<BuiltinInterfaceEntry | null>
  installBuiltinInterface(
    builtinKey: string,
    def: InterfaceDef
  ): Promise<InstallBuiltinInterfaceResult>
  saveBuiltinInterface(builtinKey: string, def: InterfaceDef): Promise<SaveEntityResult>
  setBuiltinCurrent(builtinKey: string, interfaceId: string): Promise<void>
  backupBuiltinInterface(builtinKey: string, interfaceId: string): Promise<void>
  removeBuiltin(builtinKey: string, expectedCurrentInterfaceId: string): Promise<void>

  listInstanceIds(interfaceId: string): Promise<string[]>
  getInstance(interfaceId: string, instanceId: string): Promise<StoredInterfaceInstance | null>
  findInstance(instanceId: string): Promise<LocatedInterfaceInstance | null>
  saveInstance(
    interfaceId: string,
    instance: InterfaceInstance,
    assets?: Readonly<Record<string, Uint8Array>>
  ): Promise<SaveEntityResult>
  updateInstance(
    interfaceId: string,
    instance: InterfaceInstance,
    assets?: Readonly<Record<string, Uint8Array>>
  ): Promise<void>
  readInstanceAsset(
    interfaceId: string,
    instanceId: string,
    filename: string
  ): Promise<Uint8Array | null>
  getInstanceAssetUrl(interfaceId: string, instanceId: string, filename: string): Promise<string>
  deleteInstance(interfaceId: string, instanceId: string): Promise<void>
  moveInstances(
    fromInterfaceId: string,
    toInterfaceId: string,
    instanceIds?: readonly string[]
  ): Promise<string[]>
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
  private readonly builtins: InterfaceStore

  constructor(root: InterfaceStore) {
    this.drafts = root.scope('drafts')
    this.published = root.scope('published')
    this.builtins = root.scope('builtin')
  }

  listDraftIds(): Promise<string[]> {
    return this.drafts.listScopes()
  }

  async getDraft(draftId: string): Promise<InterfaceDraft | null> {
    assertUuid(draftId, '草稿编号')
    const value = await this.drafts.scope(draftId).readText<unknown>(DRAFT_FILE)
    if (value === null) return null
    if (!isInterfaceDraft(value) || value.draftId !== draftId) {
      throw invalidData(`草稿「${draftId}」无效`)
    }
    return value
  }

  async saveDraft(draft: InterfaceDraft): Promise<void> {
    if (!isInterfaceDraft(draft)) throw invalidData('草稿内容无效')
    await this.drafts.scope(draft.draftId).writeText(DRAFT_FILE, draft)
  }

  async deleteDraft(draftId: string): Promise<void> {
    assertUuid(draftId, '草稿编号')
    await this.drafts.scope(draftId).clear()
  }

  async listInterfaceIds(): Promise<string[]> {
    const ids = new Set<string>()
    for (const id of await this.listPublishedInterfaceIds()) ids.add(id)
    for (const builtinKey of await this.listBuiltinKeys()) {
      for (const id of await this.listBuiltinVersionIds(builtinKey)) {
        if (ids.has(id)) throw invalidData(`题型「${id}」在多个存储位置重复出现`)
        ids.add(id)
      }
    }
    return [...ids].sort()
  }

  async listPublishedInterfaceIds(): Promise<string[]> {
    return this.listIdsIn(this.published)
  }

  listBuiltinKeys(): Promise<string[]> {
    return this.builtins.listScopes()
  }

  async listBuiltinVersionIds(builtinKey: string): Promise<string[]> {
    return this.listIdsIn(this.builtinVersions(builtinKey))
  }

  async getInterface(interfaceId: string): Promise<InterfaceDef | null> {
    const location = await this.locateInterface(interfaceId)
    if (!location) return null
    return this.readInterfaceAt(interfaceId, location.scope)
  }

  async saveInterface(def: InterfaceDef): Promise<SaveEntityResult> {
    await assertInterfaceDef(def)
    const location = await this.locateInterface(def.id)
    if (location) {
      const existing = await this.readInterfaceAt(def.id, location.scope)
      if (compareInterfaceIdentity(existing, def) !== 'same') {
        throw identityConflict(`题型编号「${def.id}」已被内容不同的题型占用`)
      }
      if (location.kind === 'published') return 'existing'
      throw identityConflict(`题型「${def.id}」已作为内置题型存在`)
    }
    await this.publishedInterfaceScope(def.id).writeText(INTERFACE_FILE, def)
    return 'created'
  }

  async publishDraft(draftId: string): Promise<InterfaceDef> {
    const draft = await this.getDraft(draftId)
    if (!draft) throw new InterfaceRepositoryError('NOT_FOUND', `未找到草稿：${draftId}`)
    const def = await publishInterface(draft)
    await this.saveInterface(def)
    return def
  }

  async deleteInterface(interfaceId: string): Promise<void> {
    const location = await this.locateInterface(interfaceId)
    if (!location) return
    if (location.kind === 'builtin') {
      const entry = await this.getBuiltin(location.builtinKey)
      if (entry?.currentInterfaceId === interfaceId) {
        throw identityConflict(`无法删除当前正在使用的内置题型：${interfaceId}`)
      }
    }
    await location.scope.clear()
  }

  async getBuiltin(builtinKey: string): Promise<BuiltinInterfaceEntry | null> {
    assertBuiltinKey(builtinKey)
    const value = await this.builtins.scope(builtinKey).readText<unknown>(CURRENT_FILE)
    if (value === null) return null
    if (
      !isRecord(value) ||
      value.builtinKey !== builtinKey ||
      typeof value.currentInterfaceId !== 'string' ||
      !isInterfaceId(value.currentInterfaceId)
    ) {
      throw invalidData(`内置题型「${builtinKey}」的记录无效`)
    }
    return value as unknown as BuiltinInterfaceEntry
  }

  async installBuiltinInterface(
    builtinKey: string,
    def: InterfaceDef
  ): Promise<InstallBuiltinInterfaceResult> {
    assertBuiltinKey(builtinKey)
    await assertInterfaceDef(def)
    const location = await this.locateInterface(def.id)
    if (location) {
      const existing = await this.readInterfaceAt(def.id, location.scope)
      if (compareInterfaceIdentity(existing, def) !== 'same') {
        throw identityConflict(`题型编号「${def.id}」已被内容不同的题型占用`)
      }
      if (location.kind === 'builtin') {
        if (location.builtinKey !== builtinKey) {
          throw identityConflict(`题型「${def.id}」属于内置题型「${location.builtinKey}」`)
        }
        await this.setBuiltinCurrent(builtinKey, def.id)
        return 'existing'
      }

      const target = this.builtinInterfaceScope(builtinKey, def.id)
      await this.moveInterfaceContent(def.id, location.scope, target)
      try {
        await this.setBuiltinCurrent(builtinKey, def.id)
      } catch (error) {
        await this.moveInterfaceContent(def.id, target, this.publishedInterfaceScope(def.id))
        await this.builtins.scope(builtinKey).clear()
        throw error
      }
      return 'adopted'
    }

    await this.builtinInterfaceScope(builtinKey, def.id).writeText(INTERFACE_FILE, def)
    try {
      await this.setBuiltinCurrent(builtinKey, def.id)
    } catch (error) {
      await this.builtins.scope(builtinKey).clear()
      throw error
    }
    return 'created'
  }

  async saveBuiltinInterface(builtinKey: string, def: InterfaceDef): Promise<SaveEntityResult> {
    assertBuiltinKey(builtinKey)
    await assertInterfaceDef(def)
    const location = await this.locateInterface(def.id)
    if (location) {
      const existing = await this.readInterfaceAt(def.id, location.scope)
      if (compareInterfaceIdentity(existing, def) !== 'same') {
        throw identityConflict(`题型编号「${def.id}」已被内容不同的题型占用`)
      }
      if (location.kind === 'builtin' && location.builtinKey === builtinKey) return 'existing'
      throw identityConflict(`题型「${def.id}」已存在于内置题型「${builtinKey}」之外`)
    }
    await this.builtinInterfaceScope(builtinKey, def.id).writeText(INTERFACE_FILE, def)
    return 'created'
  }

  async setBuiltinCurrent(builtinKey: string, interfaceId: string): Promise<void> {
    assertBuiltinKey(builtinKey)
    const location = await this.locateInterface(interfaceId)
    if (!location || location.kind !== 'builtin' || location.builtinKey !== builtinKey) {
      throw new InterfaceRepositoryError(
        'NOT_FOUND',
        `未找到内置题型：${builtinKey}/${interfaceId}`
      )
    }
    await this.builtins.scope(builtinKey).writeText(CURRENT_FILE, {
      builtinKey,
      currentInterfaceId: interfaceId
    })
  }

  async backupBuiltinInterface(builtinKey: string, interfaceId: string): Promise<void> {
    assertBuiltinKey(builtinKey)
    const location = await this.locateInterface(interfaceId)
    if (!location || location.kind !== 'builtin' || location.builtinKey !== builtinKey) {
      throw new InterfaceRepositoryError('NOT_FOUND', `未找到内置题型：${interfaceId}`)
    }
    if (await this.publishedInterfaceScope(interfaceId).readText(INTERFACE_FILE)) {
      throw identityConflict(`正式版题型「${interfaceId}」已存在`)
    }

    await this.moveInterfaceContent(
      interfaceId,
      location.scope,
      this.publishedInterfaceScope(interfaceId)
    )
  }

  async removeBuiltin(builtinKey: string, expectedCurrentInterfaceId: string): Promise<void> {
    assertBuiltinKey(builtinKey)
    const entry = await this.getBuiltin(builtinKey)
    if (!entry || entry.currentInterfaceId !== expectedCurrentInterfaceId) {
      throw new InterfaceRepositoryError(
        'IDENTITY_CONFLICT',
        `内置题型「${builtinKey}」在移除前已发生变化`
      )
    }
    await this.builtins.scope(builtinKey).clear()
  }

  async listInstanceIds(interfaceId: string): Promise<string[]> {
    const location = await this.locateInterface(interfaceId)
    if (!location) return []
    return (await location.scope.scope('instances').listScopes()).filter((id) =>
      UUID_V4_PATTERN.test(id)
    )
  }

  async getInstance(
    interfaceId: string,
    instanceId: string
  ): Promise<StoredInterfaceInstance | null> {
    const location = await this.locateInterface(interfaceId)
    if (!location) return null
    return this.readInstanceAt(location.scope, instanceId)
  }

  async findInstance(instanceId: string): Promise<LocatedInterfaceInstance | null> {
    assertUuid(instanceId, '题组编号')
    let found: LocatedInterfaceInstance | null = null
    for (const interfaceId of await this.listInterfaceIds()) {
      const stored = await this.getInstance(interfaceId, instanceId)
      if (!stored) continue
      if (found) throw invalidData(`题组「${instanceId}」同时存在于多个题型下`)
      found = { interfaceId, ...stored }
    }
    return found
  }

  async saveInstance(
    interfaceId: string,
    instance: InterfaceInstance,
    assets: Readonly<Record<string, Uint8Array>> = {}
  ): Promise<SaveEntityResult> {
    assertInstance(instance)
    await this.assertInstanceCompatible(interfaceId, instance)
    assertAssets(assets)
    const existing = await this.findInstance(instance.instanceId)
    if (existing) {
      if (
        existing.interfaceId === interfaceId &&
        (await this.instanceMatches(interfaceId, existing, instance, assets))
      ) {
        return 'existing'
      }
      throw identityConflict(`题组编号「${instance.instanceId}」已被内容不同的题组占用`)
    }
    const location = await this.requireInterfaceLocation(interfaceId)
    await this.writeInstanceAt(location.scope, instance, assets)
    return 'created'
  }

  async updateInstance(
    interfaceId: string,
    instance: InterfaceInstance,
    assets?: Readonly<Record<string, Uint8Array>>
  ): Promise<void> {
    assertInstance(instance)
    await this.assertInstanceCompatible(interfaceId, instance)
    const existing = await this.findInstance(instance.instanceId)
    if (!existing || existing.interfaceId !== interfaceId) {
      throw new InterfaceRepositoryError('NOT_FOUND', `未找到题组：${instance.instanceId}`)
    }

    const nextAssets =
      assets ?? (await this.loadAssets(interfaceId, instance.instanceId, existing.assetFilenames))
    assertAssets(nextAssets)
    const location = await this.requireInterfaceLocation(interfaceId)
    if (assets === undefined) {
      await this.instanceScope(location.scope, instance.instanceId).writeText<StoredInstanceFile>(
        INSTANCE_FILE,
        { instance, assets: existing.assetFilenames }
      )
      return
    }
    const previousAssets = await this.loadAssets(
      interfaceId,
      instance.instanceId,
      existing.assetFilenames
    )
    const scope = this.instanceScope(location.scope, instance.instanceId)
    await scope.clear()
    try {
      await this.writeInstanceAt(location.scope, instance, nextAssets)
    } catch (error) {
      await this.writeInstanceAt(location.scope, existing.instance, previousAssets)
      throw error
    }
  }

  async readInstanceAsset(
    interfaceId: string,
    instanceId: string,
    filename: string
  ): Promise<Uint8Array | null> {
    assertAssetFilename(filename)
    const location = await this.locateInterface(interfaceId)
    if (!location) return null
    return this.instanceScope(location.scope, instanceId).readAsset(filename)
  }

  async getInstanceAssetUrl(
    interfaceId: string,
    instanceId: string,
    filename: string
  ): Promise<string> {
    assertAssetFilename(filename)
    const location = await this.requireInterfaceLocation(interfaceId)
    return this.instanceScope(location.scope, instanceId).getAssetUrl(filename)
  }

  async deleteInstance(interfaceId: string, instanceId: string): Promise<void> {
    const location = await this.locateInterface(interfaceId)
    if (!location) return
    await this.instanceScope(location.scope, instanceId).clear()
  }

  async moveInstances(
    fromInterfaceId: string,
    toInterfaceId: string,
    selectedInstanceIds?: readonly string[]
  ): Promise<string[]> {
    if (fromInterfaceId === toInterfaceId) {
      return selectedInstanceIds ? [...selectedInstanceIds] : this.listInstanceIds(fromInterfaceId)
    }
    const source = await this.requireInterfaceLocation(fromInterfaceId)
    const target = await this.requireInterfaceLocation(toInterfaceId)
    const available = new Set(await this.listInstanceIds(fromInterfaceId))
    const instanceIds = selectedInstanceIds ? [...new Set(selectedInstanceIds)] : [...available]
    if (instanceIds.some((instanceId) => !available.has(instanceId))) {
      throw new InterfaceRepositoryError('NOT_FOUND', '所选迁移题组不存在')
    }

    const copied: string[] = []
    try {
      for (const instanceId of instanceIds) {
        const located = await this.findInstance(instanceId)
        if (!located || located.interfaceId !== fromInterfaceId) {
          throw identityConflict(`题组「${instanceId}」的来源题型不唯一`)
        }
        if (await this.readInstanceAt(target.scope, instanceId)) {
          throw identityConflict(`目标题型中已存在题组「${instanceId}」`)
        }
        const stored = await this.readInstanceAt(source.scope, instanceId)
        if (!stored) throw invalidData(`迁移过程中题组「${instanceId}」丢失`)
        await this.assertInstanceCompatible(toInterfaceId, stored.instance)
        const assets = await this.loadAssets(fromInterfaceId, instanceId, stored.assetFilenames)
        await this.writeInstanceAt(target.scope, stored.instance, assets)
        const written = await this.readInstanceAt(target.scope, instanceId)
        if (
          !written ||
          !(await this.instanceMatches(toInterfaceId, written, stored.instance, assets))
        ) {
          throw invalidData(`无法校验迁移后的题组：${instanceId}`)
        }
        copied.push(instanceId)
      }
    } catch (error) {
      for (const instanceId of copied) await this.instanceScope(target.scope, instanceId).clear()
      throw error
    }
    for (const instanceId of instanceIds) await this.instanceScope(source.scope, instanceId).clear()
    return instanceIds
  }

  private async locateInterface(interfaceId: string): Promise<InterfaceLocation | null> {
    const digest = interfaceDigest(interfaceId)
    const locations: InterfaceLocation[] = []
    const published = this.published.scope(digest)
    if ((await published.readText(INTERFACE_FILE)) !== null) {
      locations.push({ kind: 'published', scope: published })
    }
    for (const builtinKey of await this.builtins.listScopes()) {
      const scope = this.builtinVersions(builtinKey).scope(digest)
      if ((await scope.readText(INTERFACE_FILE)) !== null) {
        locations.push({ kind: 'builtin', builtinKey, scope })
      }
    }
    if (locations.length > 1) {
      throw invalidData(`题型「${interfaceId}」在多个存储位置重复出现`)
    }
    return locations[0] ?? null
  }

  private async listIdsIn(parent: InterfaceStore): Promise<string[]> {
    const ids: string[] = []
    for (const digest of await parent.listScopes()) {
      if (
        /^[0-9a-f]{64}$/.test(digest) &&
        (await parent.scope(digest).readText(INTERFACE_FILE)) !== null
      ) {
        ids.push(`sha256:${digest}`)
      }
    }
    return ids.sort()
  }

  private async requireInterfaceLocation(interfaceId: string): Promise<InterfaceLocation> {
    const location = await this.locateInterface(interfaceId)
    if (!location) {
      throw new InterfaceRepositoryError('NOT_FOUND', `未找到题型：${interfaceId}`)
    }
    return location
  }

  private async readInterfaceAt(interfaceId: string, scope: InterfaceStore): Promise<InterfaceDef> {
    const value = await scope.readText<unknown>(INTERFACE_FILE)
    if (!isInterfaceDef(value) || value.id !== interfaceId || !(await verifyInterfaceId(value))) {
      throw invalidData(`题型「${interfaceId}」无效`)
    }
    return value
  }

  private async assertInstanceCompatible(
    interfaceId: string,
    instance: InterfaceInstance
  ): Promise<void> {
    const def = await this.getInterface(interfaceId)
    if (!def) throw new InterfaceRepositoryError('NOT_FOUND', `未找到题型：${interfaceId}`)
    const expected = flattenFields(def.fields)
      .map(({ leaf }) => leaf.varName)
      .sort()
    const actual = Object.keys(instance.values).sort()
    if (!sameStrings(expected, actual)) {
      throw invalidData('题组的字段值与题型的变量定义不一致')
    }
    const imageVarNames = new Set(
      flattenFields(def.fields)
        .filter(({ leaf }) => leaf.type === 'image')
        .map(({ leaf }) => leaf.varName)
    )
    for (const varName of Object.keys(instance.imagePrompts ?? {})) {
      if (!imageVarNames.has(varName)) {
        throw invalidData(`图片提示词「${varName}」不对应任何图片变量`)
      }
    }
  }

  private async readInstanceAt(
    interfaceScope: InterfaceStore,
    instanceId: string
  ): Promise<StoredInterfaceInstance | null> {
    const scope = this.instanceScope(interfaceScope, instanceId)
    const value = await scope.readText<unknown>(INSTANCE_FILE)
    if (value === null) return null
    if (!isStoredInstanceFile(value) || value.instance.instanceId !== instanceId) {
      throw invalidData(`题组「${instanceId}」与其存储位置不一致`)
    }
    const storedAssets = await scope.listAssets()
    if (!sameStrings(storedAssets, value.assets)) {
      throw invalidData(`题组「${instanceId}」的资源清单与实际资源不一致`)
    }
    return { instance: value.instance, assetFilenames: value.assets }
  }

  private async writeInstanceAt(
    interfaceScope: InterfaceStore,
    instance: InterfaceInstance,
    assets: Readonly<Record<string, Uint8Array>>
  ): Promise<void> {
    const scope = this.instanceScope(interfaceScope, instance.instanceId)
    const filenames = Object.keys(assets).sort()
    try {
      for (const filename of filenames) await scope.writeAsset(filename, assets[filename])
      await scope.writeText<StoredInstanceFile>(INSTANCE_FILE, { instance, assets: filenames })
    } catch (error) {
      await scope.clear()
      throw error
    }
  }

  private async loadAssets(
    interfaceId: string,
    instanceId: string,
    filenames: readonly string[]
  ): Promise<Record<string, Uint8Array>> {
    const assets: Record<string, Uint8Array> = {}
    for (const filename of filenames) {
      const data = await this.readInstanceAsset(interfaceId, instanceId, filename)
      if (!data) throw new InterfaceRepositoryError('MISSING_ASSET', `缺少资源文件：${filename}`)
      assets[filename] = data
    }
    return assets
  }

  private async verifyInterfaceCopy(
    interfaceId: string,
    scope: InterfaceStore,
    snapshots: ReadonlyArray<{
      stored: StoredInterfaceInstance
      assets: Record<string, Uint8Array>
    }>
  ): Promise<void> {
    await this.readInterfaceAt(interfaceId, scope)
    for (const { stored, assets } of snapshots) {
      const instanceId = stored.instance.instanceId
      const copied = await this.readInstanceAt(scope, instanceId)
      if (!copied || canonicalInstance(copied.instance) !== canonicalInstance(stored.instance)) {
        throw invalidData(`无法校验复制后的题组：${instanceId}`)
      }
      for (const [filename, expected] of Object.entries(assets)) {
        const actual = await this.instanceScope(scope, instanceId).readAsset(filename)
        if (!actual || !sameBytes(actual, expected)) {
          throw invalidData(`无法校验复制后的资源文件：${instanceId}/${filename}`)
        }
      }
    }
  }

  private async moveInterfaceContent(
    interfaceId: string,
    source: InterfaceStore,
    target: InterfaceStore
  ): Promise<void> {
    const def = await this.readInterfaceAt(interfaceId, source)
    const instanceIds = (await source.scope('instances').listScopes()).filter((id) =>
      UUID_V4_PATTERN.test(id)
    )
    const snapshots: Array<{
      stored: StoredInterfaceInstance
      assets: Record<string, Uint8Array>
    }> = []
    for (const instanceId of instanceIds) {
      const stored = await this.readInstanceAt(source, instanceId)
      if (!stored) throw invalidData(`题型移动过程中题组「${instanceId}」丢失`)
      const assets: Record<string, Uint8Array> = {}
      for (const filename of stored.assetFilenames) {
        const data = await this.instanceScope(source, instanceId).readAsset(filename)
        if (!data) throw new InterfaceRepositoryError('MISSING_ASSET', `缺少资源文件：${filename}`)
        assets[filename] = data
      }
      snapshots.push({ stored, assets })
    }

    await target.writeText(INTERFACE_FILE, def)
    try {
      for (const { stored, assets } of snapshots) {
        await this.writeInstanceAt(target, stored.instance, assets)
      }
      await this.verifyInterfaceCopy(interfaceId, target, snapshots)
    } catch (error) {
      await target.clear()
      throw error
    }
    try {
      await source.clear()
    } catch (error) {
      await target.clear()
      throw error
    }
  }

  private async instanceMatches(
    interfaceId: string,
    existing: StoredInterfaceInstance,
    incoming: InterfaceInstance,
    assets: Readonly<Record<string, Uint8Array>>
  ): Promise<boolean> {
    if (canonicalInstance(existing.instance) !== canonicalInstance(incoming)) return false
    const filenames = Object.keys(assets).sort()
    if (!sameStrings(existing.assetFilenames, filenames)) return false
    for (const filename of filenames) {
      const stored = await this.readInstanceAsset(interfaceId, incoming.instanceId, filename)
      if (!stored || !sameBytes(stored, assets[filename])) return false
    }
    return true
  }

  private instanceScope(interfaceScope: InterfaceStore, instanceId: string): InterfaceStore {
    assertUuid(instanceId, '题组编号')
    return interfaceScope.scope('instances').scope(instanceId)
  }

  private publishedInterfaceScope(interfaceId: string): InterfaceStore {
    return this.published.scope(interfaceDigest(interfaceId))
  }

  private builtinInterfaceScope(builtinKey: string, interfaceId: string): InterfaceStore {
    return this.builtinVersions(builtinKey).scope(interfaceDigest(interfaceId))
  }

  private builtinVersions(builtinKey: string): InterfaceStore {
    assertBuiltinKey(builtinKey)
    return this.builtins.scope(builtinKey).scope('versions')
  }
}

async function assertInterfaceDef(def: InterfaceDef): Promise<void> {
  if (!isInterfaceDef(def) || !validateInterfaceDef(def).valid || !(await verifyInterfaceId(def))) {
    throw invalidData('题型的内容编号与内容不一致')
  }
}

function interfaceDigest(interfaceId: string): string {
  if (!isInterfaceId(interfaceId)) {
    throw new InterfaceRepositoryError('INVALID_ID', `题型编号「${interfaceId}」无效`)
  }
  return interfaceId.slice('sha256:'.length)
}

function assertUuid(value: string, label: string): void {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new InterfaceRepositoryError('INVALID_ID', `${label}无效：${value}`)
  }
}

function assertBuiltinKey(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {
    throw new InterfaceRepositoryError('INVALID_ID', `内置题型编号「${value}」无效`)
  }
}

function assertInstance(value: InterfaceInstance): void {
  assertUuid(value.instanceId, '题组编号')
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw invalidData('题组名称不能为空')
  }
  if (Number.isNaN(Date.parse(value.generatedAt))) throw invalidData('生成时间无效')
  if (!isStringRecord(value.values)) throw invalidData('题组的字段值必须是字符串')
  if (value.imagePrompts !== undefined && !isStringRecord(value.imagePrompts)) {
    throw invalidData('题组的图片提示词必须是字符串')
  }
}

function assertAssets(assets: Readonly<Record<string, Uint8Array>>): void {
  for (const [filename, data] of Object.entries(assets)) {
    assertAssetFilename(filename)
    if (!(data instanceof Uint8Array)) throw invalidData(`资源文件「${filename}」不是二进制数据`)
  }
}

function assertAssetFilename(filename: string): void {
  if (!ASSET_FILENAME_PATTERN.test(filename)) {
    throw invalidData(`资源文件名「${filename}」无效`)
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

export function isInterfaceDef(value: unknown): value is InterfaceDef {
  return (
    isRecord(value) && typeof value.id === 'string' && isInterfaceId(value.id) && isContent(value)
  )
}

function isContent(value: Record<string, unknown>): boolean {
  return (
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.promptTemplate === 'string' &&
    isFieldCollection(value.fields)
  )
}

function isFieldCollection(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.order) || !isRecord(value.nodes)) return false
  if (!value.order.every((key) => typeof key === 'string')) return false
  const order = value.order as string[]
  const nodeKeys = Object.keys(value.nodes)
  if (
    order.length !== nodeKeys.length ||
    new Set(order).size !== order.length ||
    !order.every((key) => Object.hasOwn(value.nodes as object, key))
  ) {
    return false
  }
  return Object.values(value.nodes).every((node) => {
    if (!isRecord(node) || typeof node.type !== 'string') return false
    if (node.type === 'group') return isFieldCollection(node.children)
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
    typeof instance.name === 'string' &&
    Boolean(instance.name.trim()) &&
    typeof instance.generatedAt === 'string' &&
    !Number.isNaN(Date.parse(instance.generatedAt)) &&
    isStringRecord(instance.values) &&
    (instance.imagePrompts === undefined || isStringRecord(instance.imagePrompts)) &&
    value.assets.every((item) => typeof item === 'string' && ASSET_FILENAME_PATTERN.test(item)) &&
    new Set(value.assets).size === value.assets.length
  )
}

function canonicalInstance(instance: InterfaceInstance): string {
  return JSON.stringify({
    name: instance.name,
    generatedAt: instance.generatedAt,
    values: Object.fromEntries(
      Object.entries(instance.values).sort(([a], [b]) => a.localeCompare(b))
    ),
    imagePrompts: Object.fromEntries(
      Object.entries(instance.imagePrompts ?? {}).sort(([a], [b]) => a.localeCompare(b))
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
