export type SecretScope = readonly string[]

export interface SecretStorage {
  scope(name: string): ScopedSecretStorage
}

export interface ScopedSecretStorage {
  scope(name: string): ScopedSecretStorage
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
