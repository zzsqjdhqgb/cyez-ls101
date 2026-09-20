import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm, stat, statfs, readFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { LabError } from './errors'

export type FaultPoint = (point: string) => void | Promise<void>

export async function syncDirectory(directory: string): Promise<void> {
  // Windows FlushFileBuffers requires a writable directory handle. Never ignore a failed barrier.
  const handle = await open(
    directory,
    process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY
  )
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function durableWrite(
  filename: string,
  bytes: Uint8Array | string,
  fault?: FaultPoint
): Promise<void> {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(filename), `.${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
    await fault?.('file-synced')
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, filename)
    await syncDirectory(dirname(filename))
    await fault?.('file-published')
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function digestFile(filename: string): Promise<string> {
  const handle = await open(filename, 'r')
  const hash = createHash('sha256')
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk)
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

export function confined(root: string, relative: string): string {
  const target = resolve(root, relative)
  if (!target.startsWith(`${resolve(root)}${sep}`)) throw new LabError('INVALID_REQUEST')
  return target
}

export async function ensureSpace(root: string, bytes: number): Promise<void> {
  const space = await statfs(root)
  const available = space.bavail * space.bsize
  // Keep 1 GiB free after this operation, independent of the volume's total capacity.
  if (available - bytes < 1024 ** 3) throw new LabError('STORAGE_UNAVAILABLE')
}

export async function verifiedFile(filename: string, bytes: number, sha256: string): Promise<void> {
  try {
    if ((await stat(filename)).size !== bytes || (await digestFile(filename)) !== sha256) {
      throw new Error('Archive integrity mismatch')
    }
  } catch {
    throw new LabError('STORAGE_UNAVAILABLE')
  }
}

export async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, 'utf8')) as T
}
