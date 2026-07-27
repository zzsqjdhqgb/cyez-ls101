import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

export class FileStorage {
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
    await this.write(resolveTextPath(this.baseDir, location), data)
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
    await this.write(resolveAssetPath(this.baseDir, location), data)
  }

  async deleteText(location: FileLocation): Promise<void> {
    await rm(resolveTextPath(this.baseDir, location), { force: true })
  }

  async deleteAsset(location: FileLocation): Promise<void> {
    await rm(resolveAssetPath(this.baseDir, location), { force: true })
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
    await rm(resolveScopePath(this.baseDir, scope), { recursive: true, force: true })
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
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, data)
  }
}
