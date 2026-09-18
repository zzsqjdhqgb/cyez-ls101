import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWriteFile, JsonConfigStorage, resolveConfigPath } from '../main/storage'

describe('JsonConfigStorage', () => {
  let baseDir: string
  let storage: JsonConfigStorage

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'config-store-'))
    storage = new JsonConfigStorage(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('stores scoped JSON documents below the config directory', async () => {
    const location = { scope: ['appearance'], key: 'settings' }
    expect(resolveConfigPath(baseDir, location)).toBe(
      path.join(baseDir, 'config', 'appearance', 'settings.json')
    )

    await storage.write(location, { theme: 'dark', reduceMotion: true })
    expect(await storage.read(location)).toEqual({ theme: 'dark', reduceMotion: true })
    expect(await readFile(resolveConfigPath(baseDir, location), 'utf8')).toBe(
      '{"theme":"dark","reduceMotion":true}'
    )
  })

  it('replaces an existing document after a Windows destination conflict', async () => {
    const location = { scope: ['appearance'], key: 'settings' }
    const filePath = resolveConfigPath(baseDir, location)
    await storage.write(location, { theme: 'light' })
    let renameAttempts = 0

    await atomicWriteFile(filePath, '{"theme":"dark"}', {
      platform: 'win32',
      async rename(source, destination) {
        renameAttempts += 1
        if (renameAttempts === 1) {
          const error = new Error('simulated Windows destination conflict') as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        await rename(source, destination)
      }
    })

    expect(renameAttempts).toBe(2)
    expect(await readFile(filePath, 'utf8')).toBe('{"theme":"dark"}')
    expect(await readdir(path.dirname(filePath))).toEqual(['settings.json'])
  })

  it('uses null for missing documents and removes a scope recursively', async () => {
    const location = { scope: ['appearance'], key: 'settings' }
    expect(await storage.read(location)).toBeNull()

    await storage.write(location, { theme: 'light' })
    await storage.clear(['appearance'])
    expect(await storage.read(location)).toBeNull()
    expect(await readdir(path.join(baseDir, 'config')).catch(() => [])).toEqual([])
  })

  it('rejects traversal before touching disk', async () => {
    await expect(
      storage.write({ scope: ['appearance', '..'], key: 'settings' }, {})
    ).rejects.toThrow('Invalid config-store scope segment')
    await expect(storage.read({ scope: ['appearance'], key: '../settings' })).rejects.toThrow(
      'Invalid config-store key'
    )
  })

  it('rejects runtime values that JSON would silently alter', async () => {
    const location = { scope: ['appearance'], key: 'settings' }
    await expect(storage.write(location, { value: undefined } as never)).rejects.toThrow(
      'Config data is not a JSON value'
    )
    await expect(storage.write(location, { value: Number.NaN })).rejects.toThrow(
      'Config data is not a JSON value'
    )
  })
})
