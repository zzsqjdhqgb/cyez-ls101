import { BUILTIN_FILE_STORE_CHANNELS } from '../shared/constants'
import { builtinAssetLocationToUrl, createBuiltinAssetKey } from '../shared/assetKey'
import { validateFilename, validateScopeSegment } from '../shared/pathUtils'
import type { AssetKey, FileLocation, ReadonlyScopedStore, ScopePath } from '../shared/types'
import { getBuiltinFileStoreBridge } from './builtinBridge'

export class BuiltinScopedStoreImpl implements ReadonlyScopedStore {
  constructor(private readonly scopePath: ScopePath) {}

  scope(name: string): ReadonlyScopedStore {
    validateScopeSegment(name)
    return new BuiltinScopedStoreImpl([...this.scopePath, name])
  }

  async readText<T>(filename: string): Promise<T | null> {
    const value = await this.invoke(BUILTIN_FILE_STORE_CHANNELS.readText, this.location(filename))
    return value === null ? null : (JSON.parse(value as string) as T)
  }

  async hasText(filename: string): Promise<boolean> {
    return (await this.invoke(
      BUILTIN_FILE_STORE_CHANNELS.hasText,
      this.location(filename)
    )) as boolean
  }

  async listText(): Promise<string[]> {
    return (await this.invoke(BUILTIN_FILE_STORE_CHANNELS.listText, this.scopePath)) as string[]
  }

  async readAsset(filename: string): Promise<Uint8Array | null> {
    const value = await this.invoke(BUILTIN_FILE_STORE_CHANNELS.readAsset, this.location(filename))
    return value === null ? null : new Uint8Array(value as ArrayLike<number>)
  }

  async hasAsset(filename: string): Promise<boolean> {
    return (await this.invoke(
      BUILTIN_FILE_STORE_CHANNELS.hasAsset,
      this.location(filename)
    )) as boolean
  }

  async listAssets(): Promise<string[]> {
    return (await this.invoke(BUILTIN_FILE_STORE_CHANNELS.listAssets, this.scopePath)) as string[]
  }

  getAssetKey(filename: string): AssetKey {
    return createBuiltinAssetKey(this.location(filename))
  }

  getAssetUrl(filename: string): string {
    return builtinAssetLocationToUrl(this.location(filename))
  }

  async listScopes(): Promise<string[]> {
    return (await this.invoke(BUILTIN_FILE_STORE_CHANNELS.listScopes, this.scopePath)) as string[]
  }

  private location(filename: string): FileLocation {
    validateFilename(filename)
    return { scope: this.scopePath, filename }
  }

  private invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return getBuiltinFileStoreBridge().invoke(channel, ...args)
  }
}
