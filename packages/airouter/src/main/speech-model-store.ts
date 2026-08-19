import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, open, readFile, readdir, rename, rm, stat, statfs } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { strFromU8 } from 'fflate'
import type {
  AIRouterSpeechRecognitionModelPackageImportResult,
  AIRouterSpeechRecognitionModelPackageManifest,
  AIRouterSpeechRecognitionModelPackageSummary,
  AIRouterSpeechRecognitionProviderType,
  AIRouterSpeechInstalledAsset,
  AIRouterSpeechModelPackageAsset,
  AIRouterSpeechModelPackageImportResult,
  AIRouterSpeechModelPackageManifest,
  AIRouterSpeechModelPackageSummary,
  AIRouterSpeechProviderType
} from '../shared'

const PACKAGE_VERSION = 1
const ENGINE_API_VERSION = 1
const BLOB_DIRECTORY = 'blobs/sha256'
const PACKAGE_DIRECTORY = 'packages'
const validSegment = /^[a-zA-Z0-9_.-]+$/
const validSha256 = /^[a-f0-9]{64}$/
const MAX_ARCHIVE_BYTES = 24 * 1024 ** 3
const MAX_TOTAL_ASSET_BYTES = 20 * 1024 ** 3
const MAX_ASSET_BYTES = 10 * 1024 ** 3
const MAX_MANIFEST_BYTES = 4 * 1024 ** 2
const MAX_ZIP_ENTRIES = 4096
const MAX_MANIFEST_ASSETS = 2048
const MIN_FREE_SPACE_HEADROOM = 512 * 1024 ** 2

interface InstalledPackage {
  manifest: AIRouterSpeechModelPackageManifest
  assets: AIRouterSpeechInstalledAsset[]
}

export interface AIRouterSpeechModelStoreOptions {
  baseDir: string
  appVersion?: string
  packageKind?: 'tts' | 'asr'
}

export class AIRouterSpeechModelStore {
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(private readonly options: AIRouterSpeechModelStoreOptions) {}

  async listPackages(
    providerType?: AIRouterSpeechProviderType
  ): Promise<AIRouterSpeechModelPackageSummary[]> {
    const packages = await this.listInstalledPackages()
    return packages
      .filter(
        ({ manifest }) =>
          isAppCompatible(manifest, this.options.appVersion) &&
          (!providerType || manifest.runtime.engine === providerType)
      )
      .map(({ manifest }) => summarize(manifest))
      .sort((left, right) => {
        const idOrder = left.package.id.localeCompare(right.package.id)
        return idOrder || left.package.version.localeCompare(right.package.version)
      })
  }

  async importPackage(filePath: string): Promise<AIRouterSpeechModelPackageImportResult> {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new TypeError('模型包文件路径无效')
    }
    return this.runMutation(async () => {
      const archivePath = path.resolve(filePath)
      const archiveStats = await stat(archivePath).catch(() => null)
      if (!archiveStats?.isFile()) throw new Error('模型包文件不存在')
      if (archiveStats.size <= 0) throw new Error('模型包必须是非空文件')
      if (archiveStats.size > MAX_ARCHIVE_BYTES) {
        throw new Error(`模型包压缩文件超过 ${formatBytes(MAX_ARCHIVE_BYTES)} 限制`)
      }

      const zip = await openZip(archivePath)
      const stagingRoot = path.join(this.options.baseDir, this.rootDirectory())
      await mkdir(stagingRoot, { recursive: true })
      const stagingDirectory = await mkdtemp(path.join(stagingRoot, '.import-'))
      const createdBlobs: string[] = []
      let packageCommitted = false
      try {
        const entries = await readZipEntries(zip)
        const entryByPath = indexZipEntries(entries)
        const manifestEntry = entryByPath.get('manifest.json')
        if (!manifestEntry) throw new Error('模型包缺少 manifest.json')
        const manifest = parseManifest(
          await readZipEntryBytes(zip, manifestEntry, MAX_MANIFEST_BYTES),
          this.options.packageKind ?? 'tts'
        )
        assertAppCompatible(manifest, this.options.appVersion)
        if (manifest.assets.length > MAX_MANIFEST_ASSETS) {
          throw new Error(`模型包资产数量超过 ${MAX_MANIFEST_ASSETS} 个限制`)
        }
        const totalBytes = manifest.assets.reduce((total, asset) => total + asset.size, 0)
        if (manifest.assets.some((asset) => asset.size > MAX_ASSET_BYTES)) {
          throw new Error(`模型包单个资产超过 ${formatBytes(MAX_ASSET_BYTES)} 限制`)
        }
        if (totalBytes > MAX_TOTAL_ASSET_BYTES) {
          throw new Error(`模型包资产总量超过 ${formatBytes(MAX_TOTAL_ASSET_BYTES)} 限制`)
        }
        await assertAvailableDiskSpace(stagingRoot, totalBytes + MIN_FREE_SPACE_HEADROOM)

        const installedAssets: AIRouterSpeechInstalledAsset[] = []
        let reusedAssetCount = 0
        let storedAssetCount = 0

        for (const asset of manifest.assets) {
          const entry = entryByPath.get(asset.path)
          if (!entry) throw new Error(`模型包缺少资产：${asset.path}`)
          if (entry.uncompressedSize !== asset.size) {
            throw new Error(`模型包资产大小不匹配：${asset.path}`)
          }
          const temporaryPath = path.join(stagingDirectory, `${randomUUID()}.asset`)
          const hash = await streamZipEntryToFile(zip, entry, temporaryPath, asset.size)
          if (hash !== asset.sha256) {
            throw new Error(`模型包资产哈希不匹配：${asset.path}`)
          }
          const reused = await this.ensureBlobFromFile(hash, temporaryPath)
          if (reused) reusedAssetCount++
          else {
            storedAssetCount++
            createdBlobs.push(hash)
          }
          installedAssets.push({ ...asset, blob: `sha256:${hash}` })
        }

        await this.writeInstalledPackage(manifest, installedAssets, stagingDirectory)
        packageCommitted = true
        await this.collectUnreferencedBlobs()
        return { package: summarize(manifest), reusedAssetCount, storedAssetCount }
      } catch (error) {
        if (!packageCommitted) {
          await Promise.all(
            createdBlobs.map((hash) => rm(this.resolveBlobPath(hash), { force: true }))
          )
        }
        throw normalizeImportError(error)
      } finally {
        zip.close()
        await rm(stagingDirectory, { recursive: true, force: true })
      }
    })
  }

  async deletePackage(id: string, version: string): Promise<void> {
    validateSegment(id, '模型包 ID')
    validateSegment(version, '模型包版本')
    await this.runMutation(async () => {
      const packagePath = this.resolvePackageDirectory(id, version)
      await stat(path.join(packagePath, 'manifest.json')).catch(() => {
        throw new Error('模型包不存在')
      })
      await rm(packagePath, { recursive: true, force: true })
      await this.collectUnreferencedBlobs()
    })
  }

  async readAsset(
    packageId: string,
    packageVersion: string,
    assetPath: string
  ): Promise<Uint8Array> {
    const installed = await this.readInstalledPackage(packageId, packageVersion)
    const asset = installed.assets.find((candidate) => candidate.path === assetPath)
    if (!asset) throw new Error(`模型包资产不存在：${assetPath}`)
    const hash = asset.blob.replace(/^sha256:/, '')
    const bytes = new Uint8Array(await readFile(this.resolveBlobPath(hash)))
    if (sha256(bytes) !== hash) throw new Error(`模型 Blob 已损坏：${assetPath}`)
    return bytes
  }

  async resolveAssetFilePath(
    packageId: string,
    packageVersion: string,
    assetPath: string
  ): Promise<string> {
    const installed = await this.readInstalledPackage(packageId, packageVersion)
    const asset = installed.assets.find((candidate) => candidate.path === assetPath)
    if (!asset) throw new Error(`模型包资产不存在：${assetPath}`)
    return this.resolveBlobPath(asset.blob.replace(/^sha256:/, ''))
  }

  async getPackage(id: string, version: string): Promise<AIRouterSpeechModelPackageManifest> {
    const manifest = (await this.readInstalledPackage(id, version)).manifest
    assertAppCompatible(manifest, this.options.appVersion)
    return manifest
  }

  private async listInstalledPackages(): Promise<InstalledPackage[]> {
    const root = this.resolvePackageRoot()
    const packageIds = await listDirectories(root)
    const installed: InstalledPackage[] = []
    for (const id of packageIds) {
      const versions = await listDirectories(path.join(root, id))
      for (const version of versions) {
        installed.push(await this.readInstalledPackage(id, version))
      }
    }
    return installed
  }

  private async readInstalledPackage(id: string, version: string): Promise<InstalledPackage> {
    validateSegment(id, '模型包 ID')
    validateSegment(version, '模型包版本')
    const directory = this.resolvePackageDirectory(id, version)
    const manifest = parseManifestJson(
      await readFile(path.join(directory, 'manifest.json'), 'utf8'),
      this.options.packageKind ?? 'tts'
    )
    const assets = JSON.parse(
      await readFile(path.join(directory, 'assets.json'), 'utf8')
    ) as unknown
    if (!Array.isArray(assets) || !assets.every(isInstalledAsset)) {
      throw new Error('模型包资产索引无效')
    }
    if (
      assets.length !== manifest.assets.length ||
      assets.some((asset) => !manifest.assets.some((candidate) => candidate.path === asset.path))
    ) {
      throw new Error('模型包资产索引与 manifest 不一致')
    }
    return { manifest, assets }
  }

  private async writeInstalledPackage(
    manifest: AIRouterSpeechModelPackageManifest,
    assets: AIRouterSpeechInstalledAsset[],
    stagingDirectory: string
  ): Promise<void> {
    const preparedDirectory = path.join(stagingDirectory, 'package')
    await writeJsonAtomically(path.join(preparedDirectory, 'manifest.json'), manifest)
    await writeJsonAtomically(path.join(preparedDirectory, 'assets.json'), assets)

    const targetDirectory = this.resolvePackageDirectory(
      manifest.package.id,
      manifest.package.version
    )
    const parentDirectory = path.dirname(targetDirectory)
    const backupDirectory = path.join(stagingDirectory, 'previous-package')
    await mkdir(parentDirectory, { recursive: true })
    let backedUp = false
    try {
      await rename(targetDirectory, backupDirectory)
      backedUp = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await rename(preparedDirectory, targetDirectory)
    } catch (error) {
      if (backedUp) await rename(backupDirectory, targetDirectory)
      throw error
    }
    if (backedUp) await rm(backupDirectory, { recursive: true, force: true }).catch(() => undefined)
  }

  private async ensureBlobFromFile(hash: string, temporaryPath: string): Promise<boolean> {
    const filePath = this.resolveBlobPath(hash)
    try {
      if ((await sha256File(filePath)) !== hash) {
        await rm(filePath, { force: true })
      } else {
        await rm(temporaryPath, { force: true })
        return true
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(path.dirname(filePath), { recursive: true })
    await rename(temporaryPath, filePath)
    return false
  }

  private async collectUnreferencedBlobs(): Promise<void> {
    const referenced = new Set<string>()
    for (const installed of await this.listInstalledPackages()) {
      for (const asset of installed.assets) referenced.add(asset.blob.replace(/^sha256:/, ''))
    }

    const root = this.resolveBlobRoot()
    for (const prefix of await listDirectories(root)) {
      for (const filename of await listFiles(path.join(root, prefix))) {
        if (!validSha256.test(filename) || referenced.has(filename)) continue
        await rm(path.join(root, prefix, filename), { force: true })
      }
    }
  }

  private resolvePackageRoot(): string {
    return path.join(this.options.baseDir, this.rootDirectory(), PACKAGE_DIRECTORY)
  }

  private resolveBlobRoot(): string {
    return path.join(this.options.baseDir, this.rootDirectory(), BLOB_DIRECTORY)
  }

  private rootDirectory(): string {
    return this.options.packageKind === 'asr' ? 'models/asr' : 'models/tts'
  }

  private resolvePackageDirectory(id: string, version: string): string {
    validateSegment(id, '模型包 ID')
    validateSegment(version, '模型包版本')
    return path.join(this.resolvePackageRoot(), id, version)
  }

  private resolveBlobPath(hash: string): string {
    if (!validSha256.test(hash)) throw new Error('模型 Blob 哈希无效')
    return path.join(this.resolveBlobRoot(), hash.slice(0, 2), hash)
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release: () => void = () => undefined
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export class AIRouterSpeechRecognitionModelStore {
  private readonly store: AIRouterSpeechModelStore

  constructor(options: Omit<AIRouterSpeechModelStoreOptions, 'packageKind'>) {
    this.store = new AIRouterSpeechModelStore({ ...options, packageKind: 'asr' })
  }

  listPackages(
    providerType?: AIRouterSpeechRecognitionProviderType
  ): Promise<AIRouterSpeechRecognitionModelPackageSummary[]> {
    return this.store.listPackages(providerType as never) as unknown as Promise<
      AIRouterSpeechRecognitionModelPackageSummary[]
    >
  }

  importPackage(filePath: string): Promise<AIRouterSpeechRecognitionModelPackageImportResult> {
    return this.store.importPackage(
      filePath
    ) as unknown as Promise<AIRouterSpeechRecognitionModelPackageImportResult>
  }

  deletePackage(id: string, version: string): Promise<void> {
    return this.store.deletePackage(id, version)
  }

  readAsset(packageId: string, packageVersion: string, assetPath: string): Promise<Uint8Array> {
    return this.store.readAsset(packageId, packageVersion, assetPath)
  }

  resolveAssetFilePath(
    packageId: string,
    packageVersion: string,
    assetPath: string
  ): Promise<string> {
    return this.store.resolveAssetFilePath(packageId, packageVersion, assetPath)
  }

  getPackage(id: string, version: string): Promise<AIRouterSpeechRecognitionModelPackageManifest> {
    return this.store.getPackage(
      id,
      version
    ) as unknown as Promise<AIRouterSpeechRecognitionModelPackageManifest>
  }
}

function openZip(filePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      {
        autoClose: false,
        decodeStrings: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true
      },
      (error, zip) => {
        if (error || !zip) reject(error ?? new Error('模型包不是有效的 ZIP 文件'))
        else resolve(zip)
      }
    )
  }).catch(() => {
    throw new Error('模型包不是有效的 ZIP 文件')
  })
}

function readZipEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = []
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    zip.on('entry', (entry: Entry) => {
      if (settled) return
      if (entries.length >= MAX_ZIP_ENTRIES) {
        fail(new Error(`模型包 ZIP entry 数量超过 ${MAX_ZIP_ENTRIES} 个限制`))
        zip.close()
        return
      }
      entries.push(entry)
      zip.readEntry()
    })
    zip.once('end', () => {
      if (settled) return
      settled = true
      resolve(entries)
    })
    zip.once('error', fail)
    zip.readEntry()
  })
}

function indexZipEntries(entries: Entry[]): Map<string, Entry> {
  const indexed = new Map<string, Entry>()
  let totalUncompressedBytes = 0
  for (const entry of entries) {
    if (entry.uncompressedSize > MAX_ASSET_BYTES) {
      throw new Error(
        `模型包 ZIP entry 超过 ${formatBytes(MAX_ASSET_BYTES)} 限制：${entry.fileName}`
      )
    }
    totalUncompressedBytes += entry.uncompressedSize
    if (totalUncompressedBytes > MAX_TOTAL_ASSET_BYTES) {
      throw new Error(`模型包 ZIP 解压总量超过 ${formatBytes(MAX_TOTAL_ASSET_BYTES)} 限制`)
    }
    const entryPath = entry.fileName
    if (entryPath.endsWith('/')) {
      const directoryPath = entryPath.slice(0, -1)
      if (!isSafeAssetPath(directoryPath)) throw new Error(`模型包路径无效：${entryPath}`)
      continue
    }
    if (entryPath !== 'manifest.json' && !isSafeAssetPath(entryPath)) {
      throw new Error(`模型包路径无效：${entryPath}`)
    }
    if (indexed.has(entryPath)) throw new Error(`模型包存在重复路径：${entryPath}`)
    indexed.set(entryPath, entry)
  }
  return indexed
}

function openZipEntryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(`无法读取模型包资产：${entry.fileName}`))
      else resolve(stream)
    })
  })
}

async function readZipEntryBytes(zip: ZipFile, entry: Entry, limit: number): Promise<Uint8Array> {
  if (entry.uncompressedSize > limit) {
    throw new Error(`模型包文件超过 ${formatBytes(limit)} 限制：${entry.fileName}`)
  }
  const stream = await openZipEntryStream(zip, entry)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > limit)
      throw new Error(`模型包文件超过 ${formatBytes(limit)} 限制：${entry.fileName}`)
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, total)
}

async function streamZipEntryToFile(
  zip: ZipFile,
  entry: Entry,
  temporaryPath: string,
  expectedSize: number
): Promise<string> {
  const input = await openZipEntryStream(zip, entry)
  const hash = createHash('sha256')
  let total = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength
      if (total > expectedSize || total > MAX_ASSET_BYTES) {
        callback(new Error(`模型包资产大小超过限制：${entry.fileName}`))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    }
  })
  try {
    await pipeline(input, counter, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }))
    if (total !== expectedSize) {
      throw new Error(`模型包资产大小不匹配：${entry.fileName}`)
    }
    await syncFile(temporaryPath)
    return hash.digest('hex')
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r')
  try {
    await syncHandle(handle)
  } finally {
    await handle.close()
  }
}

async function syncHandle(handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  try {
    await handle.sync()
  } catch (error) {
    // Windows can report EPERM for fsync on filesystems that do not expose a
    // flush primitive. Integrity is still checked before the file is renamed.
    const code = (error as NodeJS.ErrnoException).code
    if (!['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(code ?? '')) throw error
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

async function assertAvailableDiskSpace(directory: string, requiredBytes: number): Promise<void> {
  const stats = await statfs(directory, { bigint: true })
  const availableBytes = stats.bavail * stats.bsize
  if (availableBytes < BigInt(requiredBytes)) {
    throw new Error(
      `模型包导入磁盘空间不足：需要至少 ${formatBytes(requiredBytes)}，当前可用 ${formatBytes(Number(availableBytes))}`
    )
  }
}

function formatBytes(value: number): string {
  if (value >= 1024 ** 3) {
    return `${(value / 1024 ** 3).toFixed(value % 1024 ** 3 === 0 ? 0 : 1)} GiB`
  }
  if (value >= 1024 ** 2) {
    return `${(value / 1024 ** 2).toFixed(value % 1024 ** 2 === 0 ? 0 : 1)} MiB`
  }
  return `${Math.ceil(value / 1024)} KiB`
}

function normalizeImportError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function parseManifest(
  data: Uint8Array,
  packageKind: 'tts' | 'asr'
): AIRouterSpeechModelPackageManifest {
  return parseManifestJson(strFromU8(data), packageKind)
}

function parseManifestJson(
  value: string,
  packageKind: 'tts' | 'asr'
): AIRouterSpeechModelPackageManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('模型包 manifest.json 不是有效 JSON')
  }
  if (!isManifest(parsed, packageKind)) throw new Error('模型包 manifest.json 格式无效')
  return parsed as AIRouterSpeechModelPackageManifest
}

function isManifest(value: unknown, packageKind: 'tts' | 'asr'): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AIRouterSpeechModelPackageManifest>
  if (
    candidate.format !==
      (packageKind === 'asr' ? 'ls101.asr-model-package' : 'ls101.tts-model-package') ||
    candidate.formatVersion !== PACKAGE_VERSION
  )
    return false
  if (!candidate.package || !isPackageInfo(candidate.package)) return false
  if (!candidate.runtime || !isRuntime(candidate.runtime, packageKind)) return false
  if (!Array.isArray(candidate.assets) || !candidate.assets.every(isPackageAsset)) return false
  if (
    !Array.isArray(candidate.models) ||
    candidate.models.length === 0 ||
    !candidate.models.every(isPackageModel)
  )
    return false
  if (packageKind === 'tts') {
    if (
      !Array.isArray(candidate.voices) ||
      candidate.voices.length === 0 ||
      !candidate.voices.every(isPackageVoice)
    )
      return false
  } else if (candidate.voices !== undefined) {
    return false
  }

  const assets = new Set(candidate.assets.map((asset) => asset.path))
  if (assets.size !== candidate.assets.length) return false
  if (new Set(candidate.models.map((model) => model.id)).size !== candidate.models.length)
    return false
  const voices = candidate.voices ?? []
  if (new Set(voices.map((voice) => voice.id)).size !== voices.length) return false
  if (
    candidate.models.some((model) =>
      Object.values(model.artifacts)
        .flat()
        .some((file) => !assets.has(file))
    )
  ) {
    return false
  }
  return voices.every((voice) => voice.files.every((file) => assets.has(file)))
}

function isPackageInfo(value: unknown): value is AIRouterSpeechModelPackageManifest['package'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    validSegment.test(candidate.id) &&
    typeof candidate.version === 'string' &&
    validSegment.test(candidate.version) &&
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0 &&
    (candidate.description === undefined || typeof candidate.description === 'string')
  )
}

function isRuntime(value: unknown, packageKind: 'tts' | 'asr'): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    (packageKind === 'asr'
      ? candidate.engine === 'qwen3-asr'
      : candidate.engine === 'pocket-tts' || candidate.engine === 'qwen-tts') &&
    candidate.engineApiVersion === ENGINE_API_VERSION &&
    (candidate.minimumAppVersion === undefined || isSemanticVersion(candidate.minimumAppVersion))
  )
}

function assertAppCompatible(
  manifest: AIRouterSpeechModelPackageManifest,
  appVersion?: string
): void {
  const minimum = manifest.runtime.minimumAppVersion
  if (!minimum) return
  if (!appVersion || !isSemanticVersion(appVersion)) {
    throw new Error('无法确定当前应用版本，不能校验模型包兼容性')
  }
  if (
    compareSemanticVersions(appVersion, minimum) < 0 &&
    !isDevelopmentBuildAtStableMinimum(appVersion, minimum)
  ) {
    throw new Error(`模型包要求应用版本不低于 ${minimum}，当前版本为 ${appVersion}`)
  }
}

function isDevelopmentBuildAtStableMinimum(appVersion: string, minimum: string): boolean {
  const current = parseSemanticVersion(appVersion)
  const required = parseSemanticVersion(minimum)
  const channel = current?.prerelease?.[0]
  return Boolean(
    current &&
    required &&
    channel &&
    ['local', 'dev', 'nightly'].includes(channel) &&
    !required.prerelease &&
    current.core.every((part, index) => part === required.core[index])
  )
}

function isAppCompatible(
  manifest: AIRouterSpeechModelPackageManifest,
  appVersion?: string
): boolean {
  try {
    assertAppCompatible(manifest, appVersion)
    return true
  } catch {
    return false
  }
}

interface SemanticVersion {
  core: [bigint, bigint, bigint]
  prerelease: string[] | null
}

function isSemanticVersion(value: unknown): value is string {
  return typeof value === 'string' && parseSemanticVersion(value) !== null
}

function compareSemanticVersions(left: string, right: string): number {
  const leftVersion = parseSemanticVersion(left)
  const rightVersion = parseSemanticVersion(right)
  if (!leftVersion || !rightVersion) throw new Error('应用版本格式无效')
  for (let index = 0; index < leftVersion.core.length; index++) {
    if (leftVersion.core[index] < rightVersion.core[index]) return -1
    if (leftVersion.core[index] > rightVersion.core[index]) return 1
  }
  if (!leftVersion.prerelease && !rightVersion.prerelease) return 0
  if (!leftVersion.prerelease) return 1
  if (!rightVersion.prerelease) return -1
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < length; index++) {
    const leftIdentifier = leftVersion.prerelease[index]
    const rightIdentifier = rightVersion.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      if (leftIdentifier.length !== rightIdentifier.length) {
        return leftIdentifier.length - rightIdentifier.length
      }
      return leftIdentifier.localeCompare(rightIdentifier)
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier.localeCompare(rightIdentifier)
  }
  return 0
}

function parseSemanticVersion(value: string): SemanticVersion | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value
    )
  if (!match) return null
  const prerelease = match[4]?.split('.') ?? null
  if (
    prerelease?.some(
      (identifier) => !identifier || (/^\d+$/.test(identifier) && /^0\d+/.test(identifier))
    )
  ) {
    return null
  }
  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease
  }
}

function isPackageAsset(value: unknown): value is AIRouterSpeechModelPackageAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.path === 'string' &&
    isSafeAssetPath(candidate.path) &&
    typeof candidate.kind === 'string' &&
    candidate.kind.length > 0 &&
    typeof candidate.size === 'number' &&
    Number.isSafeInteger(candidate.size) &&
    candidate.size >= 0 &&
    typeof candidate.sha256 === 'string' &&
    validSha256.test(candidate.sha256)
  )
}

function isPackageModel(
  value: unknown
): value is AIRouterSpeechModelPackageManifest['models'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    (candidate.languageCodes === undefined || isStringArray(candidate.languageCodes)) &&
    isStringArrayRecord(candidate.artifacts) &&
    isRecord(candidate.parameters)
  )
}

function isPackageVoice(
  value: unknown
): value is AIRouterSpeechModelPackageManifest['voices'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    (candidate.languageCodes === undefined || isStringArray(candidate.languageCodes)) &&
    isStringArray(candidate.files) &&
    candidate.files.length > 0 &&
    candidate.files.every(isSafeAssetPath)
  )
}

function isInstalledAsset(value: unknown): value is AIRouterSpeechInstalledAsset {
  if (!isPackageAsset(value)) return false
  const blob = (value as { blob?: unknown }).blob
  return typeof blob === 'string' && /^sha256:[a-f0-9]{64}$/.test(blob)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSafeAssetPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1024 &&
    value
      .replaceAll('\\', '/')
      .split('/')
      .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..') &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  )
}

function summarize(
  manifest: AIRouterSpeechModelPackageManifest
): AIRouterSpeechModelPackageSummary {
  return {
    package: { ...manifest.package },
    runtime: { ...manifest.runtime },
    models: manifest.models.map((model) => ({
      ...model,
      artifacts: Object.fromEntries(
        Object.entries(model.artifacts).map(([key, files]) => [key, [...files]])
      ),
      parameters: structuredClone(model.parameters)
    })),
    voices: (manifest.voices ?? []).map((voice) => ({
      ...voice,
      languageCodes: voice.languageCodes ? [...voice.languageCodes] : undefined,
      files: [...voice.files]
    })),
    assetCount: manifest.assets.length,
    totalBytes: manifest.assets.reduce((total, asset) => total + asset.size, 0)
  }
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

async function listDirectories(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await writeBinaryAtomically(filePath, new TextEncoder().encode(JSON.stringify(value)))
}

async function writeBinaryAtomically(filePath: string, data: Uint8Array): Promise<void> {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.tts-model-${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  let renamed = false
  await mkdir(directory, { recursive: true })
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(data)
    await syncHandle(handle)
    await handle.close()
    handle = null
    await rename(temporaryPath, filePath)
    renamed = true
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    if (!renamed) await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function validateSegment(value: string, label: string): void {
  if (!validSegment.test(value) || value === '.' || value === '..') {
    throw new Error(`${label}无效`)
  }
}
