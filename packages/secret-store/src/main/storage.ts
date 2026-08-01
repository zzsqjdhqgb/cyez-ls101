import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { SecretScope, ScopedSecretStorage } from '../shared/types'

export interface SecretCodec {
  encrypt(value: string): Uint8Array
  decrypt(value: Uint8Array): string
}

const validSegment = /^[a-zA-Z0-9_-]+$/

function validateSegment(value: string, label: string): void {
  if (!validSegment.test(value) || value === '.' || value === '..') {
    throw new Error(`Invalid secret ${label}`)
  }
}

function validateScope(scope: SecretScope): void {
  scope.forEach((segment) => validateSegment(segment, 'scope'))
}

function validateKey(key: string): void {
  validateSegment(key, 'key')
}

async function writeAtomically(filePath: string, data: Uint8Array): Promise<void> {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.secret-store-${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  let renamed = false

  await mkdir(directory, { recursive: true })
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporaryPath, filePath)
    renamed = true
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    if (!renamed) await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export class EncryptedSecretStorage {
  constructor(
    private readonly baseDir: string,
    private readonly codec: SecretCodec
  ) {}

  scope(name: string): ScopedSecretStorage {
    validateSegment(name, 'scope')
    return new ScopedSecretStorageImpl(this, [name])
  }

  async read(scope: SecretScope, key: string): Promise<string | null> {
    const filePath = this.resolve(scope, key)
    try {
      return this.codec.decrypt(await readFile(filePath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async write(scope: SecretScope, key: string, value: string): Promise<void> {
    if (typeof value !== 'string') throw new TypeError('Secret value must be a string')
    await writeAtomically(this.resolve(scope, key), this.codec.encrypt(value))
  }

  async delete(scope: SecretScope, key: string): Promise<void> {
    await rm(this.resolve(scope, key), { force: true })
  }

  async clear(scope: SecretScope): Promise<void> {
    validateScope(scope)
    await rm(path.join(this.baseDir, 'secrets', ...scope), {
      recursive: true,
      force: true
    })
  }

  private resolve(scope: SecretScope, key: string): string {
    validateScope(scope)
    validateKey(key)
    return path.join(this.baseDir, 'secrets', ...scope, `${key}.bin`)
  }
}

class ScopedSecretStorageImpl implements ScopedSecretStorage {
  constructor(
    private readonly storage: EncryptedSecretStorage,
    private readonly scopePath: SecretScope
  ) {}

  scope(name: string): ScopedSecretStorage {
    validateSegment(name, 'scope')
    return new ScopedSecretStorageImpl(this.storage, [...this.scopePath, name])
  }

  read(key: string): Promise<string | null> {
    return this.storage.read(this.scopePath, key)
  }

  write(key: string, value: string): Promise<void> {
    return this.storage.write(this.scopePath, key, value)
  }

  delete(key: string): Promise<void> {
    return this.storage.delete(this.scopePath, key)
  }

  clear(): Promise<void> {
    return this.storage.clear(this.scopePath)
  }
}
