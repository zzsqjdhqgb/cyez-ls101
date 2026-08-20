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
  rmdir,
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
  pendingCleanups?: PendingCleanup[]
}

interface PendingCleanup {
  migrationId: string
  target: string
  staging: string
}

interface CopyingBootstrap {
  formatVersion: typeof FORMAT_VERSION
  state: 'migrating'
  migrationId: string
  source: string
  target: string
  staging: string
  mode: 'copy'
  pendingCleanups?: PendingCleanup[]
}

interface LegacyCopyingBootstrap {
  formatVersion: typeof FORMAT_VERSION
  state: 'migrating'
  migrationId: string
  source: string
  target: string
  staging: string
  mode: 'legacy-copy'
  legacyDirectories: string[]
  pendingCleanups?: PendingCleanup[]
}

interface UseExistingBootstrap {
  formatVersion: typeof FORMAT_VERSION
  state: 'migrating'
  migrationId: string
  source: string
  target: string
  mode: 'use-existing'
  pendingCleanups?: PendingCleanup[]
}

type MigratingBootstrap = CopyingBootstrap | LegacyCopyingBootstrap | UseExistingBootstrap
type Bootstrap = ReadyBootstrap | MigratingBootstrap

interface DataDirectoryMarker {
  formatVersion: typeof FORMAT_VERSION
  kind: 'ls101-data-directory'
  migrationId?: string
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
    const pendingCleanups = await retryPendingCleanups(bootstrap.pendingCleanups ?? [])
    if (pendingCleanups.length !== (bootstrap.pendingCleanups?.length ?? 0)) {
      await writeReadyBootstrap(userDataDir, activeDataDirectory, pendingCleanups)
    }
    return activeDataDirectory
  }

  const defaultPath = path.join(userDataDir, 'data')
  if (await isManagedDirectory(defaultPath)) {
    await writeReadyBootstrap(userDataDir, defaultPath)
    return defaultPath
  }

  const legacyDirectories = await existingLegacyDirectories(userDataDir)
  if (legacyDirectories.length > 0) {
    const migration = await scheduleMigration(
      userDataDir,
      userDataDir,
      defaultPath,
      'legacy-copy',
      legacyDirectories
    )
    return finishPendingMigration(userDataDir, migration)
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
    return inspectCandidate(userDataDir, result.filePaths[0], currentPath)
  })
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.migrate, async (_event, target: string) => {
    const candidate = await inspectCandidate(userDataDir, target, currentPath)
    if (candidate.kind !== 'empty') throw new Error('迁移目标必须是空目录')
    await scheduleMigration(userDataDir, currentPath, candidate.path, 'copy')
    relaunchAfterReply()
  })
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.useExisting, async (_event, target: string) => {
    const candidate = await inspectCandidate(userDataDir, target, currentPath)
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
        const pendingCleanups = await abandonPendingMigration(userDataDir, selected)
        await writeReadyBootstrap(userDataDir, selected, pendingCleanups)
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
  userDataDir: string,
  target: string,
  currentPath: string
): Promise<DataDirectoryCandidate> {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('数据目录路径无效')
  const normalizedTarget = await normalizeDirectory(target)
  const normalizedCurrent = await normalizeDirectory(currentPath)
  await assertNotPendingCleanupTarget(userDataDir, normalizedTarget)
  if (samePath(normalizedTarget, normalizedCurrent)) {
    return {
      path: normalizedTarget,
      kind: 'current',
      sizeBytes: await directorySize(normalizedTarget)
    }
  }
  await assertReplaceableMigrationTarget(normalizedTarget)
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
  const target = await normalizePotentialDirectory(bootstrap.target)
  if (bootstrap.mode === 'use-existing') {
    const existingTarget = await normalizeDirectory(target)
    await assertManagedDirectory(existingTarget)
    await writeReadyBootstrap(userDataDir, existingTarget, bootstrap.pendingCleanups)
    return existingTarget
  }

  assertMigrationPaths(bootstrap, target)
  if (await hasMigrationMarker(target, bootstrap.migrationId)) {
    await removeOwnedStaging(bootstrap)
    await writeReadyBootstrap(userDataDir, target, bootstrap.pendingCleanups)
    return target
  }

  const source = await normalizeDirectory(bootstrap.source)
  if (bootstrap.mode === 'copy') assertSeparateDirectories(source, target)
  else if (!samePath(source, await normalizeDirectory(userDataDir))) {
    throw new Error('旧数据迁移来源与 Electron 用户数据目录不一致')
  }
  if (bootstrap.mode === 'copy') await assertManagedDirectory(source)
  await assertReplaceableMigrationTarget(target)

  const title = bootstrap.mode === 'copy' ? '正在迁移数据' : '正在整理数据'
  const detail =
    bootstrap.mode === 'copy' ? `正在将软件数据复制到 ${target}` : '正在准备新的软件数据目录'
  await withMigrationWindow(title, detail, async () => {
    if (bootstrap.mode === 'copy') await prepareManagedStaging(bootstrap, source)
    else await prepareLegacyStaging(bootstrap)
    await commitCompletedStaging(bootstrap, target)
  })
  await removeOwnedStaging(bootstrap)
  await writeReadyBootstrap(userDataDir, target, bootstrap.pendingCleanups)
  return target
}

async function scheduleMigration(
  userDataDir: string,
  source: string,
  target: string,
  mode: MigratingBootstrap['mode'],
  legacyDirectories: readonly string[] = []
): Promise<MigratingBootstrap> {
  const migrationId = randomUUID()
  const currentBootstrap = await readBootstrap(userDataDir)
  const pendingCleanups = currentBootstrap?.pendingCleanups ?? []
  const base = {
    formatVersion: FORMAT_VERSION,
    state: 'migrating' as const,
    migrationId,
    source,
    target,
    ...(pendingCleanups.length > 0 ? { pendingCleanups } : {})
  }
  const migration: MigratingBootstrap =
    mode === 'use-existing'
      ? { ...base, mode }
      : mode === 'legacy-copy'
        ? {
            ...base,
            mode,
            staging: stagingPath(target, migrationId),
            legacyDirectories: [...legacyDirectories]
          }
        : { ...base, mode, staging: stagingPath(target, migrationId) }
  await writeBootstrap(userDataDir, migration)
  return migration
}

async function prepareManagedStaging(bootstrap: CopyingBootstrap, source: string): Promise<void> {
  if (await hasMigrationMarker(bootstrap.staging, bootstrap.migrationId)) return
  await recreateOwnedStaging(bootstrap)
  const sourceManifest = await copyTree(source, bootstrap.staging)
  const targetManifest = await buildManifest(bootstrap.staging)
  assertMatchingManifests(sourceManifest, targetManifest)
  await writeMarker(bootstrap.staging, bootstrap.migrationId)
}

async function prepareLegacyStaging(bootstrap: LegacyCopyingBootstrap): Promise<void> {
  if (await hasMigrationMarker(bootstrap.staging, bootstrap.migrationId)) return
  await recreateOwnedStaging(bootstrap)
  for (const directory of bootstrap.legacyDirectories) {
    const sourceManifest = await copyTree(
      path.join(bootstrap.source, directory),
      path.join(bootstrap.staging, directory)
    )
    const targetManifest = await buildManifest(path.join(bootstrap.staging, directory))
    assertMatchingManifests(sourceManifest, targetManifest)
  }
  await writeMarker(bootstrap.staging, bootstrap.migrationId)
}

async function recreateOwnedStaging(
  bootstrap: CopyingBootstrap | LegacyCopyingBootstrap
): Promise<void> {
  await removeOwnedStaging(bootstrap)
  await mkdir(bootstrap.staging, { recursive: false })
}

async function commitCompletedStaging(
  bootstrap: CopyingBootstrap | LegacyCopyingBootstrap,
  target: string
): Promise<void> {
  if (await hasMigrationMarker(target, bootstrap.migrationId)) return
  if (!(await hasMigrationMarker(bootstrap.staging, bootstrap.migrationId))) {
    throw new Error('迁移暂存目录尚未完成校验')
  }
  if (await pathExists(target)) {
    try {
      await rmdir(target)
    } catch (error) {
      if (isDirectoryNotEmpty(error)) {
        throw new Error('迁移目标在复制期间被写入，已停止迁移并保留目标内容')
      }
      throw error
    }
  }
  try {
    await rename(bootstrap.staging, target)
  } catch (error) {
    if (await hasMigrationMarker(target, bootstrap.migrationId)) return
    if (isTargetAlreadyExists(error)) {
      throw new Error('迁移目标在提交期间被其他程序占用，已停止迁移并保留目标内容')
    }
    throw error
  }
}

async function removeOwnedStaging(bootstrap: PendingCleanup): Promise<void> {
  assertStoredMigrationPaths(bootstrap)
  const stagingStats = await lstatIfExists(bootstrap.staging)
  if (!stagingStats) return
  await removeExistingOwnedStaging(bootstrap, stagingStats)
}

async function removeExistingOwnedStaging(
  bootstrap: PendingCleanup,
  stagingStats: Awaited<ReturnType<typeof lstat>>
): Promise<void> {
  if (!stagingStats.isDirectory() || stagingStats.isSymbolicLink()) {
    throw new Error('迁移暂存路径已被其他文件占用，未执行清理')
  }
  if (await isMountPoint(bootstrap.staging, path.dirname(bootstrap.staging))) {
    throw new Error('迁移暂存路径已成为挂载点，未执行清理')
  }
  await rm(bootstrap.staging, { recursive: true, force: true })
}

async function abandonPendingMigration(
  userDataDir: string,
  selected: string
): Promise<PendingCleanup[]> {
  const bootstrap = await readBootstrap(userDataDir).catch(() => null)
  if (bootstrap?.state !== 'migrating') return []
  const existing = bootstrap.pendingCleanups ?? []
  if (bootstrap.mode === 'use-existing') return existing
  const staging = path.normalize(path.resolve(bootstrap.staging))
  if (samePath(staging, selected) || isPathWithin(staging, selected)) {
    throw new Error('不能将迁移暂存目录作为数据目录')
  }
  const cleanup = pendingCleanupFromMigration(bootstrap)
  return (await tryRemovePendingCleanup(cleanup)) ? existing : [...existing, cleanup]
}

async function retryPendingCleanups(
  pendingCleanups: readonly PendingCleanup[]
): Promise<PendingCleanup[]> {
  const remaining: PendingCleanup[] = []
  for (const cleanup of pendingCleanups) {
    if (!(await tryRemovePendingCleanup(cleanup))) remaining.push(cleanup)
  }
  return remaining
}

async function tryRemovePendingCleanup(cleanup: PendingCleanup): Promise<boolean> {
  try {
    assertStoredMigrationPaths(cleanup)
    const stagingStats = await lstatIfExists(cleanup.staging)
    if (!stagingStats) return false
    await removeExistingOwnedStaging(cleanup, stagingStats)
    return true
  } catch (error) {
    console.warn(
      `Failed to clean pending data migration staging directory: ${cleanup.staging}`,
      error
    )
    return false
  }
}

async function assertNotPendingCleanupTarget(userDataDir: string, target: string): Promise<void> {
  const bootstrap = await readBootstrap(userDataDir)
  for (const cleanup of bootstrap?.pendingCleanups ?? []) {
    const staging = path.normalize(path.resolve(cleanup.staging))
    if (samePath(staging, target) || isPathWithin(staging, target)) {
      throw new Error('不能将待清理的迁移暂存目录作为数据目录')
    }
  }
}

function pendingCleanupFromMigration(
  bootstrap: CopyingBootstrap | LegacyCopyingBootstrap
): PendingCleanup {
  return {
    migrationId: bootstrap.migrationId,
    target: bootstrap.target,
    staging: bootstrap.staging
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
  const pendingCleanups = parsePendingCleanups(value.pendingCleanups)
  if (value.state === 'ready' && typeof value.activeDataDirectory === 'string') {
    return {
      formatVersion: FORMAT_VERSION,
      state: 'ready',
      activeDataDirectory: value.activeDataDirectory,
      ...(pendingCleanups.length > 0 ? { pendingCleanups } : {})
    }
  }
  if (
    value.state === 'migrating' &&
    typeof value.migrationId === 'string' &&
    isMigrationId(value.migrationId) &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    (value.mode === 'copy' || value.mode === 'use-existing' || value.mode === 'legacy-copy')
  ) {
    if (value.mode === 'use-existing') {
      return {
        formatVersion: FORMAT_VERSION,
        state: 'migrating',
        migrationId: value.migrationId,
        source: value.source,
        target: value.target,
        mode: value.mode,
        ...(pendingCleanups.length > 0 ? { pendingCleanups } : {})
      }
    }
    if (typeof value.staging !== 'string') throw new Error('数据目录迁移暂存路径无效')
    if (value.mode === 'copy') {
      const migration: CopyingBootstrap = {
        formatVersion: FORMAT_VERSION,
        state: 'migrating',
        migrationId: value.migrationId,
        source: value.source,
        target: value.target,
        staging: value.staging,
        mode: value.mode,
        ...(pendingCleanups.length > 0 ? { pendingCleanups } : {})
      }
      assertStoredMigrationPaths(migration)
      return migration
    }
    if (
      !Array.isArray(value.legacyDirectories) ||
      value.legacyDirectories.some(
        (directory) =>
          typeof directory !== 'string' ||
          !LEGACY_DIRECTORIES.includes(directory as (typeof LEGACY_DIRECTORIES)[number])
      )
    ) {
      throw new Error('旧数据迁移目录列表无效')
    }
    const migration: LegacyCopyingBootstrap = {
      formatVersion: FORMAT_VERSION,
      state: 'migrating',
      migrationId: value.migrationId,
      source: value.source,
      target: value.target,
      staging: value.staging,
      mode: value.mode,
      legacyDirectories: [...value.legacyDirectories] as string[],
      ...(pendingCleanups.length > 0 ? { pendingCleanups } : {})
    }
    assertStoredMigrationPaths(migration)
    return migration
  }
  throw new Error('数据目录配置内容无效')
}

function parsePendingCleanups(value: unknown): PendingCleanup[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('待清理迁移列表无效')
  const pendingCleanups = value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isMigrationId(entry.migrationId) ||
      typeof entry.target !== 'string' ||
      typeof entry.staging !== 'string'
    ) {
      throw new Error('待清理迁移记录无效')
    }
    const cleanup: PendingCleanup = {
      migrationId: entry.migrationId,
      target: entry.target,
      staging: entry.staging
    }
    assertStoredMigrationPaths(cleanup)
    return cleanup
  })
  const keys = new Set<string>()
  for (const cleanup of pendingCleanups) {
    const key = `${cleanup.migrationId}\0${path.normalize(cleanup.staging)}`
    if (keys.has(key)) throw new Error('待清理迁移记录重复')
    keys.add(key)
  }
  return pendingCleanups
}

async function writeReadyBootstrap(
  userDataDir: string,
  activeDataDirectory: string,
  pendingCleanups: readonly PendingCleanup[] = []
): Promise<void> {
  await writeBootstrap(userDataDir, {
    formatVersion: FORMAT_VERSION,
    state: 'ready',
    activeDataDirectory,
    ...(pendingCleanups.length > 0 ? { pendingCleanups: [...pendingCleanups] } : {})
  })
}

async function writeBootstrap(userDataDir: string, value: Bootstrap): Promise<void> {
  await atomicWriteJson(path.join(userDataDir, BOOTSTRAP_FILENAME), value)
}

async function writeMarker(directory: string, migrationId?: string): Promise<void> {
  const marker: DataDirectoryMarker = {
    formatVersion: FORMAT_VERSION,
    kind: 'ls101-data-directory',
    ...(migrationId ? { migrationId } : {})
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

async function readMarker(directory: string): Promise<DataDirectoryMarker> {
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
  if (marker.migrationId !== undefined && !isMigrationId(marker.migrationId)) {
    throw new Error(`数据目录迁移标记无效：${directory}`)
  }
  return marker as unknown as DataDirectoryMarker
}

async function assertMarker(directory: string): Promise<void> {
  await readMarker(directory)
}

async function hasMigrationMarker(directory: string, migrationId: string): Promise<boolean> {
  try {
    return (await readMarker(directory)).migrationId === migrationId
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    if (error instanceof SyntaxError) return false
    if (error instanceof Error && error.message.startsWith('数据目录')) return false
    throw error
  }
}

async function isManagedDirectory(directory: string): Promise<boolean> {
  try {
    await assertMarker(directory)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    if (error instanceof SyntaxError) return false
    if (error instanceof Error && error.message.startsWith('数据目录')) return false
    throw error
  }
}

async function normalizeDirectory(directory: string): Promise<string> {
  const resolved = path.resolve(directory)
  const stats = await statIfExists(resolved)
  if (!stats?.isDirectory()) throw new Error(`目录不存在或无法访问：${resolved}`)
  return path.normalize(await realpath(resolved))
}

async function normalizePotentialDirectory(directory: string): Promise<string> {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('数据目录路径无效')
  }
  const resolved = path.resolve(directory)
  const stats = await statIfExists(resolved)
  if (stats) {
    if (!stats.isDirectory()) throw new Error(`目标路径不是目录：${resolved}`)
    return path.normalize(await realpath(resolved))
  }
  const parent = await normalizeDirectory(path.dirname(resolved))
  return path.join(parent, path.basename(resolved))
}

function assertMigrationPaths(
  bootstrap: CopyingBootstrap | LegacyCopyingBootstrap,
  target: string
): void {
  const expected = stagingPath(target, bootstrap.migrationId)
  const configured = path.normalize(path.resolve(bootstrap.staging))
  if (!samePath(configured, expected)) throw new Error('数据目录迁移暂存路径与迁移事务不一致')
}

function assertStoredMigrationPaths(bootstrap: PendingCleanup): void {
  if (!path.isAbsolute(bootstrap.target) || !path.isAbsolute(bootstrap.staging)) {
    throw new Error('数据目录迁移路径无效')
  }
  assertMigrationPaths(bootstrap, path.normalize(path.resolve(bootstrap.target)))
}

function stagingPath(target: string, migrationId: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.migrating-${migrationId}`)
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

async function assertReplaceableMigrationTarget(directory: string): Promise<void> {
  const parent = path.dirname(directory)
  if (samePath(directory, parent) || (await isMountPoint(directory, parent))) {
    throw new Error('不能选择文件系统根目录或挂载点，请在其中新建一个空目录')
  }
}

async function isMountPoint(directory: string, parent: string): Promise<boolean> {
  const [directoryStats, parentStats] = await Promise.all([
    statIfExists(directory),
    statIfExists(parent)
  ])
  if (!directoryStats || !parentStats) return false
  if (directoryStats.dev !== parentStats.dev) return true
  if (process.platform !== 'linux') return false
  try {
    const mountInfo = await readFile('/proc/self/mountinfo', 'utf8')
    return mountInfo.split('\n').some((line) => {
      const fields = line.split(' ')
      return fields.length > 4 && samePath(decodeMountInfoPath(fields[4]), directory)
    })
  } catch {
    return false
  }
}

function decodeMountInfoPath(value: string): string {
  return path.normalize(
    value.replace(/\\([0-7]{3})/g, (_match, digits: string) =>
      String.fromCharCode(Number.parseInt(digits, 8))
    )
  )
}

function isPathWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
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

async function statIfExists(filename: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function lstatIfExists(filename: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function isDirectoryNotEmpty(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOTEMPTY' || code === 'EEXIST'
}

function isTargetAlreadyExists(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOTEMPTY' || code === 'EEXIST'
}

function isMigrationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
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
