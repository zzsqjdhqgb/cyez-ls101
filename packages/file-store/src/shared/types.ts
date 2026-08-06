export type ScopePath = readonly string[]

/** File Store 生成的、可序列化的只读 Asset 位置键。 */
export type AssetKey = string

export interface FileLocation {
  scope: ScopePath
  filename: string
}

export interface FileStore {
  scope(name: string): ScopedStore
  readAsset(key: AssetKey): Promise<Uint8Array | null>
  getAssetUrl(key: AssetKey): string
}

export interface BuiltinFileStore {
  scope(name: string): ReadonlyScopedStore
  readAsset(key: AssetKey): Promise<Uint8Array | null>
  getAssetUrl(key: AssetKey): string
}

export interface ReadonlyScopedStore {
  scope(name: string): ReadonlyScopedStore

  readText<T>(filename: string): Promise<T | null>
  hasText(filename: string): Promise<boolean>
  listText(): Promise<string[]>

  readAsset(filename: string): Promise<Uint8Array | null>
  hasAsset(filename: string): Promise<boolean>
  listAssets(): Promise<string[]>
  getAssetKey(filename: string): AssetKey
  getAssetUrl(filename: string): string

  listScopes(): Promise<string[]>
}

export interface ScopedStore {
  scope(name: string): ScopedStore

  readText<T>(filename: string): Promise<T | null>
  writeText<T>(filename: string, data: T): Promise<void>
  compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean>
  deleteText(filename: string): Promise<void>
  hasText(filename: string): Promise<boolean>
  listText(): Promise<string[]>

  readAsset(filename: string): Promise<Uint8Array | null>
  writeAsset(filename: string, data: Uint8Array): Promise<void>
  deleteAsset(filename: string): Promise<void>
  hasAsset(filename: string): Promise<boolean>
  listAssets(): Promise<string[]>
  getAssetKey(filename: string): AssetKey
  getAssetUrl(filename: string): string

  listScopes(): Promise<string[]>
  clear(): Promise<void>
}

export interface FileStoreBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

export interface BuiltinFileStoreBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}
