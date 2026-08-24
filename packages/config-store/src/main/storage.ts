import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
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

async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.config-store-${randomUUID()}.tmp`)
  let temporaryFile: Awaited<ReturnType<typeof open>> | null = null
  let renamed = false

  await mkdir(directory, { recursive: true })
  try {
    temporaryFile = await open(temporaryPath, 'wx', 0o600)
    await temporaryFile.writeFile(data, 'utf8')
    await temporaryFile.sync()
    await temporaryFile.close()
    temporaryFile = null
    await rename(temporaryPath, filePath)
    renamed = true
  } finally {
    if (temporaryFile) await temporaryFile.close().catch(() => undefined)
    if (!renamed) await rm(temporaryPath, { force: true }).catch(() => undefined)
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
