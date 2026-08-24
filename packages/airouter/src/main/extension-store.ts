import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { strFromU8 } from 'fflate'
import type {
  AIRouterPronunciationAssessmentExtensionImportResult,
  AIRouterPronunciationAssessmentExtensionStatus
} from '../shared'

const FORMAT = 'ls101.extension-package'
const FORMAT_VERSION = 1
const ROOT = 'extensions'
const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3
const MAX_TOTAL_BYTES = 2 * 1024 ** 3
const MAX_ASSET_BYTES = 2 * 1024 ** 3
const MAX_MANIFEST_BYTES = 4 * 1024 ** 2
const MAX_ENTRIES = 4096
const SHA256 = /^[a-f0-9]{64}$/
const SEGMENT = /^[a-zA-Z0-9_.-]+$/

export interface AIRouterExtensionStoreOptions {
  baseDir: string
}

export interface AIRouterExtensionManifest {
  format: typeof FORMAT
  formatVersion: 1
  extension: { id: string; version: string; name: string; description?: string }
  assets: Array<{ path: string; kind: string; size: number; sha256: string }>
}

export class AIRouterExtensionStore {
  private readonly baseDir: string

  constructor(options: AIRouterExtensionStoreOptions) {
    this.baseDir = options.baseDir
  }

  isInstalled(extensionId: string, version: string): boolean {
    return existsSync(path.join(this.packageDir(extensionId, version), 'manifest.json'))
  }

  async getStatus(
    extensionId: string,
    requiredVersion: string,
    name: string
  ): Promise<AIRouterPronunciationAssessmentExtensionStatus> {
    const installed = await this.readInstalled(extensionId, requiredVersion).catch(() => null)
    return {
      extensionId,
      requiredVersion,
      name,
      state: installed ? 'imported' : 'not-imported',
      ...(installed
        ? {
            installedVersion: installed.extension.version,
            assetCount: installed.assets.length,
            totalBytes: installed.assets.reduce((total, asset) => total + asset.size, 0)
          }
        : {})
    }
  }

  async importPackage(
    filePath: string,
    extensionId: string,
    requiredVersion: string
  ): Promise<AIRouterPronunciationAssessmentExtensionImportResult> {
    const archiveStats = await stat(path.resolve(filePath)).catch(() => null)
    if (!archiveStats?.isFile()) throw new Error('扩展包文件不存在')
    if (archiveStats.size <= 0 || archiveStats.size > MAX_ARCHIVE_BYTES) {
      throw new Error('扩展包文件大小无效')
    }
    const zip = await openZip(path.resolve(filePath))
    const root = path.join(this.baseDir, ROOT)
    await mkdir(root, { recursive: true })
    const staging = await mkdtemp(path.join(root, '.import-'))
    try {
      const entries = indexEntries(await readEntries(zip))
      const manifestEntry = entries.get('manifest.json')
      if (!manifestEntry) throw new Error('扩展包缺少 manifest.json')
      const manifest = parseManifest(
        await readEntry(zip, manifestEntry, MAX_MANIFEST_BYTES),
        extensionId,
        requiredVersion
      )
      const total = manifest.assets.reduce((sum, asset) => sum + asset.size, 0)
      if (total > MAX_TOTAL_BYTES) throw new Error('扩展包资产总量超过限制')
      const installedAssets: AIRouterExtensionManifest['assets'] = []
      for (const asset of manifest.assets) {
        const entry = entries.get(asset.path)
        if (!entry || entry.uncompressedSize !== asset.size) {
          throw new Error(`扩展包资产缺失或大小不匹配：${asset.path}`)
        }
        const temporary = path.join(staging, randomUUID())
        const hash = await streamEntry(zip, entry, temporary, asset.size)
        if (hash !== asset.sha256) throw new Error(`扩展包资产哈希不匹配：${asset.path}`)
        installedAssets.push(asset)
        const target = path.join(staging, 'assets', asset.path)
        await mkdir(path.dirname(target), { recursive: true })
        await rename(temporary, target)
      }
      const packageDir = this.packageDir(extensionId, requiredVersion)
      const prepared = path.join(staging, 'package')
      await mkdir(prepared, { recursive: true })
      await writeJson(path.join(prepared, 'manifest.json'), manifest)
      await writeJson(path.join(prepared, 'assets.json'), installedAssets)
      for (const asset of installedAssets) {
        const source = path.join(staging, 'assets', asset.path)
        const target = path.join(prepared, 'assets', asset.path)
        await mkdir(path.dirname(target), { recursive: true })
        await rename(source, target)
      }
      await mkdir(path.dirname(packageDir), { recursive: true })
      await rm(packageDir, { recursive: true, force: true })
      await rename(prepared, packageDir)
      return {
        extensionId,
        version: requiredVersion,
        assetCount: installedAssets.length,
        totalBytes: total
      }
    } finally {
      zip.close()
      await rm(staging, { recursive: true, force: true })
    }
  }

  async resolveAssetPaths(extensionId: string, version: string): Promise<Record<string, string>> {
    const installed = await this.readInstalled(extensionId, version)
    return Object.fromEntries(
      installed.assets.map((asset) => [
        asset.path,
        path.join(this.packageDir(extensionId, version), 'assets', asset.path)
      ])
    )
  }

  private packageDir(extensionId: string, version: string): string {
    validateSegment(extensionId)
    validateSegment(version)
    return path.join(this.baseDir, ROOT, extensionId, version)
  }

  private async readInstalled(
    extensionId: string,
    version: string
  ): Promise<{
    extension: AIRouterExtensionManifest['extension']
    assets: AIRouterExtensionManifest['assets']
  }> {
    const directory = this.packageDir(extensionId, version)
    const manifest = parseManifest(
      new Uint8Array(await readFile(path.join(directory, 'manifest.json'))),
      extensionId,
      version
    )
    const assets = JSON.parse(
      await readFile(path.join(directory, 'assets.json'), 'utf8')
    ) as unknown
    if (!Array.isArray(assets) || assets.length !== manifest.assets.length) {
      throw new Error('扩展包资产索引无效')
    }
    for (const asset of manifest.assets) {
      const file = path.join(directory, 'assets', asset.path)
      if (!(await stat(file).catch(() => null))?.isFile()) throw new Error('扩展包资产缺失')
    }
    return { extension: manifest.extension, assets: manifest.assets }
  }
}

function parseManifest(
  data: Uint8Array,
  extensionId: string,
  version: string
): AIRouterExtensionManifest {
  let value: unknown
  try {
    value = JSON.parse(strFromU8(data))
  } catch {
    throw new Error('扩展包 manifest.json 不是有效 JSON')
  }
  if (!isRecord(value) || value.format !== FORMAT || value.formatVersion !== FORMAT_VERSION) {
    throw new Error('扩展包格式无效')
  }
  const extension = value.extension
  if (
    !isRecord(extension) ||
    extension.id !== extensionId ||
    extension.version !== version ||
    typeof extension.name !== 'string'
  ) {
    throw new Error('扩展包 ID 或版本与应用要求不匹配')
  }
  if (!Array.isArray(value.assets) || value.assets.length === 0) throw new Error('扩展包没有资产')
  const assets = value.assets
  if (!assets.every(isAsset)) throw new Error('扩展包资产清单无效')
  if (new Set(assets.map((asset) => asset.path)).size !== assets.length) {
    throw new Error('扩展包存在重复资产路径')
  }
  return {
    format: FORMAT,
    formatVersion: 1,
    extension: extension as AIRouterExtensionManifest['extension'],
    assets
  }
}

function isAsset(value: unknown): value is AIRouterExtensionManifest['assets'][number] {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    isSafePath(value.path) &&
    typeof value.kind === 'string' &&
    Number.isSafeInteger(value.size) &&
    value.size > 0 &&
    value.size <= MAX_ASSET_BYTES &&
    typeof value.sha256 === 'string' &&
    SHA256.test(value.sha256)
  )
}

function indexEntries(entries: Entry[]): Map<string, Entry> {
  if (entries.length > MAX_ENTRIES) throw new Error('扩展包文件数量超过限制')
  const indexed = new Map<string, Entry>()
  for (const entry of entries) {
    if (entry.fileName.endsWith('/')) continue
    if (entry.fileName !== 'manifest.json' && !isSafePath(entry.fileName)) {
      throw new Error(`扩展包路径无效：${entry.fileName}`)
    }
    if (indexed.has(entry.fileName)) throw new Error(`扩展包存在重复路径：${entry.fileName}`)
    indexed.set(entry.fileName, entry)
  }
  return indexed
}

function isSafePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  )
}

function validateSegment(value: string): void {
  if (!SEGMENT.test(value) || value === '.' || value === '..') throw new Error('扩展包路径无效')
}

function openZip(filePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(
      filePath,
      { autoClose: false, lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) reject(new Error('扩展包不是有效的 ZIP 文件'))
        else resolve(zip)
      }
    )
  )
}

function readEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = []
    zip.on('entry', (entry) => {
      entries.push(entry)
      zip.readEntry()
    })
    zip.once('end', () => resolve(entries))
    zip.once('error', reject)
    zip.readEntry()
  })
}

async function readEntry(zip: ZipFile, entry: Entry, limit: number): Promise<Uint8Array> {
  if (entry.uncompressedSize > limit) throw new Error('扩展包 manifest 过大')
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error('无法读取扩展包 manifest'))
      const chunks: Buffer[] = []
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      stream.once('end', () => resolve(Buffer.concat(chunks)))
      stream.once('error', reject)
    })
  })
}

async function streamEntry(
  zip: ZipFile,
  entry: Entry,
  target: string,
  expected: number
): Promise<string> {
  const input = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) =>
      error || !stream ? reject(error) : resolve(stream)
    )
  })
  const hash = createHash('sha256')
  let size = 0
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      if (size > expected) return callback(new Error('扩展包资产大小超出清单'))
      hash.update(chunk)
      callback(null, chunk)
    }
  })
  await pipeline(input, counter, createWriteStream(target, { flags: 'wx' }))
  if (size !== expected) throw new Error('扩展包资产大小不匹配')
  return hash.digest('hex')
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const handle = await open(filePath, 'w')
  try {
    await handle.writeFile(JSON.stringify(value))
  } finally {
    await handle.close()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
