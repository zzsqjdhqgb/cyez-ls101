import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { AIRouterCudaRuntimeStatus } from '../shared'

/**
 * On-demand CUDA runtime bundle shared by local native engines.
 *
 * Integrity relies on the hard-coded allowlist below: every file is downloaded from the pinned
 * release, and its exact size and SHA-256 digest must match before the bundle is activated.
 * No code signature is checked yet; changing a single byte of any asset requires a new app build.
 */
export const CUDA_RUNTIME_VERSION = '0.3.1'

const RELEASE_BASE_URL =
  'https://github.com/zzsqjdhqgb/cyez-ls101/releases/download/qwen-tts-runtime-v0.3.1'
const INSTALL_MARKER = 'install.json'
const ROOT_SEGMENTS = ['airouter', 'runtimes', 'cuda'] as const

export interface CudaRuntimeFile {
  name: string
  size: number
  sha256: string
  executable?: boolean
}

export interface CudaRuntimeBundle {
  version: string
  baseUrl: string
  /** File name of the Qwen TTS CUDA helper inside the bundle. */
  qwenTtsHelper: string
  files: readonly CudaRuntimeFile[]
}

const NVIDIA_LICENSE: CudaRuntimeFile = {
  name: 'LICENSE.NVIDIA-CUDA.html',
  size: 102279,
  sha256: '6180cc2a02db890cf87ba52f078b7a222b04dcb3c2650865763d4f32ad663a5c'
}

/** Pinned allowlist keyed by `${process.platform}-${process.arch}`. */
export const CUDA_RUNTIME_BUNDLES: Readonly<Record<string, CudaRuntimeBundle>> = {
  'linux-x64': {
    version: CUDA_RUNTIME_VERSION,
    baseUrl: RELEASE_BASE_URL,
    qwenTtsHelper: 'ls101-qwen-tts-helper-cuda-linux-x64',
    files: [
      {
        name: 'ls101-qwen-tts-helper-cuda-linux-x64',
        size: 909257360,
        sha256: 'f443b51191d3f495c5444a52c2cdf40b41e5642e9cdfaa89d9b539b73891b63b',
        executable: true
      },
      NVIDIA_LICENSE
    ]
  },
  'win32-x64': {
    version: CUDA_RUNTIME_VERSION,
    baseUrl: RELEASE_BASE_URL,
    qwenTtsHelper: 'ls101-qwen-tts-helper-cuda-win32-x64.exe',
    files: [
      {
        name: 'ls101-qwen-tts-helper-cuda-win32-x64.exe',
        size: 111437824,
        sha256: 'd1442eef21c4bf63729921396ab2aa305d875fa50f83d46bef9ccb4d655ba99b',
        executable: true
      },
      {
        name: 'cublas64_12.dll',
        size: 113716224,
        sha256: '9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99'
      },
      {
        name: 'cublasLt64_12.dll',
        size: 674667520,
        sha256: 'b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7'
      },
      {
        name: 'nvJitLink_120_0.dll',
        size: 77860352,
        sha256: '959d3cb44527ec884db8dc20772520b584dbe7d622d11b0530e6326417078b3e'
      },
      NVIDIA_LICENSE
    ]
  }
}

export interface CudaRuntimeManagerOptions {
  baseDir: string
  platform?: string
  /** Overrides the pinned allowlist; intended for tests only. */
  bundles?: Readonly<Record<string, CudaRuntimeBundle>>
  fetch?: typeof fetch
}

interface InstallMarker {
  version: string
  platform: string
  files: CudaRuntimeFile[]
}

interface ActiveInstall {
  controller: AbortController
  downloadedBytes: number
  promise: Promise<AIRouterCudaRuntimeStatus>
}

export class CudaRuntimeManager {
  private readonly platform: string
  private readonly bundle: CudaRuntimeBundle | undefined
  private readonly fetchImpl: typeof fetch
  private active: ActiveInstall | null = null
  private lastError: string | undefined

  constructor(private readonly options: CudaRuntimeManagerOptions) {
    this.platform = options.platform ?? `${process.platform}-${process.arch}`
    this.bundle = (options.bundles ?? CUDA_RUNTIME_BUNDLES)[this.platform]
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args))
  }

  async getStatus(): Promise<AIRouterCudaRuntimeStatus> {
    const bundle = this.bundle
    const totalBytes = bundle ? bundle.files.reduce((sum, file) => sum + file.size, 0) : 0
    const base = {
      version: bundle?.version ?? CUDA_RUNTIME_VERSION,
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
  install(): Promise<AIRouterCudaRuntimeStatus> {
    if (this.active) return this.active.promise
    const bundle = this.bundle
    if (!bundle) return Promise.reject(new Error(`当前平台不支持 CUDA 运行时：${this.platform}`))
    const controller = new AbortController()
    const active: ActiveInstall = {
      controller,
      downloadedBytes: 0,
      promise: Promise.resolve(null as unknown as AIRouterCudaRuntimeStatus)
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
    if (this.active) throw new Error('CUDA 运行时正在下载，请先取消')
    await rm(this.rootDirectory(), { recursive: true, force: true })
    this.lastError = undefined
  }

  /** Returns the verified Qwen TTS CUDA helper path, or null when the bundle is not installed. */
  async resolveQwenTtsHelperPath(): Promise<string | null> {
    const bundle = this.bundle
    if (!bundle || this.active || !(await this.isInstalled(bundle))) return null
    return path.join(this.installDirectory(bundle), bundle.qwenTtsHelper)
  }

  private async runInstall(bundle: CudaRuntimeBundle, active: ActiveInstall): Promise<void> {
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
        files: bundle.files.map((file) => ({ ...file }))
      }
      await writeFile(path.join(staging, INSTALL_MARKER), `${JSON.stringify(marker, null, 2)}\n`)
      const target = this.installDirectory(bundle)
      await mkdir(path.dirname(target), { recursive: true })
      await rm(target, { recursive: true, force: true })
      await rename(staging, target)
      await removeOtherVersions(root, bundle.version)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  private async downloadFile(
    bundle: CudaRuntimeBundle,
    file: CudaRuntimeFile,
    directory: string,
    active: ActiveInstall
  ): Promise<void> {
    assertSafeFileName(file.name)
    const { signal } = active.controller
    const url = `${bundle.baseUrl}/${encodeURIComponent(file.name)}`
    const response = await this.fetchImpl(url, { signal, redirect: 'follow' })
    if (!response.ok || !response.body) {
      throw new Error(`下载 ${file.name} 失败：HTTP ${response.status}`)
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > 0 && declared !== file.size) {
      throw new Error(`${file.name} 大小与白名单不符`)
    }
    const hash = createHash('sha256')
    const destination = path.join(directory, file.name)
    let received = 0
    const startBytes = active.downloadedBytes
    await pipeline(
      readBody(response.body),
      async function* verify(source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          received += chunk.byteLength
          if (received > file.size) throw new Error(`${file.name} 大小超出白名单`)
          hash.update(chunk)
          active.downloadedBytes = startBytes + received
          yield chunk
        }
      },
      createWriteStream(destination, { flags: 'wx' }),
      { signal }
    )
    if (received !== file.size) throw new Error(`${file.name} 下载不完整`)
    const digest = hash.digest('hex')
    if (digest !== file.sha256) throw new Error(`${file.name} SHA-256 校验失败`)
    if (file.executable && process.platform !== 'win32') await chmod(destination, 0o755)
  }

  private async isInstalled(bundle: CudaRuntimeBundle): Promise<boolean> {
    const directory = this.installDirectory(bundle)
    try {
      const marker = JSON.parse(
        await readFile(path.join(directory, INSTALL_MARKER), 'utf8')
      ) as Partial<InstallMarker>
      if (marker.version !== bundle.version || marker.platform !== this.platform) return false
      if (!Array.isArray(marker.files) || marker.files.length !== bundle.files.length) return false
      for (const file of bundle.files) {
        const recorded = marker.files.find((candidate) => candidate?.name === file.name)
        if (!recorded || recorded.sha256 !== file.sha256 || recorded.size !== file.size) {
          return false
        }
        const stats = await stat(path.join(directory, file.name))
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

  private installDirectory(bundle: CudaRuntimeBundle): string {
    return path.join(this.rootDirectory(), bundle.version, this.platform)
  }
}

async function* readBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function assertSafeFileName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error(`CUDA 运行时文件名无效：${name}`)
  }
}

async function removeStaleStaging(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('.install-'))
      .map((entry) => rm(path.join(root, entry.name), { recursive: true, force: true }))
  )
}

async function removeOtherVersions(root: string, version: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && entry.name !== version && !entry.name.startsWith('.')
      )
      .map((entry) => rm(path.join(root, entry.name), { recursive: true, force: true }))
  )
}
