import { readFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EncryptedSecretStorage } from '../main/storage'

describe('EncryptedSecretStorage', () => {
  let baseDir: string
  let storage: EncryptedSecretStorage

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'secret-store-'))
    storage = new EncryptedSecretStorage(baseDir, {
      encrypt: (value) => new TextEncoder().encode(`encrypted:${value}`),
      decrypt: (value) => new TextDecoder().decode(value).replace(/^encrypted:/, '')
    })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('stores encrypted bytes and reads them through the scoped API', async () => {
    const scoped = storage.scope('airouter').scope('providers')
    await scoped.write('provider-1', 'secret-value')

    const filePath = path.join(baseDir, 'secrets', 'airouter', 'providers', 'provider-1.bin')
    expect(await readFile(filePath, 'utf8')).toBe('encrypted:secret-value')
    expect(await scoped.read('provider-1')).toBe('secret-value')
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it('clears a scope and rejects traversal', async () => {
    const scoped = storage.scope('airouter')
    await scoped.write('key', 'value')
    await scoped.clear()
    expect(await readdir(path.join(baseDir, 'secrets', 'airouter')).catch(() => [])).toEqual([])
    await expect(scoped.write('../escape', 'value')).rejects.toThrow('Invalid secret key')
  })
})
