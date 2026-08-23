import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIRouterExtensionStore } from '../main/extension-store'

const EXTENSION_ID = 'facebook-wav2vec2-pronunciation'
const EXTENSION_VERSION = '1.0.0'

describe('AIRouterExtensionStore', () => {
  let baseDir: string
  let store: AIRouterExtensionStore

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'airouter-extensions-'))
    store = new AIRouterExtensionStore({ baseDir })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('imports the required package and resolves validated asset paths', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const result = await importPackage(store, baseDir, createPackage({ bytes }))

    expect(result).toEqual({
      extensionId: EXTENSION_ID,
      version: EXTENSION_VERSION,
      assetCount: 1,
      totalBytes: bytes.byteLength
    })
    await expect(store.getStatus(EXTENSION_ID, EXTENSION_VERSION, 'AI 语音评测')).resolves.toEqual(
      expect.objectContaining({
        state: 'imported',
        installedVersion: EXTENSION_VERSION,
        assetCount: 1,
        totalBytes: bytes.byteLength
      })
    )
    const assets = await store.resolveAssetPaths(EXTENSION_ID, EXTENSION_VERSION)
    await expect(readFile(assets['model/vocab.json'])).resolves.toEqual(Buffer.from(bytes))
  })

  it('deletes an imported extension package', async () => {
    await importPackage(store, baseDir, createPackage())

    await store.deletePackage(EXTENSION_ID, EXTENSION_VERSION)

    expect(store.isInstalled(EXTENSION_ID, EXTENSION_VERSION)).toBe(false)
    await expect(
      store.getStatus(EXTENSION_ID, EXTENSION_VERSION, 'AI 语音评测')
    ).resolves.toMatchObject({ state: 'not-imported' })
  })

  it('rejects packages whose declared ID or version does not match the application requirement', async () => {
    await expect(
      importPackage(store, baseDir, createPackage({ extensionId: 'another-extension' }))
    ).rejects.toThrow('ID 或版本')
    await expect(
      importPackage(store, baseDir, createPackage({ extensionVersion: '2.0.0' }))
    ).rejects.toThrow('ID 或版本')
    await expect(
      store.getStatus(EXTENSION_ID, EXTENSION_VERSION, 'AI 语音评测')
    ).resolves.toMatchObject({ state: 'not-imported' })
  })

  it('rejects an asset whose content does not match its declared hash', async () => {
    await expect(
      importPackage(store, baseDir, createPackage({ sha256: '0'.repeat(64) }))
    ).rejects.toThrow('资产哈希不匹配')
  })

  it('rejects unsafe asset paths before writing outside the extension directory', async () => {
    await expect(
      importPackage(store, baseDir, createPackage({ assetPath: '../escaped.bin' }))
    ).rejects.toThrow()
  })
})

async function importPackage(
  store: AIRouterExtensionStore,
  directory: string,
  bytes: Uint8Array
): Promise<Awaited<ReturnType<AIRouterExtensionStore['importPackage']>>> {
  const packagePath = path.join(directory, `extension-${Math.random().toString(36).slice(2)}.zip`)
  await writeFile(packagePath, bytes)
  return store.importPackage(packagePath, EXTENSION_ID, EXTENSION_VERSION)
}

function createPackage({
  bytes = new Uint8Array([1]),
  extensionId = EXTENSION_ID,
  extensionVersion = EXTENSION_VERSION,
  assetPath = 'model/vocab.json',
  sha256 = createHash('sha256').update(bytes).digest('hex')
}: {
  bytes?: Uint8Array
  extensionId?: string
  extensionVersion?: string
  assetPath?: string
  sha256?: string
} = {}): Uint8Array {
  const manifest = {
    format: 'ls101.extension-package',
    formatVersion: 1,
    extension: {
      id: extensionId,
      version: extensionVersion,
      name: 'AI 语音评测'
    },
    assets: [
      {
        path: assetPath,
        kind: 'model-asset',
        size: bytes.byteLength,
        sha256
      }
    ]
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    [assetPath]: bytes
  })
}
