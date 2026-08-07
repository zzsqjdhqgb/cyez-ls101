import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type {
  AIRouterSpeechInstalledAsset,
  AIRouterSpeechModelPackageAsset,
  AIRouterSpeechModelPackageImportResult,
  AIRouterSpeechModelPackageManifest,
  AIRouterSpeechModelPackageSummary,
  AIRouterSpeechProviderType
} from '../shared'

const PACKAGE_FORMAT = 'ls101.tts-model-package'
const PACKAGE_VERSION = 1
const ENGINE_API_VERSION = 1
const ROOT_DIRECTORY = 'models/tts'
const BLOB_DIRECTORY = 'blobs/sha256'
const PACKAGE_DIRECTORY = 'packages'
const validSegment = /^[a-zA-Z0-9_.-]+$/
const validSha256 = /^[a-f0-9]{64}$/

interface InstalledPackage {
  manifest: AIRouterSpeechModelPackageManifest
  assets: AIRouterSpeechInstalledAsset[]
}

export interface AIRouterSpeechModelStoreOptions {
  baseDir: string
  appVersion?: string
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

  async importPackage(data: Uint8Array): Promise<AIRouterSpeechModelPackageImportResult> {
    if (!(data instanceof Uint8Array) || data.byteLength === 0) {
      throw new TypeError('模型包必须是非空二进制数据')
    }

    return this.runMutation(async () => {
      let entries: Record<string, Uint8Array>
      try {
        entries = unzipSync(data)
      } catch {
        throw new Error('模型包不是有效的 ZIP 文件')
      }
      const manifest = parseManifest(entries)
      assertAppCompatible(manifest, this.options.appVersion)
      const validatedAssets = manifest.assets.map((asset) => {
        const bytes = entries[asset.path]
        if (!bytes) throw new Error(`模型包缺少资产：${asset.path}`)
        if (bytes.byteLength !== asset.size) {
          throw new Error(`模型包资产大小不匹配：${asset.path}`)
        }
        const hash = sha256(bytes)
        if (hash !== asset.sha256) {
          throw new Error(`模型包资产哈希不匹配：${asset.path}`)
        }
        return { asset, bytes, hash }
      })

      const installedAssets: AIRouterSpeechInstalledAsset[] = []
      let reusedAssetCount = 0
      let storedAssetCount = 0

      for (const { asset, bytes, hash } of validatedAssets) {
        const blob = `sha256:${hash}`
        const reused = await this.ensureBlob(hash, bytes)
        if (reused) reusedAssetCount++
        else storedAssetCount++
        installedAssets.push({ ...asset, blob })
      }

      await this.writeInstalledPackage(manifest, installedAssets)
      await this.collectUnreferencedBlobs()
      return {
        package: summarize(manifest),
        reusedAssetCount,
        storedAssetCount
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
      await readFile(path.join(directory, 'manifest.json'), 'utf8')
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
    assets: AIRouterSpeechInstalledAsset[]
  ): Promise<void> {
    const directory = this.resolvePackageDirectory(manifest.package.id, manifest.package.version)
    await writeJsonAtomically(path.join(directory, 'manifest.json'), manifest)
    await writeJsonAtomically(path.join(directory, 'assets.json'), assets)
  }

  private async ensureBlob(hash: string, data: Uint8Array): Promise<boolean> {
    const filePath = this.resolveBlobPath(hash)
    try {
      const existing = new Uint8Array(await readFile(filePath))
      if (sha256(existing) !== hash) {
        await rm(filePath, { force: true })
      } else return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await writeBinaryAtomically(filePath, data)
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
    return path.join(this.options.baseDir, ROOT_DIRECTORY, PACKAGE_DIRECTORY)
  }

  private resolveBlobRoot(): string {
    return path.join(this.options.baseDir, ROOT_DIRECTORY, BLOB_DIRECTORY)
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

function parseManifest(entries: Record<string, Uint8Array>): AIRouterSpeechModelPackageManifest {
  const manifestData = entries['manifest.json']
  if (!manifestData) throw new Error('模型包缺少 manifest.json')
  return parseManifestJson(strFromU8(manifestData))
}

function parseManifestJson(value: string): AIRouterSpeechModelPackageManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('模型包 manifest.json 不是有效 JSON')
  }
  if (!isManifest(parsed)) throw new Error('模型包 manifest.json 格式无效')
  return parsed
}

function isManifest(value: unknown): value is AIRouterSpeechModelPackageManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<AIRouterSpeechModelPackageManifest>
  if (candidate.format !== PACKAGE_FORMAT || candidate.formatVersion !== PACKAGE_VERSION)
    return false
  if (!candidate.package || !isPackageInfo(candidate.package)) return false
  if (!candidate.runtime || !isRuntime(candidate.runtime)) return false
  if (!Array.isArray(candidate.assets) || !candidate.assets.every(isPackageAsset)) return false
  if (
    !Array.isArray(candidate.models) ||
    candidate.models.length === 0 ||
    !candidate.models.every(isPackageModel)
  )
    return false
  if (
    !Array.isArray(candidate.voices) ||
    candidate.voices.length === 0 ||
    !candidate.voices.every(isPackageVoice)
  )
    return false

  const assets = new Set(candidate.assets.map((asset) => asset.path))
  if (assets.size !== candidate.assets.length) return false
  if (new Set(candidate.models.map((model) => model.id)).size !== candidate.models.length)
    return false
  if (new Set(candidate.voices.map((voice) => voice.id)).size !== candidate.voices.length)
    return false
  if (
    candidate.models.some((model) =>
      Object.values(model.artifacts)
        .flat()
        .some((file) => !assets.has(file))
    )
  ) {
    return false
  }
  return candidate.voices.every((voice) => voice.files.every((file) => assets.has(file)))
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

function isRuntime(value: unknown): value is AIRouterSpeechModelPackageManifest['runtime'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.engine === 'pocket-tts' || candidate.engine === 'qwen-tts') &&
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
  if (compareSemanticVersions(appVersion, minimum) < 0) {
    throw new Error(`模型包要求应用版本不低于 ${minimum}，当前版本为 ${appVersion}`)
  }
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
    voices: manifest.voices.map((voice) => ({
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

function validateSegment(value: string, label: string): void {
  if (!validSegment.test(value) || value === '.' || value === '..') {
    throw new Error(`${label}无效`)
  }
}
