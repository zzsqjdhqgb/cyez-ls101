import { randomUUID } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat
} from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import {
  DATA_DIRECTORY_CHANNELS,
  type DataDirectoryCandidate,
  type DataDirectoryInfo
} from '@ls101/core-types'

const FORMAT_VERSION = 1
const BOOTSTRAP_FILENAME = 'data-location.json'
const MARKER_FILENAME = '.ls101-data.json'
const LEGACY_DIRECTORIES = [
  'config',
  'secrets',
  'models',
  'extensions',
  'template-editor',
  'interfaces',
  'schema-editor',
  'exam-library',
  'submission-library'
] as const

interface ReadyBootstrap {
  formatVersion: typeof FORMAT_VERSION
  state: 'ready'
  activeDataDirectory: string
}

interface MigratingBootstrap {
  formatVersion: typeof FORMAT_VERSION
  state: 'migrating'
  activeDataDirectory: string
  source: string
  target: string
  mode: 'copy' | 'use-existing'
}

type Bootstrap = ReadyBootstrap | MigratingBootstrap

interface DataDirectoryMarker {
  formatVersion: typeof FORMAT_VERSION
  kind: 'ls101-data-directory'
}

interface FileManifestEntry {
  relativePath: string
  size: number
}

export async function initializeDataDirectory(userDataDir: string): Promise<string> {
  const bootstrap = await readBootstrap(userDataDir)
  if (bootstrap?.state === 'migrating') return finishPendingMigration(userDataDir, bootstrap)
  if (bootstrap) {
    const activeDataDirectory = await normalizeDirectory(bootstrap.activeDataDirectory)
    await assertManagedDirectory(activeDataDirectory)
    return activeDataDirectory
  }

  const defaultPath = path.join(userDataDir, 'data')
  if (await isManagedDirectory(defaultPath)) {
    await writeReadyBootstrap(userDataDir, defaultPath)
    return defaultPath
  }

  const legacyDirectories = await existingLegacyDirectories(userDataDir)
  if (legacyDirectories.length > 0) {
    await migrateLegacyData(userDataDir, defaultPath, legacyDirectories)
  } else {
    await createManagedDirectory(defaultPath)
  }
  await writeReadyBootstrap(userDataDir, defaultPath)
  return defaultPath
}

export function registerDataDirectoryHandlers(userDataDir: string, currentPath: string): void {
  ipcMain.handle(
    DATA_DIRECTORY_CHANNELS.getInfo,
    async (): Promise<DataDirectoryInfo> => ({
      currentPath,
      defaultPath: path.join(userDataDir, 'data'),
      sizeBytes: await directorySize(currentPath)
    })
  )
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.choose, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          properties: ['openDirectory', 'createDirectory'],
          title: '选择数据目录'
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          title: '选择数据目录'
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return inspectCandidate(result.filePaths[0], currentPath)
  })
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.migrate, async (_event, target: string) => {
    const candidate = await inspectCandidate(target, currentPath)
    if (candidate.kind !== 'empty') throw new Error('迁移目标必须是空目录')
    await scheduleMigration(userDataDir, currentPath, candidate.path, 'copy')
    relaunchAfterReply()
  })
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.useExisting, async (_event, target: string) => {
    const candidate = await inspectCandidate(target, currentPath)
    if (candidate.kind !== 'managed') throw new Error('所选目录不是可识别的 LS101 数据目录')
    await scheduleMigration(userDataDir, currentPath, candidate.path, 'use-existing')
    relaunchAfterReply()
  })
}

export async function recoverDataDirectory(userDataDir: string, error: unknown): Promise<never> {
  let message = errorMessage(error)
  while (true) {
    const result = await dialog.showMessageBox({
      type: 'error',
      title: '数据目录不可用',
      message: '无法打开软件数据目录',
      detail: message,
      buttons: ['重试', '选择已有数据目录', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (result.response === 0) {
      try {
        await initializeDataDirectory(userDataDir)
        app.relaunch()
        app.exit(0)
      } catch (retryError) {
        message = errorMessage(retryError)
      }
      continue
    }
    if (result.response === 1) {
      const selection = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择已有的 LS101 数据目录'
      })
      if (selection.canceled || selection.filePaths.length === 0) continue
      try {
        const selected = await normalizeDirectory(selection.filePaths[0])
        await assertManagedDirectory(selected)
        await writeReadyBootstrap(userDataDir, selected)
        app.relaunch()
        app.exit(0)
      } catch (selectionError) {
        message = errorMessage(selectionError)
      }
      continue
    }
    app.exit(1)
  }
}

async function inspectCandidate(
  target: string,
  currentPath: string
): Promise<DataDirectoryCandidate> {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('数据目录路径无效')
  const normalizedTarget = await normalizeDirectory(target)
  const normalizedCurrent = await normalizeDirectory(currentPath)
  if (samePath(normalizedTarget, normalizedCurrent)) {
    return {
      path: normalizedTarget,
      kind: 'current',
      sizeBytes: await directorySize(normalizedTarget)
    }
  }
  assertSeparateDirectories(normalizedCurrent, normalizedTarget)
  if (await isManagedDirectory(normalizedTarget)) {
    return {
      path: normalizedTarget,
      kind: 'managed',
      sizeBytes: await directorySize(normalizedTarget)
    }
  }
  const entries = await readdir(normalizedTarget)
  if (entries.length > 0) throw new Error('请选择空目录，或选择一个已有的 LS101 数据目录')
  return { path: normalizedTarget, kind: 'empty', sizeBytes: 0 }
}

async function finishPendingMigration(
  userDataDir: string,
  bootstrap: MigratingBootstrap
): Promise<string> {
  const source = await normalizeDirectory(bootstrap.source)
  const target = await normalizeDirectory(bootstrap.target)
  assertSeparateDirectories(source, target)
  await assertManagedDirectory(source)
  if (bootstrap.mode === 'copy') {
    await withMigrationWindow('正在迁移数据', `正在将软件数据复制到 ${target}`, () =>
      copyManagedDirectory(source, target)
    )
  } else await assertManagedDirectory(target)
  await writeReadyBootstrap(userDataDir, target)
  return target
}

async function scheduleMigration(
  userDataDir: string,
  source: string,
  target: string,
  mode: MigratingBootstrap['mode']
): Promise<void> {
  await writeBootstrap(userDataDir, {
    formatVersion: FORMAT_VERSION,
    state: 'migrating',
    activeDataDirectory: source,
    source,
    target,
    mode
  })
}

async function copyManagedDirectory(source: string, target: string): Promise<void> {
  if (await pathExists(target)) {
    const entries = await readdir(target)
    if (entries.length > 0) throw new Error('迁移目标在重启前已不再是空目录')
  }
  const staging = path.join(
    path.dirname(target),
    `.${path.basename(target)}.migrating-${randomUUID()}`
  )
  await mkdir(staging, { recursive: false })
  try {
    const sourceManifest = await copyTree(source, staging)
    const targetManifest = await buildManifest(staging)
    assertMatchingManifests(sourceManifest, targetManifest)
    await assertMarker(staging)
    await rm(target, { recursive: true, force: true })
    await rename(staging, target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function migrateLegacyData(
  userDataDir: string,
  target: string,
  directories: readonly string[]
): Promise<void> {
  if (await pathExists(target)) {
    const entries = await readdir(target)
    if (entries.length > 0) throw new Error(`默认数据目录不是空目录：${target}`)
  }
  const staging = path.join(userDataDir, `.data.migrating-${randomUUID()}`)
  await mkdir(staging)
  try {
    await withMigrationWindow('正在整理数据', '正在准备新的软件数据目录', async () => {
      for (const directory of directories) {
        const sourceManifest = await copyTree(
          path.join(userDataDir, directory),
          path.join(staging, directory)
        )
        const targetManifest = await buildManifest(path.join(staging, directory))
        assertMatchingManifests(sourceManifest, targetManifest)
      }
      await writeMarker(staging)
      await rm(target, { recursive: true, force: true })
      await rename(staging, target)
    })
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function copyTree(source: string, target: string): Promise<FileManifestEntry[]> {
  const sourceStats = await lstat(source)
  if (sourceStats.isSymbolicLink()) throw new Error(`数据目录中不支持符号链接：${source}`)
  if (!sourceStats.isDirectory()) throw new Error(`数据目录内容不是文件夹：${source}`)
  await mkdir(target, { recursive: true })
  const manifest: FileManifestEntry[] = []
  await copyDirectoryContents(source, target, '', manifest)
  return manifest.sort(compareManifestEntries)
}

async function copyDirectoryContents(
  source: string,
  target: string,
  relativeRoot: string,
  manifest: FileManifestEntry[]
): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    const relativePath = path.join(relativeRoot, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`数据目录中不支持符号链接：${sourcePath}`)
    if (entry.isDirectory()) {
      await mkdir(targetPath)
      await copyDirectoryContents(sourcePath, targetPath, relativePath, manifest)
      continue
    }
    if (!entry.isFile()) throw new Error(`数据目录中包含不支持的文件类型：${sourcePath}`)
    await copyFile(sourcePath, targetPath)
    const fileStats = await stat(sourcePath)
    manifest.push({ relativePath, size: fileStats.size })
  }
}

async function buildManifest(root: string): Promise<FileManifestEntry[]> {
  const manifest: FileManifestEntry[] = []
  await collectManifest(root, '', manifest)
  return manifest.sort(compareManifestEntries)
}

async function collectManifest(
  root: string,
  relativeRoot: string,
  manifest: FileManifestEntry[]
): Promise<void> {
  for (const entry of await readdir(path.join(root, relativeRoot), { withFileTypes: true })) {
    const relativePath = path.join(relativeRoot, entry.name)
    if (entry.isDirectory()) await collectManifest(root, relativePath, manifest)
    else if (entry.isFile()) {
      manifest.push({ relativePath, size: (await stat(path.join(root, relativePath))).size })
    } else throw new Error(`迁移目标中包含不支持的文件类型：${relativePath}`)
  }
}

function assertMatchingManifests(
  source: readonly FileManifestEntry[],
  target: readonly FileManifestEntry[]
): void {
  if (source.length !== target.length) throw new Error('迁移校验失败：文件数量不一致')
  for (let index = 0; index < source.length; index += 1) {
    if (
      source[index].relativePath !== target[index].relativePath ||
      source[index].size !== target[index].size
    ) {
      throw new Error(`迁移校验失败：${source[index].relativePath}`)
    }
  }
}

async function existingLegacyDirectories(userDataDir: string): Promise<string[]> {
  const found: string[] = []
  for (const directory of LEGACY_DIRECTORIES) {
    const stats = await stat(path.join(userDataDir, directory)).catch(() => null)
    if (stats?.isDirectory()) found.push(directory)
  }
  return found
}

async function createManagedDirectory(directory: string): Promise<void> {
  const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  if (entries.length > 0) throw new Error(`数据目录不是空目录：${directory}`)
  await mkdir(directory, { recursive: true })
  await writeMarker(directory)
}

async function readBootstrap(userDataDir: string): Promise<Bootstrap | null> {
  const filename = path.join(userDataDir, BOOTSTRAP_FILENAME)
  let value: unknown
  try {
    value = JSON.parse(await readFile(filename, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`无法读取数据目录配置：${errorMessage(error)}`)
  }
  if (!isRecord(value) || value.formatVersion !== FORMAT_VERSION) {
    throw new Error('数据目录配置格式无效或版本不受支持')
  }
  if (value.state === 'ready' && typeof value.activeDataDirectory === 'string') {
    return value as unknown as ReadyBootstrap
  }
  if (
    value.state === 'migrating' &&
    typeof value.activeDataDirectory === 'string' &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    (value.mode === 'copy' || value.mode === 'use-existing')
  ) {
    return value as unknown as MigratingBootstrap
  }
  throw new Error('数据目录配置内容无效')
}

async function writeReadyBootstrap(
  userDataDir: string,
  activeDataDirectory: string
): Promise<void> {
  await writeBootstrap(userDataDir, {
    formatVersion: FORMAT_VERSION,
    state: 'ready',
    activeDataDirectory
  })
}

async function writeBootstrap(userDataDir: string, value: Bootstrap): Promise<void> {
  await atomicWriteJson(path.join(userDataDir, BOOTSTRAP_FILENAME), value)
}

async function writeMarker(directory: string): Promise<void> {
  const marker: DataDirectoryMarker = {
    formatVersion: FORMAT_VERSION,
    kind: 'ls101-data-directory'
  }
  await atomicWriteJson(path.join(directory, MARKER_FILENAME), marker)
}

async function atomicWriteJson(filename: string, value: object): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, filename)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function assertManagedDirectory(directory: string): Promise<void> {
  if (!(await isManagedDirectory(directory)))
    throw new Error(`不是可识别的 LS101 数据目录：${directory}`)
}

async function assertMarker(directory: string): Promise<void> {
  const marker = JSON.parse(
    await readFile(path.join(directory, MARKER_FILENAME), 'utf8')
  ) as unknown
  if (
    !isRecord(marker) ||
    marker.formatVersion !== FORMAT_VERSION ||
    marker.kind !== 'ls101-data-directory'
  ) {
    throw new Error(`数据目录标记无效：${directory}`)
  }
}

async function isManagedDirectory(directory: string): Promise<boolean> {
  try {
    await assertMarker(directory)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    if (error instanceof SyntaxError) return false
    if (error instanceof Error && error.message.startsWith('数据目录标记无效')) return false
    throw error
  }
}

async function normalizeDirectory(directory: string): Promise<string> {
  const resolved = path.resolve(directory)
  const stats = await stat(resolved).catch(() => null)
  if (!stats?.isDirectory()) throw new Error(`目录不存在或无法访问：${resolved}`)
  return path.normalize(await realpath(resolved))
}

function assertSeparateDirectories(source: string, target: string): void {
  const relativeTarget = path.relative(source, target)
  const relativeSource = path.relative(target, source)
  if (
    samePath(source, target) ||
    (!relativeTarget.startsWith('..') && !path.isAbsolute(relativeTarget)) ||
    (!relativeSource.startsWith('..') && !path.isAbsolute(relativeSource))
  ) {
    throw new Error('新旧数据目录不能互相包含')
  }
}

async function directorySize(directory: string): Promise<number> {
  return (await buildManifest(directory)).reduce((total, entry) => total + entry.size, 0)
}

async function pathExists(filename: string): Promise<boolean> {
  return stat(filename)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    })
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right
}

function compareManifestEntries(left: FileManifestEntry, right: FileManifestEntry): number {
  return left.relativePath.localeCompare(right.relativePath)
}

function relaunchAfterReply(): void {
  setTimeout(() => {
    if (process.env['LS101_DISABLE_AUTO_RELAUNCH'] !== '1') app.relaunch()
    app.exit(0)
  }, 100)
}

async function withMigrationWindow<T>(
  title: string,
  detail: string,
  operation: () => Promise<T>
): Promise<T> {
  const progressWindow = new BrowserWindow({
    width: 460,
    height: 190,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    show: false,
    title,
    backgroundColor: '#f7f9f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  progressWindow.removeMenu()
  progressWindow.once('ready-to-show', () => progressWindow.show())
  const document = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: CanvasText; background: Canvas; }
  main { width: min(360px, calc(100vw - 48px)); }
  h1 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: 0; }
  p { margin: 8px 0 18px; overflow-wrap: anywhere; color: GrayText; font-size: 12px; line-height: 1.5; }
  .track { height: 4px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, CanvasText 12%, Canvas); }
  .bar { width: 38%; height: 100%; border-radius: inherit; background: #07897f; animation: move 1.15s ease-in-out infinite alternate; }
  @keyframes move { from { transform: translateX(-20%); } to { transform: translateX(185%); } }
  @media (prefers-reduced-motion: reduce) { .bar { width: 100%; animation: none; } }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><div class="track"><div class="bar"></div></div></main></body>
</html>`
  await progressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`)
  try {
    return await operation()
  } finally {
    if (!progressWindow.isDestroyed()) progressWindow.destroy()
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
