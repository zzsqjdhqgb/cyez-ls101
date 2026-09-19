import { DatabaseSync } from 'node:sqlite'
import { lstat, mkdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { LabError } from './errors'

export function directoryPaths(root: string): {
  target: string
  parent: string
  lock: string
  journal: string
  prefix: string
} {
  const target = resolve(root)
  const parent = dirname(target)
  if (target === parent) throw new LabError('INVALID_REQUEST')
  const prefix = join(parent, `.${basename(target)}`)
  return {
    target,
    parent,
    lock: `${prefix}.owner.sqlite`,
    journal: `${prefix}.restore.json`,
    prefix
  }
}

export async function lockDirectory(root: string): Promise<DatabaseSync> {
  const paths = directoryPaths(root)
  await mkdir(paths.parent, { recursive: true, mode: 0o700 })
  const target = await lstat(paths.target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (target && (!target.isDirectory() || target.isSymbolicLink()))
    throw new LabError('STORAGE_UNAVAILABLE')
  // The lock stays at a fixed sibling path while offline restore switches directories.
  const lock = new DatabaseSync(paths.lock)
  try {
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;')
    return lock
  } catch {
    lock.close()
    throw new LabError('RESOURCE_BUSY')
  }
}
