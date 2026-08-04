import { randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { ASSET_DIRECTORY, TEXT_DIRECTORY } from '../shared/constants'
import { validateFilename, validateScope, validateScopeSegment } from '../shared/pathUtils'
import type { FileLocation, ScopePath } from '../shared/types'

export function resolveScopePath(baseDir: string, scope: ScopePath): string {
  validateScope(scope)
  return path.join(baseDir, ...scope)
}

export function resolveTextPath(baseDir: string, location: FileLocation): string {
  validateFilename(location.filename)
  return path.join(resolveScopePath(baseDir, location.scope), TEXT_DIRECTORY, location.filename)
}

export function resolveAssetPath(baseDir: string, location: FileLocation): string {
  validateFilename(location.filename)
  return path.join(resolveScopePath(baseDir, location.scope), ASSET_DIRECTORY, location.filename)
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

interface AtomicWriteOperations {
  open: typeof open
  rename: typeof rename
  rm: typeof rm
}

const atomicWriteOperations: AtomicWriteOperations = { open, rename, rm }

/** Write beside the target so rename never crosses filesystems. */
export async function atomicWriteFile(
  filePath: string,
  data: string | Uint8Array,
  operationOverrides: Partial<AtomicWriteOperations> = {}
): Promise<void> {
  const operations = { ...atomicWriteOperations, ...operationOverrides }
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.file-store-${randomUUID()}.tmp`)
  let temporaryFile: Awaited<ReturnType<typeof open>> | null = null
  let renamed = false

  await mkdir(directory, { recursive: true })
  try {
    temporaryFile = await operations.open(temporaryPath, 'wx', 0o666)
    await temporaryFile.writeFile(data)
    await temporaryFile.sync()
    await temporaryFile.close()
    temporaryFile = null

    await operations.rename(temporaryPath, filePath)
    renamed = true
    await syncDirectory(directory, operations.open)
  } finally {
    if (temporaryFile) await temporaryFile.close().catch(() => undefined)
    if (!renamed) await operations.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function syncDirectory(directory: string, openFile: typeof open): Promise<void> {
  let directoryHandle: Awaited<ReturnType<typeof open>> | null = null
  try {
    directoryHandle = await openFile(directory, 'r')
    await directoryHandle.sync()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (!code || !['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(code)) throw error
  } finally {
    if (directoryHandle) await directoryHandle.close()
  }
}

export class FileStorage {
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(private readonly baseDir: string) {}

  async readText(location: FileLocation): Promise<string | null> {
    try {
      return await readFile(resolveTextPath(this.baseDir, location), 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  }

  async writeText(location: FileLocation, data: string): Promise<void> {
    if (typeof data !== 'string') throw new TypeError('Text data must be a string')
    await this.runMutation(() => this.write(resolveTextPath(this.baseDir, location), data))
  }

  async compareAndSwapText(
    location: FileLocation,
    expected: string | null,
    data: string
  ): Promise<boolean> {
    if (expected !== null && typeof expected !== 'string') {
      throw new TypeError('Expected text data must be a string or null')
    }
    if (typeof data !== 'string') throw new TypeError('Text data must be a string')
    return this.runMutation(async () => {
      const current = await this.readText(location)
      if (current !== expected) return false
      await this.write(resolveTextPath(this.baseDir, location), data)
      return true
    })
  }

  async readAsset(location: FileLocation): Promise<Uint8Array | null> {
    try {
      const data = await readFile(resolveAssetPath(this.baseDir, location))
      return new Uint8Array(data)
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  }

  async writeAsset(location: FileLocation, data: Uint8Array): Promise<void> {
    if (!(data instanceof Uint8Array)) throw new TypeError('Asset data must be a Uint8Array')
    await this.runMutation(() => this.write(resolveAssetPath(this.baseDir, location), data))
  }

  async deleteText(location: FileLocation): Promise<void> {
    await this.runMutation(() => rm(resolveTextPath(this.baseDir, location), { force: true }))
  }

  async deleteAsset(location: FileLocation): Promise<void> {
    await this.runMutation(() => rm(resolveAssetPath(this.baseDir, location), { force: true }))
  }

  hasText(location: FileLocation): Promise<boolean> {
    return this.exists(resolveTextPath(this.baseDir, location))
  }

  hasAsset(location: FileLocation): Promise<boolean> {
    return this.exists(resolveAssetPath(this.baseDir, location))
  }

  listText(scope: ScopePath): Promise<string[]> {
    return this.listFiles(path.join(resolveScopePath(this.baseDir, scope), TEXT_DIRECTORY))
  }

  listAssets(scope: ScopePath): Promise<string[]> {
    return this.listFiles(path.join(resolveScopePath(this.baseDir, scope), ASSET_DIRECTORY))
  }

  async listScopes(scope: ScopePath): Promise<string[]> {
    try {
      const entries = await readdir(resolveScopePath(this.baseDir, scope), { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .filter((name) => {
          try {
            validateScopeSegment(name)
            return true
          } catch {
            return false
          }
        })
        .sort()
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }
  }

  async clearScope(scope: ScopePath): Promise<void> {
    await this.runMutation(() =>
      rm(resolveScopePath(this.baseDir, scope), { recursive: true, force: true })
    )
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath)
      return true
    } catch (error) {
      if (isMissingFile(error)) return false
      throw error
    }
  }

  private async listFiles(directory: string): Promise<string[]> {
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .filter((filename) => {
          try {
            validateFilename(filename)
            return true
          } catch {
            return false
          }
        })
        .sort()
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }
  }

  private async write(filePath: string, data: string | Uint8Array): Promise<void> {
    await atomicWriteFile(filePath, data)
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
