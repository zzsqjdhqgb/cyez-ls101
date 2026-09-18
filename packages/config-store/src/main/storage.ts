import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { validateConfigKey, validateConfigScope } from '../shared/pathUtils'
import type { ConfigLocation, ConfigScope, JsonValue } from '../shared/types'

function configRoot(baseDir: string): string {
  return path.join(baseDir, 'config')
}

export function resolveConfigPath(baseDir: string, location: ConfigLocation): string {
  validateConfigScope(location.scope)
  validateConfigKey(location.key)
  return path.join(configRoot(baseDir), ...location.scope, `${location.key}.json`)
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function assertJsonValue(value: unknown, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object') throw new TypeError('Config data is not a JSON value')
  if (seen.has(value)) throw new TypeError('Config data contains a circular reference')

  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item) => assertJsonValue(item, seen))
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Config data is not a plain JSON object')
    }
    Object.values(value).forEach((item) => assertJsonValue(item, seen))
  }
  seen.delete(value)
}

interface AtomicWriteOperations {
  lstat: typeof lstat
  open: typeof open
  rename: typeof rename
  rm: typeof rm
  platform: NodeJS.Platform
}

const atomicWriteOperations: AtomicWriteOperations = {
  lstat,
  open,
  rename,
  rm,
  platform: process.platform
}

export async function atomicWriteFile(
  filePath: string,
  data: string,
  operationOverrides: Partial<AtomicWriteOperations> = {}
): Promise<void> {
  const operations = { ...atomicWriteOperations, ...operationOverrides }
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.config-store-${randomUUID()}.tmp`)
  let temporaryFile: Awaited<ReturnType<typeof open>> | null = null
  let renamed = false

  await mkdir(directory, { recursive: true })
  try {
    temporaryFile = await operations.open(temporaryPath, 'wx', 0o600)
    await temporaryFile.writeFile(data, 'utf8')
    await temporaryFile.sync()
    await temporaryFile.close()
    temporaryFile = null
    await replaceExistingFile(temporaryPath, filePath, operations)
    renamed = true
  } finally {
    if (temporaryFile) await temporaryFile.close().catch(() => undefined)
    if (!renamed) await operations.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function replaceExistingFile(
  temporaryPath: string,
  filePath: string,
  operations: AtomicWriteOperations
): Promise<void> {
  try {
    await operations.rename(temporaryPath, filePath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (operations.platform !== 'win32' || !['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(code ?? '')) {
      throw error
    }
    try {
      await operations.lstat(filePath)
    } catch (targetError) {
      if ((targetError as NodeJS.ErrnoException).code === 'ENOENT') throw error
      throw targetError
    }
    await operations.rm(filePath, { force: true })
    await operations.rename(temporaryPath, filePath)
  }
}

export class JsonConfigStorage {
  constructor(private readonly baseDir: string) {}

  async read<T extends JsonValue>(location: ConfigLocation): Promise<T | null> {
    try {
      const value = await readFile(resolveConfigPath(this.baseDir, location), 'utf8')
      return JSON.parse(value) as T
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  }

  async write<T extends JsonValue>(location: ConfigLocation, value: T): Promise<void> {
    assertJsonValue(value)
    const serialized = JSON.stringify(value)
    await atomicWriteFile(resolveConfigPath(this.baseDir, location), serialized)
  }

  async delete(location: ConfigLocation): Promise<void> {
    await rm(resolveConfigPath(this.baseDir, location), { force: true })
  }

  async clear(scope: ConfigScope): Promise<void> {
    validateConfigScope(scope)
    await rm(path.join(configRoot(this.baseDir), ...scope), { recursive: true, force: true })
  }
}
