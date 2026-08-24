import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  atomicWriteFile,
  FileStorage,
  resolveAssetPath,
  resolveScopePath,
  resolveTextPath
} from '../main/storage'
import type { FileLocation } from '../shared/types'

describe('FileStorage', () => {
  let baseDir: string
  let storage: FileStorage
  const draftScope = ['interfaces', 'drafts', 'draft-abc123'] as const

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'file-store-'))
    storage = new FileStorage(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('maps text and assets into reserved directories', () => {
    const location: FileLocation = { scope: draftScope, filename: 'manifest.json' }

    expect(resolveScopePath(baseDir, draftScope)).toBe(
      path.join(baseDir, 'interfaces', 'drafts', 'draft-abc123')
    )
    expect(resolveTextPath(baseDir, location)).toBe(
      path.join(baseDir, 'interfaces', 'drafts', 'draft-abc123', '.text', 'manifest.json')
    )
    expect(resolveAssetPath(baseDir, location)).toBe(
      path.join(baseDir, 'interfaces', 'drafts', 'draft-abc123', '.assets', 'manifest.json')
    )
  })

  it('keeps text and assets separate even with the same filename', async () => {
    const location: FileLocation = { scope: draftScope, filename: 'content' }
    await storage.writeText(location, '{"value":1}')
    await storage.writeAsset(location, new Uint8Array([1, 2, 3]))

    expect(await storage.readText(location)).toBe('{"value":1}')
    expect(await storage.readAsset(location)).toEqual(new Uint8Array([1, 2, 3]))
    expect(await storage.listText(draftScope)).toEqual(['content'])
    expect(await storage.listAssets(draftScope)).toEqual(['content'])
  })

  it('atomically replaces an existing file without leaving temporary files', async () => {
    const location: FileLocation = { scope: draftScope, filename: 'instance.json' }
    const filePath = resolveTextPath(baseDir, location)

    await storage.writeText(location, '{"value":"old"}')
    await storage.writeText(location, '{"value":"new"}')

    expect(await storage.readText(location)).toBe('{"value":"new"}')
    expect(await readdir(path.dirname(filePath))).toEqual(['instance.json'])
  })

  it('atomically compares and swaps text across concurrent callers', async () => {
    const location: FileLocation = { scope: draftScope, filename: 'instance.json' }
    const original = '{"revision":0}'
    const candidates = ['{"revision":1,"name":"first"}', '{"revision":1,"name":"second"}']
    await storage.writeText(location, original)

    const results = await Promise.all(
      candidates.map((candidate) => storage.compareAndSwapText(location, original, candidate))
    )

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.filter((result) => !result)).toHaveLength(1)
    expect(candidates).toContain(await storage.readText(location))
    expect(await storage.readText(location)).toBe(candidates[results.indexOf(true)])
  })

  it('preserves the old file and removes the temporary file when replacement fails', async () => {
    const location: FileLocation = { scope: draftScope, filename: 'instance.json' }
    const filePath = resolveTextPath(baseDir, location)
    await storage.writeText(location, '{"value":"old"}')

    await expect(
      atomicWriteFile(filePath, '{"value":"new"}', {
        async rename() {
          const error = new Error('simulated rename failure') as NodeJS.ErrnoException
          error.code = 'EIO'
          throw error
        }
      })
    ).rejects.toThrow('simulated rename failure')

    expect(await readFile(filePath, 'utf8')).toBe('{"value":"old"}')
    expect(await readdir(path.dirname(filePath))).toEqual(['instance.json'])
  })

  it('lists child scopes without exposing reserved directories', async () => {
    await storage.writeText({ scope: ['interfaces'], filename: 'index.json' }, '{}')
    await storage.writeAsset({ scope: ['interfaces'], filename: 'cover.png' }, new Uint8Array([1]))
    await storage.writeText({ scope: ['interfaces', 'published'], filename: 'index.json' }, '{}')
    await storage.writeText({ scope: ['interfaces', 'drafts'], filename: 'index.json' }, '{}')

    expect(await storage.listScopes(['interfaces'])).toEqual(['drafts', 'published'])
  })

  it('uses null, false and empty lists for missing data', async () => {
    const location: FileLocation = { scope: ['config'], filename: 'missing.json' }
    expect(await storage.readText(location)).toBeNull()
    expect(await storage.readAsset(location)).toBeNull()
    expect(await storage.hasText(location)).toBe(false)
    expect(await storage.hasAsset(location)).toBe(false)
    expect(await storage.listText(['config'])).toEqual([])
    expect(await storage.listAssets(['config'])).toEqual([])
    expect(await storage.listScopes(['config'])).toEqual([])
  })

  it('clears one scope recursively without affecting siblings', async () => {
    const draftFile: FileLocation = { scope: draftScope, filename: 'manifest.json' }
    const nestedFile: FileLocation = {
      scope: [...draftScope, 'media'],
      filename: 'index.json'
    }
    const siblingFile: FileLocation = {
      scope: ['interfaces', 'drafts', 'draft-other'],
      filename: 'manifest.json'
    }

    await storage.writeText(draftFile, '{}')
    await storage.writeText(nestedFile, '{}')
    await storage.writeText(siblingFile, '{}')
    await storage.clearScope(draftScope)
    await storage.clearScope(draftScope)

    expect(await storage.hasText(draftFile)).toBe(false)
    expect(await storage.hasText(nestedFile)).toBe(false)
    expect(await storage.hasText(siblingFile)).toBe(true)

    await storage.writeText(draftFile, '{"restored":true}')
    expect(await storage.readText(draftFile)).toBe('{"restored":true}')
  })

  it('rejects traversal before touching disk', async () => {
    await expect(
      storage.writeText({ scope: ['interfaces', '..'], filename: 'outside.json' }, '{}')
    ).rejects.toThrow('Invalid file-store scope segment')
  })
})
