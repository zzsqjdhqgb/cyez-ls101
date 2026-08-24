export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type ConfigScope = readonly string[]

export interface ConfigLocation {
  scope: ConfigScope
  key: string
}

export interface ConfigStore {
  scope(name: string): ScopedConfigStore
}

export interface ScopedConfigStore {
  scope(name: string): ScopedConfigStore
  read<T extends JsonValue>(key: string): Promise<T | null>
  write<T extends JsonValue>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

export interface ConfigStoreBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}
