export type ScopePath = readonly string[]

export interface FileLocation {
  scope: ScopePath
  filename: string
}

export interface FileStore {
  scope(name: string): ScopedStore
}

export interface ScopedStore {
  scope(name: string): ScopedStore

  readText<T>(filename: string): Promise<T | null>
  writeText<T>(filename: string, data: T): Promise<void>
  deleteText(filename: string): Promise<void>
  hasText(filename: string): Promise<boolean>
  listText(): Promise<string[]>

  readAsset(filename: string): Promise<Uint8Array | null>
  writeAsset(filename: string, data: Uint8Array): Promise<void>
  deleteAsset(filename: string): Promise<void>
  hasAsset(filename: string): Promise<boolean>
  listAssets(): Promise<string[]>
  getAssetUrl(filename: string): string

  listScopes(): Promise<string[]>
  clear(): Promise<void>
}

export interface FileStoreBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}
