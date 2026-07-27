import {
  ASSET_PROTOCOL_HOST,
  ASSET_PROTOCOL_SCHEME,
  FILE_STORE_CHANNELS
} from '../shared/constants'
import { validateFilename, validateScopeSegment } from '../shared/pathUtils'
import type { FileLocation, ScopedStore, ScopePath } from '../shared/types'
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
    const value = JSON.stringify(data)
    if (value === undefined) throw new TypeError('Data is not JSON serializable')
    await this.invoke(FILE_STORE_CHANNELS.writeText, this.location(filename), value)
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

  getAssetUrl(filename: string): string {
    validateFilename(filename)
    const pathname = [...this.scopePath, filename].map(encodeURIComponent).join('/')
    return `${ASSET_PROTOCOL_SCHEME}://${ASSET_PROTOCOL_HOST}/${pathname}`
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
