import { FILE_STORE_CHANNELS } from '../shared/constants'
import { assetLocationToUrl, createAssetKey } from '../shared/assetKey'
import { validateFilename, validateScopeSegment } from '../shared/pathUtils'
import type { AssetKey, FileLocation, ScopedStore, ScopePath } from '../shared/types'
import { getFileStoreBridge } from './bridge'

export class ScopedStoreImpl implements ScopedStore {
  constructor(private readonly scopePath: ScopePath) {}

  scope(name: string): ScopedStore {
    validateScopeSegment(name)
    return new ScopedStoreImpl([...this.scopePath, name])
  }

  async readText<T>(filename: string): Promise<T | null> {
    const value = await this.invoke(FILE_STORE_CHANNELS.readText, this.location(filename))
    return value === null ? null : (JSON.parse(value as string) as T)
  }

  async writeText<T>(filename: string, data: T): Promise<void> {
    const value = serializeJson(data)
    await this.invoke(FILE_STORE_CHANNELS.writeText, this.location(filename), value)
  }

  async compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean> {
    const expectedValue = expected === null ? null : serializeJson(expected)
    const value = serializeJson(data)
    return (await this.invoke(
      FILE_STORE_CHANNELS.compareAndSwapText,
      this.location(filename),
      expectedValue,
      value
    )) as boolean
  }

  async deleteText(filename: string): Promise<void> {
    await this.invoke(FILE_STORE_CHANNELS.deleteText, this.location(filename))
  }

  async hasText(filename: string): Promise<boolean> {
    return (await this.invoke(FILE_STORE_CHANNELS.hasText, this.location(filename))) as boolean
  }

  async listText(): Promise<string[]> {
    return (await this.invoke(FILE_STORE_CHANNELS.listText, this.scopePath)) as string[]
  }

  async readAsset(filename: string): Promise<Uint8Array | null> {
    const value = await this.invoke(FILE_STORE_CHANNELS.readAsset, this.location(filename))
    return value === null ? null : new Uint8Array(value as ArrayLike<number>)
  }

  async writeAsset(filename: string, data: Uint8Array): Promise<void> {
    if (!(data instanceof Uint8Array)) throw new TypeError('Asset data must be a Uint8Array')
    await this.invoke(FILE_STORE_CHANNELS.writeAsset, this.location(filename), data)
  }

  async deleteAsset(filename: string): Promise<void> {
    await this.invoke(FILE_STORE_CHANNELS.deleteAsset, this.location(filename))
  }

  async hasAsset(filename: string): Promise<boolean> {
    return (await this.invoke(FILE_STORE_CHANNELS.hasAsset, this.location(filename))) as boolean
  }

  async listAssets(): Promise<string[]> {
    return (await this.invoke(FILE_STORE_CHANNELS.listAssets, this.scopePath)) as string[]
  }

  getAssetKey(filename: string): AssetKey {
    return createAssetKey(this.location(filename))
  }

  getAssetUrl(filename: string): string {
    return assetLocationToUrl(this.location(filename))
  }

  async listScopes(): Promise<string[]> {
    return (await this.invoke(FILE_STORE_CHANNELS.listScopes, this.scopePath)) as string[]
  }

  async clear(): Promise<void> {
    await this.invoke(FILE_STORE_CHANNELS.clearScope, this.scopePath)
  }

  private location(filename: string): FileLocation {
    validateFilename(filename)
    return { scope: this.scopePath, filename }
  }

  private invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return getFileStoreBridge().invoke(channel, ...args)
  }
}

function serializeJson<T>(data: T): string {
  const value = JSON.stringify(data)
  if (value === undefined) throw new TypeError('Data is not JSON serializable')
  return value
}
