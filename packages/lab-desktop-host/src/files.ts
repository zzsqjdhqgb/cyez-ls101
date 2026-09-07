import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function syncFolder(directory: string): Promise<void> {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function saveFile(filename: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(filename), `.${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, filename)
    await syncFolder(dirname(filename))
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function loadJson<T>(filename: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filename, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function requireId(id: unknown): asserts id is string {
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  )
    throw new Error('Invalid record identity')
}

export class SerialWrites {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action)
    this.tail = result.catch(() => undefined)
    return result
  }
  async flush(): Promise<void> {
    await this.tail
  }
}
