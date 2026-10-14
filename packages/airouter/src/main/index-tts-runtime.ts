import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { AIRouterIndexTtsRuntimeStatus } from '../shared'

/**
 * On-demand Index TTS runtime bundle for local speech synthesis.
 *
 * Integrity relies on the hard-coded allowlist below: every file is downloaded from the pinned
 * release, and its exact size and SHA-256 digest must match before the bundle is activated.
 * No code signature is checked yet; changing a single byte of any asset requires a new app build.
 */
export const INDEX_TTS_RUNTIME_VERSION = '0.1.0'

const RELEASE_BASE_URL =
  'https://github.com/zzsqjdhqgb/cyez-ls101/releases/download/index-tts-runtime-v0.1.0'
const INSTALL_MARKER = 'install.json'
const ROOT_SEGMENTS = ['airouter', 'runtimes', 'index-tts'] as const

export interface IndexTtsRuntimeFile {
  name: string
  size: number
  sha256: string
  executable?: boolean
}

export interface IndexTtsRuntimeBundle {
  version: string
  baseUrl: string
  /** File name of the Index TTS helper inside the bundle. */
  helper: string
  /** File name of the model inside the bundle. */
  model: string
  files: readonly IndexTtsRuntimeFile[]
}

/** Pinned allowlist keyed by `${process.platform}-${process.arch}`. */
export const INDEX_TTS_RUNTIME_BUNDLES: Readonly<Record<string, IndexTtsRuntimeBundle>> = {
  'linux-x64': {
    version: INDEX_TTS_RUNTIME_VERSION,
    baseUrl: RELEASE_BASE_URL,
    helper: 'ls101-index-tts-helper-cuda-linux-x64',
    model: 'index-tts2_5-q8_0.gguf',
    files: [
      {
        name: 'ls101-index-tts-helper-cuda-linux-x64',
        size: 85928, // CPU binary placeholder - will be replaced with CUDA binary
        sha256: 'e3aa6f6748a3d24f99d61c748d8885d4fa34747af31dbac4c8220949dd116b80', // CPU binary
        executable: true
      },
      {
        name: 'index-tts2_5-q8_0.gguf',
        size: 198660736,
        sha256: 'c0e6182758e3a659d949b8e67c66e04c88ccd1e8b1354fbb3e94b6f3b3d36c52'
      }
    ]
  },
  'win32-x64': {
    version: INDEX_TTS_RUNTIME_VERSION,
    baseUrl: RELEASE_BASE_URL,
    helper: 'ls101-index-tts-helper-cuda-win32-x64.exe',
    model: 'index-tts2_5-q8_0.gguf',
    files: [
      {
        name: 'ls101-index-tts-helper-cuda-win32-x64.exe',
        size: 0, // TODO: update with actual size after release
        sha256: '0000000000000000000000000000000000000000000000000000000000000000', // TODO: update
        executable: true
      },
      {
        name: 'index-tts2_5-q8_0.gguf',
        size: 198660736,
        sha256: 'c0e6182758e3a659d949b8e67c66e04c88ccd1e8b1354fbb3e94b6f3b3d36c52'
      }
    ]
  }
}

export interface IndexTtsRuntimeManagerOptions {
  baseDir: string
  platform?: string
  /** Overrides the pinned allowlist; intended for tests only. */
  bundles?: Readonly<Record<string, IndexTtsRuntimeBundle>>
  fetch?: typeof fetch
}

interface InstallMarker {
  version: string
  platform: string
  files: IndexTtsRuntimeFile[]
}

interface ActiveInstall {
  controller: AbortController
  downloadedBytes: number
  promise: Promise<AIRouterIndexTtsRuntimeStatus>
}

export class IndexTtsRuntimeManager {
  private readonly platform: string
  private readonly bundle: IndexTtsRuntimeBundle | undefined
  private readonly fetchImpl: typeof fetch
  private active: ActiveInstall | null = null
  private lastError: string | undefined

  constructor(private readonly options: IndexTtsRuntimeManagerOptions) {
    this.platform = options.platform ?? `${process.platform}-${process.arch}`
    this.bundle = (options.bundles ?? INDEX_TTS_RUNTIME_BUNDLES)[this.platform]
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args))
  }

  async getStatus(): Promise<AIRouterIndexTtsRuntimeStatus> {
    const bundle = this.bundle
    const totalBytes = bundle ? bundle.files.reduce((sum, file) => sum + file.size, 0) : 0
    const base = {
      version: bundle?.version ?? INDEX_TTS_RUNTIME_VERSION,
      platform: this.platform,
      totalBytes,
      fileCount: bundle?.files.length ?? 0,
      ...(this.lastError ? { lastError: this.lastError } : {})
    }
    if (!bundle) return { ...base, state: 'unsupported', downloadedBytes: 0 }
    if (this.active) {
      return { ...base, state: 'installing', downloadedBytes: this.active.downloadedBytes }
    }
    return (await this.isInstalled(bundle))
      ? { ...base, state: 'installed', downloadedBytes: totalBytes }
      : { ...base, state: 'not-installed', downloadedBytes: 0 }
  }

  /** Downloads, verifies, and activates the bundle. Concurrent calls share one install. */
  install(): Promise<AIRouterIndexTtsRuntimeStatus> {
    if (this.active) return this.active.promise
    const bundle = this.bundle
    if (!bundle)
      return Promise.reject(new Error(`当前平台不支持 Index TTS 运行时：${this.platform}`))
    const controller = new AbortController()
    const active: ActiveInstall = {
      controller,
      downloadedBytes: 0,
      promise: Promise.resolve(null as unknown as AIRouterIndexTtsRuntimeStatus)
    }
    this.lastError = undefined
    this.active = active
    active.promise = this.runInstall(bundle, active)
      .catch((error: unknown) => {
        this.lastError = controller.signal.aborted
          ? '已取消下载'
          : error instanceof Error
            ? error.message
            : String(error)
        throw error
      })
      .finally(() => {
        if (this.active === active) this.active = null
      })
      .then(() => this.getStatus())
    return active.promise
  }

  cancelInstall(): void {
    this.active?.controller.abort()
  }

  async remove(): Promise<void> {
    if (this.active) throw new Error('Index TTS 运行时正在下载，请先取消')
    await rm(this.rootDirectory(), { recursive: true, force: true })
    this.lastError = undefined
  }

  /** Returns the verified Index TTS helper path, or null when the bundle is not installed. */
  async resolveHelperPath(): Promise<string | null> {
    const bundle = this.bundle
    if (!bundle || this.active || !(await this.isInstalled(bundle))) return null
    return path.join(this.installDirectory(bundle), bundle.helper)
  }

  /** Returns the verified model path, or null when the bundle is not installed. */
  async resolveModelPath(): Promise<string | null> {
    const bundle = this.bundle
    if (!bundle || this.active || !(await this.isInstalled(bundle))) return null
    return path.join(this.installDirectory(bundle), bundle.model)
  }

  private async runInstall(bundle: IndexTtsRuntimeBundle, active: ActiveInstall): Promise<void> {
    const root = this.rootDirectory()
    await mkdir(root, { recursive: true })
    await removeStaleStaging(root)
    const staging = path.join(root, `.install-${randomUUID()}`)
    await mkdir(staging)
    try {
      for (const file of bundle.files) {
        await this.downloadFile(bundle, file, staging, active)
      }
      const marker: InstallMarker = {
        version: bundle.version,
        platform: this.platform,
        files: [...bundle.files]
      }
      await writeFile(path.join(staging, INSTALL_MARKER), JSON.stringify(marker, null, 2), 'utf-8')
      const final = this.installDirectory(bundle)
      await rm(final, { recursive: true, force: true })
      await rename(staging, final)
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  private async downloadFile(
    bundle: IndexTtsRuntimeBundle,
    file: IndexTtsRuntimeFile,
    staging: string,
    active: ActiveInstall
  ): Promise<void> {
    const url = `${bundle.baseUrl}/${file.name}`
    const response = await this.fetchImpl(url, { signal: active.controller.signal })
    if (!response.ok || !response.body) {
      throw new Error(`下载失败 ${file.name}：HTTP ${response.status}`)
    }
    const tempPath = path.join(staging, `${file.name}.part`)
    const finalPath = path.join(staging, file.name)
    const fileStream = createWriteStream(tempPath)
    const hash = createHash('sha256')
    let receivedBytes = 0
    const transform = new (await import('node:stream')).Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        receivedBytes += chunk.length
        active.downloadedBytes += chunk.length
        callback(null, chunk)
      }
    })
    try {
      await pipeline(response.body as unknown as NodeJS.ReadableStream, transform, fileStream, {
        signal: active.controller.signal
      })
    } catch (error: unknown) {
      await rm(tempPath, { force: true })
      throw error
    }
    if (receivedBytes !== file.size) {
      await rm(tempPath, { force: true })
      throw new Error(
        `文件大小不匹配 ${file.name}：预期 ${file.size} 字节，实际 ${receivedBytes} 字节`
      )
    }
    const digest = hash.digest('hex')
    if (digest !== file.sha256) {
      await rm(tempPath, { force: true })
      throw new Error(`文件哈希不匹配 ${file.name}：预期 ${file.sha256}，实际 ${digest}`)
    }
    await rename(tempPath, finalPath)
    if (file.executable) {
      await chmod(finalPath, 0o755)
    }
  }

  private async isInstalled(bundle: IndexTtsRuntimeBundle): Promise<boolean> {
    const dir = this.installDirectory(bundle)
    const markerPath = path.join(dir, INSTALL_MARKER)
    try {
      const raw = await readFile(markerPath, 'utf-8')
      const marker = JSON.parse(raw) as InstallMarker
      if (marker.version !== bundle.version || marker.platform !== this.platform) return false
      if (marker.files.length !== bundle.files.length) return false
      for (const file of bundle.files) {
        const candidate = marker.files.find((f) => f.name === file.name)
        if (!candidate || candidate.size !== file.size || candidate.sha256 !== file.sha256) {
          return false
        }
        const filePath = path.join(dir, file.name)
        const stats = await stat(filePath)
        if (!stats.isFile() || stats.size !== file.size) return false
      }
      return true
    } catch {
      return false
    }
  }

  private rootDirectory(): string {
    return path.join(this.options.baseDir, ...ROOT_SEGMENTS)
  }

  private installDirectory(bundle: IndexTtsRuntimeBundle): string {
    return path.join(this.rootDirectory(), bundle.version)
  }
}

async function removeStaleStaging(root: string): Promise<void> {
  try {
    const entries = await readdir(root)
    await Promise.allSettled(
      entries
        .filter((name) => name.startsWith('.install-'))
        .map((name) => rm(path.join(root, name), { recursive: true, force: true }))
    )
  } catch {
    // Directory may not exist yet
  }
}
