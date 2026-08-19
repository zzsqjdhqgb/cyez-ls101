import { rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIRouterSpeechModelStore } from '../main/speech-model-store'

describe('AIRouterSpeechModelStore', () => {
  let baseDir: string
  let store: AIRouterSpeechModelStore

  beforeEach(async () => {
    baseDir = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(tmpdir(), 'airouter-speech-models-'))
    )
    store = new AIRouterSpeechModelStore({ baseDir })
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('imports a package, validates assets, and lists compatible runtimes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const result = await importPackageBytes(
      store,
      baseDir,
      createPackage('pocket-package', '1.0.0', bytes)
    )

    expect(result.package).toEqual(
      expect.objectContaining({
        package: expect.objectContaining({ id: 'pocket-package', version: '1.0.0' }),
        runtime: expect.objectContaining({ engine: 'pocket-tts' }),
        assetCount: 1,
        totalBytes: bytes.byteLength
      })
    )
    expect(result.storedAssetCount).toBe(1)
    expect(result.reusedAssetCount).toBe(0)
    expect(await store.listPackages('pocket-tts')).toHaveLength(1)
    expect(await store.listPackages('qwen-tts')).toEqual([])
    await expect(store.readAsset('pocket-package', '1.0.0', 'model/model.bin')).resolves.toEqual(
      bytes
    )
  })

  it('reuses shared blobs and removes them after the last package reference is deleted', async () => {
    const bytes = new Uint8Array([5, 6, 7])
    await importPackageBytes(store, baseDir, createPackage('package-a', '1.0.0', bytes))
    const second = await importPackageBytes(
      store,
      baseDir,
      createPackage('package-b', '1.0.0', bytes)
    )

    expect(second.reusedAssetCount).toBe(1)
    expect(second.storedAssetCount).toBe(0)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const blobPath = path.join(baseDir, 'models', 'tts', 'blobs', 'sha256', hash.slice(0, 2), hash)
    await expect(stat(blobPath)).resolves.toBeTruthy()

    await store.deletePackage('package-a', '1.0.0')
    await expect(stat(blobPath)).resolves.toBeTruthy()
    await store.deletePackage('package-b', '1.0.0')
    await expect(stat(blobPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a package when an asset hash does not match its content', async () => {
    const packageBytes = createPackage('invalid-package', '1.0.0', new Uint8Array([8, 9]), true)
    await expect(importPackageBytes(store, baseDir, packageBytes)).rejects.toThrow('资产哈希不匹配')
  })

  it('does not persist validated blobs when a later asset fails validation', async () => {
    const validBytes = new Uint8Array([10, 11])
    const validHash = createHash('sha256').update(validBytes).digest('hex')
    const packageBytes = createPackageWithAssets('partial-package', [
      { path: 'model/valid.bin', bytes: validBytes, sha256: validHash },
      { path: 'model/invalid.bin', bytes: new Uint8Array([12]), sha256: '0'.repeat(64) }
    ])

    await expect(importPackageBytes(store, baseDir, packageBytes)).rejects.toThrow('资产哈希不匹配')
    const blobPath = path.join(
      baseDir,
      'models',
      'tts',
      'blobs',
      'sha256',
      validHash.slice(0, 2),
      validHash
    )
    await expect(stat(blobPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the installed package when a replacement fails validation', async () => {
    const originalBytes = new Uint8Array([21, 22, 23])
    await importPackageBytes(
      store,
      baseDir,
      createPackage('replace-package', '1.0.0', originalBytes)
    )
    const replacementBytes = new Uint8Array([31, 32, 33])
    const replacementHash = createHash('sha256').update(replacementBytes).digest('hex')
    const replacement = createPackageWithAssets('replace-package', [
      { path: 'model/new.bin', bytes: replacementBytes, sha256: replacementHash },
      { path: 'model/broken.bin', bytes: new Uint8Array([34]), sha256: '0'.repeat(64) }
    ])

    await expect(importPackageBytes(store, baseDir, replacement)).rejects.toThrow('资产哈希不匹配')
    await expect(store.readAsset('replace-package', '1.0.0', 'model/model.bin')).resolves.toEqual(
      originalBytes
    )
    await expect(store.listPackages()).resolves.toHaveLength(1)
  })

  it('rejects online provider runtimes in local model packages', async () => {
    const bytes = new Uint8Array([13])
    const packageBytes = createPackageWithAssets(
      'online-package',
      [
        {
          path: 'model/model.bin',
          bytes,
          sha256: createHash('sha256').update(bytes).digest('hex')
        }
      ],
      'openai-compatible'
    )

    await expect(importPackageBytes(store, baseDir, packageBytes)).rejects.toThrow(
      'manifest.json 格式无效'
    )
  })

  it('rejects imports above the current app version and hides them after a downgrade', async () => {
    const bytes = new Uint8Array([14])
    const hash = createHash('sha256').update(bytes).digest('hex')
    const packageBytes = createPackageWithAssets(
      'future-package',
      [{ path: 'model/model.bin', bytes, sha256: hash }],
      'pocket-tts',
      '0.4.0'
    )
    const currentStore = new AIRouterSpeechModelStore({ baseDir, appVersion: '0.3.1' })

    await expect(importPackageBytes(currentStore, baseDir, packageBytes)).rejects.toThrow(
      '要求应用版本不低于 0.4.0'
    )

    const futureStore = new AIRouterSpeechModelStore({ baseDir, appVersion: '0.4.0' })
    await importPackageBytes(futureStore, baseDir, packageBytes)
    await expect(currentStore.listPackages()).resolves.toEqual([])
    await expect(currentStore.getPackage('future-package', '1.0.0')).rejects.toThrow(
      '要求应用版本不低于 0.4.0'
    )
  })

  it('accepts development builds at the matching stable minimum version', async () => {
    const bytes = new Uint8Array([15])
    const hash = createHash('sha256').update(bytes).digest('hex')
    const packageBytes = createPackageWithAssets(
      'development-package',
      [{ path: 'model/model.bin', bytes, sha256: hash }],
      'qwen-tts',
      '0.3.1'
    )
    const localStore = new AIRouterSpeechModelStore({
      baseDir,
      appVersion: '0.3.1-local.developer.20260818.abcdef0.dirty'
    })
    await expect(importPackageBytes(localStore, baseDir, packageBytes)).resolves.toBeTruthy()

    for (const appVersion of ['0.3.1-dev.20260818.abcdef0', '0.3.1-nightly.20260818']) {
      const developmentStore = new AIRouterSpeechModelStore({ baseDir, appVersion })
      await expect(developmentStore.listPackages('qwen-tts')).resolves.toHaveLength(1)
    }

    const releaseCandidateStore = new AIRouterSpeechModelStore({
      baseDir,
      appVersion: '0.3.1-rc.1'
    })
    await expect(releaseCandidateStore.listPackages('qwen-tts')).resolves.toEqual([])
  })
})

async function importPackageBytes(
  store: AIRouterSpeechModelStore,
  directory: string,
  bytes: Uint8Array
): Promise<Awaited<ReturnType<AIRouterSpeechModelStore['importPackage']>>> {
  const packagePath = path.join(directory, `package-${Math.random().toString(36).slice(2)}.zip`)
  await writeFile(packagePath, bytes)
  try {
    return await store.importPackage(packagePath)
  } finally {
    await rm(packagePath, { force: true })
  }
}

interface PackageAssetInput {
  path: string
  bytes: Uint8Array
  sha256: string
}

function createPackageWithAssets(
  id: string,
  assets: PackageAssetInput[],
  engine = 'pocket-tts',
  minimumAppVersion?: string
): Uint8Array {
  const manifest = {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: { id, version: '1.0.0', name: id },
    runtime: { engine, engineApiVersion: 1, minimumAppVersion },
    assets: assets.map((asset) => ({
      path: asset.path,
      kind: 'model-asset',
      size: asset.bytes.byteLength,
      sha256: asset.sha256
    })),
    models: [
      {
        id: 'model',
        name: 'Model',
        artifacts: { weights: [assets[0].path] },
        parameters: {}
      }
    ],
    voices: [{ id: 'voice', name: 'Voice', files: [assets[0].path] }]
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    ...Object.fromEntries(assets.map((asset) => [asset.path, asset.bytes]))
  })
}

function createPackage(
  id: string,
  version: string,
  bytes: Uint8Array,
  invalidHash = false
): Uint8Array {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const manifest = {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: { id, version, name: id },
    runtime: { engine: 'pocket-tts', engineApiVersion: 1 },
    assets: [
      {
        path: 'model/model.bin',
        kind: 'model-weights',
        size: bytes.byteLength,
        sha256: invalidHash ? '0'.repeat(64) : hash
      }
    ],
    models: [
      {
        id: 'model',
        name: 'Model',
        artifacts: { weights: ['model/model.bin'] },
        parameters: {}
      }
    ],
    voices: [
      {
        id: 'voice',
        name: 'Voice',
        files: ['model/model.bin']
      }
    ]
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'model/model.bin': bytes
  })
}
