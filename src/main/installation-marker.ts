import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

export const INSTALLATION_MARKER_FILENAME = '.ls101-installation.json'

const INSTALLATION_MARKER_FORMAT_VERSION = 1
const MAX_MARKER_BYTES = 64 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface InstallationMarker {
  kind: 'ls101-installation'
  formatVersion: typeof INSTALLATION_MARKER_FORMAT_VERSION
  installationId: string
  firstAppVersion: string
  lastAppVersion: string
  createdAt: string
  updatedAt: string
}

interface InstallationMarkerDocument extends InstallationMarker {
  raw: Record<string, unknown>
}

interface InstallationMarkerOptions {
  now?: () => Date
  createId?: () => string
}

export async function ensureInstallationMarker(
  userDataDirectory: string,
  appVersion: string,
  options: InstallationMarkerOptions = {}
): Promise<InstallationMarker> {
  assertAppVersion(appVersion)
  const filename = path.join(userDataDirectory, INSTALLATION_MARKER_FILENAME)
  const existing = await readInstallationMarker(filename)
  const now = (options.now ?? (() => new Date()))()
  if (!Number.isFinite(now.getTime())) throw new Error('当前时间无效，无法写入安装标记')

  if (!existing) {
    const timestamp = now.toISOString()
    const marker: InstallationMarker = {
      kind: 'ls101-installation',
      formatVersion: INSTALLATION_MARKER_FORMAT_VERSION,
      installationId: (options.createId ?? randomUUID)(),
      firstAppVersion: appVersion,
      lastAppVersion: appVersion,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    if (!UUID_PATTERN.test(marker.installationId)) throw new Error('安装标记 ID 无效')
    await writeJsonAtomically(filename, marker)
    return marker
  }

  const updatedAt =
    now.getTime() > Date.parse(existing.updatedAt) ? now.toISOString() : existing.updatedAt
  const marker: InstallationMarker = {
    kind: 'ls101-installation',
    formatVersion: INSTALLATION_MARKER_FORMAT_VERSION,
    installationId: existing.installationId,
    firstAppVersion: existing.firstAppVersion,
    lastAppVersion: appVersion,
    createdAt: existing.createdAt,
    updatedAt
  }
  await writeJsonAtomically(filename, { ...existing.raw, ...marker })
  return marker
}

async function readInstallationMarker(
  filename: string
): Promise<InstallationMarkerDocument | null> {
  const stats = await lstatIfExists(filename)
  if (!stats) return null
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_MARKER_BYTES) {
    throw new Error('当前安装标记不是可识别的普通文件')
  }

  let value: unknown
  try {
    value = JSON.parse(await readFile(filename, 'utf8')) as unknown
  } catch (error) {
    throw new Error('当前安装标记无法读取', { cause: error })
  }
  if (
    !isRecord(value) ||
    value.kind !== 'ls101-installation' ||
    value.formatVersion !== INSTALLATION_MARKER_FORMAT_VERSION ||
    typeof value.installationId !== 'string' ||
    !UUID_PATTERN.test(value.installationId) ||
    typeof value.firstAppVersion !== 'string' ||
    typeof value.lastAppVersion !== 'string' ||
    !isAppVersion(value.firstAppVersion) ||
    !isAppVersion(value.lastAppVersion) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) {
    throw new Error('当前安装标记格式无效或版本不受支持')
  }
  return {
    kind: 'ls101-installation',
    formatVersion: INSTALLATION_MARKER_FORMAT_VERSION,
    installationId: value.installationId,
    firstAppVersion: value.firstAppVersion,
    lastAppVersion: value.lastAppVersion,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    raw: value
  }
}

function assertAppVersion(value: string): void {
  if (!isAppVersion(value)) throw new Error('应用版本号无效，无法写入安装标记')
}

function isAppVersion(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 0x20)
  )
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function lstatIfExists(filename: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function writeJsonAtomically(filename: string, value: object): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | null = null
  let renamed = false
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, filename)
    renamed = true
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    if (!renamed) await rm(temporary, { force: true }).catch(() => undefined)
  }
}
