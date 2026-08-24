import { safeStorage } from 'electron'
import { EncryptedSecretStorage, type SecretCodec } from './storage'

export { EncryptedSecretStorage } from './storage'
export type { SecretCodec } from './storage'
export type { SecretScope, SecretStorage, ScopedSecretStorage } from '../shared'

export function createElectronSecretStorage(baseDir: string): EncryptedSecretStorage {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is unavailable')
  }

  const codec: SecretCodec = {
    encrypt(value) {
      return safeStorage.encryptString(value)
    },
    decrypt(value) {
      return safeStorage.decryptString(Buffer.from(value))
    }
  }
  return new EncryptedSecretStorage(baseDir, codec)
}
