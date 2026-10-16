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
import { LEGACY_MIGRATION_RESIDUE_DIRECTORIES } from './legacy-data'

// 数据位置配置保存在 Electron 用户目录；数据标记随业务目录移动。
const FORMAT_VERSION = 1
const BOOTSTRAP_FILENAME = 'data-location.json'
const MARKER_FILENAME = '.ls101-data.json'

/** 已就绪状态保留当前目录，以及尚未完成的暂存清理和旧目录删除记录。 */
interface ReadyBootstrap {
  formatVersion: typeof FORMAT_VERSION
  state: 'ready'
  activeDataDirectory: string
  pendingCleanups?: PendingCleanup[]
  oldDataDirectory?: OldDataDirectory
}

/** 暂存清理必须核对事务路径与文件系统身份，避免误删同名替代目录。 */
interface PendingCleanup {
  migrationId: string
  target: string
  staging: string
  parentPath: string
  parentIdentity: FileSystemIdentity
  stagingIdentity?: FileSystemIdentity
}

/** 使用设备号和 inode 识别目录本体，避免仅凭路径判断所有权。 */
interface FileSystemIdentity {
  device: string
  inode: string
}

/** 迁移后保留的旧目录；删除时记录改名位置与接管身份，以支持中断恢复。 */
interface OldDataDirectory {
  path: string
  directoryId: string
  parentPath: string
  parentIdentity: FileSystemIdentity
  deleting?: true
  deletionPath?: string
  deletionClaimed?: true
  deletionIdentity?: FileSystemIdentity
}

/** 复制迁移通过同级暂存目录完成校验，再切换到目标目录。 */
interface CopyingBootstrap {
  formatVersion: typeof FORMAT_VERSION
  state: 'migrating'
  migrationId: string
  source: string
  target: string
  staging: string
  parentPath: string
  parentIdentity: FileSystemIdentity
  stagingIdentity?: FileSystemIdentity
  mode: 'copy'
  retiredSource: OldDataDirectory
  pendingCleanups?: PendingCleanup[]
}

/** 旧版复制事务仅处理记录中的旧数据子目录。 */
interface LegacyCopyingBootstrap {
  formatVersion: typeof FORMAT_VERSION
  state: 'migrating'
  migrationId: string
  source: string
  target: string
  staging: string
  parentPath: string
  parentIdentity: FileSystemIdentity
  stagingIdentity?: FileSystemIdentity
  mode: 'legacy-copy'
  legacyDirectories: string[]
  pendingCleanups?: PendingCleanup[]
}

/** 切换到已有受管目录，无需复制，但仍记录原目录供用户后续删除。 */
interface UseExistingBootstrap {
  formatVersion: typeof FORMAT_VERSION
  state: 'migrating'
  migrationId: string
  source: string
  target: string
  mode: 'use-existing'
  retiredSource: OldDataDirectory
  pendingCleanups?: PendingCleanup[]
}

type MigratingBootstrap = CopyingBootstrap | LegacyCopyingBootstrap | UseExistingBootstrap
type Bootstrap = ReadyBootstrap | MigratingBootstrap

/** 目录标记用于识别受管目录，迁移标识还用于判断事务是否已提交。 */
interface DataDirectoryMarker {
  formatVersion: typeof FORMAT_VERSION
  kind: 'ls101-data-directory'
  directoryId?: string
  migrationId?: string
}

/** 迁移清单只比较相对路径与文件大小，不计算内容哈希。 */
interface FileManifestEntry {
  relativePath: string
  size: number
}

/** 启动时恢复未完成事务、重试清理，或创建默认业务目录。 */
export async function initializeDataDirectory(userDataDir: string): Promise<string> {
  const bootstrap = await readBootstrap(userDataDir)
  // 先完成迁移再提供目录，避免服务读写尚未提交的目标。
  if (bootstrap?.state === 'migrating') return finishPendingMigration(userDataDir, bootstrap)
  if (bootstrap) {
    const activeDataDirectory = await normalizeDirectory(bootstrap.activeDataDirectory)
    await assertManagedDirectory(activeDataDirectory)
    const pendingCleanups = await retryPendingCleanups(bootstrap.pendingCleanups ?? [])
    const oldDataDirectory = bootstrap.oldDataDirectory?.deleting
      ? await retryOldDataDirectoryDeletion(
          bootstrap.oldDataDirectory,
          activeDataDirectory,
          async (claimed) =>
            writeReadyBootstrap(userDataDir, activeDataDirectory, pendingCleanups, claimed)
        )
      : bootstrap.oldDataDirectory
    if (
      pendingCleanups.length !== (bootstrap.pendingCleanups?.length ?? 0) ||
      oldDataDirectory !== bootstrap.oldDataDirectory
    ) {
      await writeReadyBootstrap(userDataDir, activeDataDirectory, pendingCleanups, oldDataDirectory)
    }
    return activeDataDirectory
  }

  const defaultPath = path.join(userDataDir, 'data')
  if (await isManagedDirectory(defaultPath)) {
    await ensureDirectoryId(defaultPath)
    await writeReadyBootstrap(userDataDir, defaultPath)
    return defaultPath
  }

  // 旧版数据会在应用启动后归档并清理。
  // 此处只创建新的业务目录，不复制或删除用户目录根部的旧数据。
  await createManagedDirectory(defaultPath)
  await writeReadyBootstrap(userDataDir, defaultPath)
  return defaultPath
}

/** 由旧数据归档服务提供清理状态，协调目录切换的前置条件。 */
export interface DataDirectoryHandlerOptions {
  isLegacyCleanupPending?: () => boolean
}

/** 注册目录查询、选择、切换和旧目录删除接口；迁移计划在重启后执行。 */
export function registerDataDirectoryHandlers(
  userDataDir: string,
  currentPath: string,
  options: DataDirectoryHandlerOptions = {}
): void {
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.getInfo, async (): Promise<DataDirectoryInfo> => {
    const bootstrap = await readReadyBootstrap(userDataDir)
    const oldDataDirectory = bootstrap.oldDataDirectory
    return {
      currentPath,
      defaultPath: path.join(userDataDir, 'data'),
      sizeBytes: await directorySize(currentPath),
      legacyCleanupPending: options.isLegacyCleanupPending?.() ?? false,
      oldDataDirectory: oldDataDirectory
        ? {
            path: oldDataDirectory.path,
            sizeBytes: await directorySize(
              oldDataDirectory.deletionPath ?? oldDataDirectory.path
            ).catch(() => null),
            deleting: oldDataDirectory.deleting === true
          }
        : null
    }
  })
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.choose, async (event) => {
    assertNoPendingLegacyCleanup(options)
    await assertNoOldDataDirectory(userDataDir)
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
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.chooseDefault, async () => {
    assertNoPendingLegacyCleanup(options)
    await assertNoOldDataDirectory(userDataDir)
    return inspectCandidate(userDataDir, path.join(userDataDir, 'data'), currentPath, true)
  })
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.resetDefault, async () => {
    assertNoPendingLegacyCleanup(options)
    await assertNoOldDataDirectory(userDataDir)
    const candidate = await inspectCandidate(
      userDataDir,
      path.join(userDataDir, 'data'),
      currentPath,
      true
    )
    if (candidate.kind === 'current') throw new Error('当前已使用默认数据目录')
    await scheduleMigration(
      userDataDir,
      currentPath,
      candidate.path,
      candidate.kind === 'managed' ? 'use-existing' : 'copy'
    )
    relaunchAfterReply()
  })
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.migrate, async (_event, target: string) => {
    assertNoPendingLegacyCleanup(options)
    await assertNoOldDataDirectory(userDataDir)
    const candidate = await inspectCandidate(userDataDir, target, currentPath)
    if (candidate.kind !== 'empty') throw new Error('迁移目标必须是空目录')
    await scheduleMigration(userDataDir, currentPath, candidate.path, 'copy')
    relaunchAfterReply()
  })
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.useExisting, async (_event, target: string) => {
    assertNoPendingLegacyCleanup(options)
    await assertNoOldDataDirectory(userDataDir)
    const candidate = await inspectCandidate(userDataDir, target, currentPath)
    if (candidate.kind !== 'managed') throw new Error('所选目录不是可识别的 LS101 数据目录')
    await scheduleMigration(userDataDir, currentPath, candidate.path, 'use-existing')
    relaunchAfterReply()
  })
  // 先持久化删除意图，再尝试删除；中断或失败后可在后续启动时继续。
  ipcMain.handle(DATA_DIRECTORY_CHANNELS.deleteOld, async () => {
    const bootstrap = await readReadyBootstrap(userDataDir)
    if (!bootstrap.oldDataDirectory) throw new Error('没有可删除的旧数据目录')
    const deleting = markOldDataDirectoryDeleting(bootstrap.oldDataDirectory)
    if (!bootstrap.oldDataDirectory.deleting) {
      await validateOldDataDirectory(deleting, currentPath)
      await writeReadyBootstrap(userDataDir, currentPath, bootstrap.pendingCleanups, deleting)
    }
    const remaining = await retryOldDataDirectoryDeletion(deleting, currentPath, async (claimed) =>
      writeReadyBootstrap(userDataDir, currentPath, bootstrap.pendingCleanups, claimed)
    )
    await writeReadyBootstrap(userDataDir, currentPath, bootstrap.pendingCleanups, remaining)
    if (remaining) throw new Error('旧数据目录暂时不可访问，将在后续启动时继续删除')
  })
}

/** 旧版归档清理完成前不允许切换数据位置。 */
function assertNoPendingLegacyCleanup(options: DataDirectoryHandlerOptions): void {
  if (options.isLegacyCleanupPending?.()) {
    throw new Error('请先完成旧版数据归档清理，再更改数据位置')
  }
}

/** 无法初始化目录时循环提供重试、选择已有目录和退出选项。 */
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
        const abandonment = await abandonPendingMigration(userDataDir, selected)
        await writeReadyBootstrap(
          userDataDir,
          selected,
          abandonment.pendingCleanups,
          abandonment.oldDataDirectory
        )
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

/** 解析真实路径并排除危险位置，将候选分类为当前、受管或空目录。 */
async function inspectCandidate(
  userDataDir: string,
  target: string,
  currentPath: string,
  allowMissing = false
): Promise<DataDirectoryCandidate> {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('数据目录路径无效')
  const normalizedTarget = allowMissing
    ? await normalizePotentialDirectory(target)
    : await normalizeDirectory(target)
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
  if (!(await pathExists(normalizedTarget))) {
    return { path: normalizedTarget, kind: 'empty', sizeBytes: 0 }
  }
  const entries = await readdir(normalizedTarget)
  if (entries.length > 0) throw new Error('请选择空目录，或选择一个已有的 LS101 数据目录')
  return { path: normalizedTarget, kind: 'empty', sizeBytes: 0 }
}

/** 恢复已持久化的迁移计划；目标已有本事务标记时直接完成收尾。 */
async function finishPendingMigration(
  userDataDir: string,
  bootstrap: MigratingBootstrap
): Promise<string> {
  const target = await normalizePotentialDirectory(bootstrap.target)
  if (bootstrap.mode === 'use-existing') {
    const existingTarget = await normalizeDirectory(target)
    await assertManagedDirectory(existingTarget)
    await writeReadyBootstrap(
      userDataDir,
      existingTarget,
      bootstrap.pendingCleanups,
      bootstrap.retiredSource
    )
    return existingTarget
  }

  assertMigrationPaths(bootstrap, target)
  // 目标已带有完成标记，说明上次可能在改名提交后、更新配置前中断。
  if (await hasMigrationMarker(target, bootstrap.migrationId)) {
    await removeOwnedStaging(bootstrap)
    await writeReadyBootstrap(
      userDataDir,
      target,
      bootstrap.pendingCleanups,
      bootstrap.mode === 'copy' ? bootstrap.retiredSource : undefined
    )
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
    if (bootstrap.mode === 'copy') await prepareManagedStaging(userDataDir, bootstrap, source)
    else await prepareLegacyStaging(userDataDir, bootstrap)
    await commitCompletedStaging(bootstrap, target)
  })
  await removeOwnedStaging(bootstrap)
  await writeReadyBootstrap(
    userDataDir,
    target,
    bootstrap.pendingCleanups,
    bootstrap.mode === 'copy' ? bootstrap.retiredSource : undefined
  )
  return target
}

/** 只持久化迁移意图与目录身份，实际复制留待重启后执行。 */
async function scheduleMigration(
  userDataDir: string,
  source: string,
  target: string,
  mode: MigratingBootstrap['mode'],
  legacyDirectories: readonly string[] = []
): Promise<MigratingBootstrap> {
  const migrationId = randomUUID()
  const currentBootstrap = await readBootstrap(userDataDir)
  if (currentBootstrap?.state === 'ready' && currentBootstrap.oldDataDirectory) {
    throw new Error('请先删除旧数据目录，再更改数据位置')
  }
  const pendingCleanups = currentBootstrap?.pendingCleanups ?? []
  const base = {
    formatVersion: FORMAT_VERSION as typeof FORMAT_VERSION,
    state: 'migrating' as const,
    migrationId,
    source,
    target,
    ...(pendingCleanups.length > 0 ? { pendingCleanups } : {})
  }
  const migration: MigratingBootstrap =
    mode === 'use-existing'
      ? { ...base, mode, retiredSource: await captureOldDataDirectory(source) }
      : mode === 'legacy-copy'
        ? {
            ...base,
            mode,
            staging: stagingPath(target, migrationId),
            ...(await captureStagingParent(target)),
            legacyDirectories: [...legacyDirectories]
          }
        : {
            ...base,
            mode,
            staging: stagingPath(target, migrationId),
            ...(await captureStagingParent(target)),
            retiredSource: await captureOldDataDirectory(source)
          }
  await writeBootstrap(userDataDir, migration)
  return migration
}

/** 复制受管目录并核对文件清单，校验通过后才写入本次迁移标记。 */
async function prepareManagedStaging(
  userDataDir: string,
  bootstrap: CopyingBootstrap,
  source: string
): Promise<void> {
  if (await hasMigrationMarker(bootstrap.staging, bootstrap.migrationId)) return
  await recreateOwnedStaging(userDataDir, bootstrap)
  const sourceManifest = await copyTree(source, bootstrap.staging)
  const targetManifest = await buildManifest(bootstrap.staging)
  assertMatchingManifests(sourceManifest, targetManifest)
  await writeMarker(bootstrap.staging, bootstrap.migrationId)
}

/** 按旧版事务白名单逐个复制子目录并校验，再标记暂存目录完成。 */
async function prepareLegacyStaging(
  userDataDir: string,
  bootstrap: LegacyCopyingBootstrap
): Promise<void> {
  if (await hasMigrationMarker(bootstrap.staging, bootstrap.migrationId)) return
  await recreateOwnedStaging(userDataDir, bootstrap)
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

/** 清理本事务拥有的暂存目录，并在新建后立即持久化其身份。 */
async function recreateOwnedStaging(
  userDataDir: string,
  bootstrap: CopyingBootstrap | LegacyCopyingBootstrap
): Promise<void> {
  await removeOwnedStaging(bootstrap)
  await mkdir(bootstrap.staging, { recursive: false })
  bootstrap.stagingIdentity = fileSystemIdentity(await lstat(bootstrap.staging))
  await writeBootstrap(userDataDir, bootstrap)
}

/** 校验暂存标记后通过同级改名提交，目标被其他程序写入时保留其内容。 */
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

/** 清理前先核对记录路径和父目录身份，拒绝处理已被替换的位置。 */
async function removeOwnedStaging(bootstrap: PendingCleanup): Promise<void> {
  assertStoredMigrationPaths(bootstrap)
  if (!(await hasExpectedCleanupParentIdentity(bootstrap))) {
    throw new Error('迁移暂存目录所在位置不可访问或身份已变化')
  }
  const stagingStats = await lstatIfExists(bootstrap.staging)
  if (!stagingStats) return
  await removeExistingOwnedStaging(bootstrap, stagingStats)
}

/** 拒绝链接、挂载点及身份不匹配的路径；所有权不明时只尝试删除空目录。 */
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
  if (bootstrap.stagingIdentity) {
    if (!sameFileSystemIdentity(fileSystemIdentity(stagingStats), bootstrap.stagingIdentity)) {
      throw new Error('迁移暂存路径身份不匹配，未执行清理')
    }
  } else if (!(await hasMigrationMarker(bootstrap.staging, bootstrap.migrationId))) {
    try {
      await rmdir(bootstrap.staging)
      return
    } catch (error) {
      if (isDirectoryNotEmpty(error)) {
        throw new Error('迁移暂存路径所有权无法确认，未执行清理')
      }
      throw error
    }
  }
  await rm(bootstrap.staging, { recursive: true, force: true })
}

/** 恢复时改选目录需协调旧来源记录，并保留暂时无法清理的事务暂存目录。 */
async function abandonPendingMigration(
  userDataDir: string,
  selected: string
): Promise<{
  pendingCleanups: PendingCleanup[]
  oldDataDirectory?: OldDataDirectory
}> {
  const bootstrap = await readBootstrap(userDataDir)
  if (!bootstrap) return { pendingCleanups: [] }
  if (bootstrap.state === 'ready') {
    const pendingCleanups = bootstrap.pendingCleanups ?? []
    assertSelectionSeparateFromPendingCleanups(selected, pendingCleanups)
    if (!bootstrap.oldDataDirectory) return { pendingCleanups }
    const oldDataDirectory = await coordinateRetiredSource(selected, bootstrap.oldDataDirectory)
    return { pendingCleanups, ...(oldDataDirectory ? { oldDataDirectory } : {}) }
  }
  const existing = bootstrap.pendingCleanups ?? []
  assertSelectionSeparateFromPendingCleanups(selected, existing)
  if (bootstrap.mode === 'use-existing') {
    const oldDataDirectory = await coordinateRetiredSource(selected, bootstrap.retiredSource)
    return {
      pendingCleanups: existing,
      ...(oldDataDirectory ? { oldDataDirectory } : {})
    }
  }
  if (bootstrap.mode === 'legacy-copy') return { pendingCleanups: existing }
  assertSelectionSeparateFromPendingCleanups(selected, [pendingCleanupFromMigration(bootstrap)])
  const oldDataDirectory = await coordinateRetiredSource(selected, bootstrap.retiredSource)
  const cleanup = pendingCleanupFromMigration(bootstrap)
  const pendingCleanups = (await tryRemovePendingCleanup(cleanup))
    ? existing
    : [...existing, cleanup]
  return {
    pendingCleanups,
    ...(oldDataDirectory ? { oldDataDirectory } : {})
  }
}

/** 重新选择原目录时撤销其退休记录，否则确保新目录与待删位置互不包含。 */
async function coordinateRetiredSource(
  selected: string,
  retiredSource: OldDataDirectory
): Promise<OldDataDirectory | undefined> {
  if (samePath(selected, retiredSource.path)) {
    await assertSelectedOldDataDirectory(selected, retiredSource)
    return undefined
  }
  assertSeparateDirectories(selected, retiredSource.path)
  if (retiredSource.deletionPath) {
    assertSeparateDirectories(selected, retiredSource.deletionPath)
  }
  return retiredSource
}

/** 恢复旧目录前核对删除状态、父目录身份和目录标记。 */
async function assertSelectedOldDataDirectory(
  selected: string,
  oldDataDirectory: OldDataDirectory
): Promise<void> {
  if (oldDataDirectory.deleting) {
    throw new Error('旧数据目录正在删除，不能选择该目录')
  }
  assertOldDataDirectoryRecord(oldDataDirectory)
  const normalizedSelected = await normalizeDirectory(selected)
  const normalizedOld = path.normalize(path.resolve(oldDataDirectory.path))
  if (!samePath(normalizedSelected, normalizedOld)) {
    throw new Error('所选目录不是记录中的旧数据目录')
  }
  if (!(await hasExpectedParentIdentity(oldDataDirectory))) {
    throw new Error('旧数据目录所在位置不可访问或身份已变化')
  }
  const oldStats = await lstatIfExists(normalizedOld)
  if (!oldStats || !oldStats.isDirectory() || oldStats.isSymbolicLink()) {
    throw new Error('旧数据目录路径已被其他文件占用')
  }
  const marker = await readMarker(normalizedOld)
  if (marker.directoryId !== oldDataDirectory.directoryId) {
    throw new Error('旧数据目录标识不匹配，未执行选择')
  }
}

/** 按顺序重试遗留暂存清理，只把尚未成功的记录保留下来。 */
async function retryPendingCleanups(
  pendingCleanups: readonly PendingCleanup[]
): Promise<PendingCleanup[]> {
  const remaining: PendingCleanup[] = []
  for (const cleanup of pendingCleanups) {
    if (!(await tryRemovePendingCleanup(cleanup))) remaining.push(cleanup)
  }
  return remaining
}

/** 清理失败只记录警告并保留任务，避免阻止正常数据目录启动。 */
async function tryRemovePendingCleanup(cleanup: PendingCleanup): Promise<boolean> {
  try {
    assertStoredMigrationPaths(cleanup)
    if (!(await hasExpectedCleanupParentIdentity(cleanup))) return false
    const stagingStats = await lstatIfExists(cleanup.staging)
    if (!stagingStats) return true
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

/** 禁止将待清理目录及其父子目录选为当前目录，避免后续清理波及业务数据。 */
function assertSelectionSeparateFromPendingCleanups(
  selected: string,
  pendingCleanups: readonly PendingCleanup[]
): void {
  for (const cleanup of pendingCleanups) {
    const staging = path.normalize(path.resolve(cleanup.staging))
    if (
      samePath(staging, selected) ||
      isPathWithin(staging, selected) ||
      isPathWithin(selected, staging)
    ) {
      throw new Error('不能将迁移暂存目录或其父子目录作为数据目录')
    }
  }
}

async function assertNotPendingCleanupTarget(userDataDir: string, target: string): Promise<void> {
  const bootstrap = await readBootstrap(userDataDir)
  assertSelectionSeparateFromPendingCleanups(target, bootstrap?.pendingCleanups ?? [])
}

/** 只有配置已处于就绪状态，设置页才可执行目录管理操作。 */
async function readReadyBootstrap(userDataDir: string): Promise<ReadyBootstrap> {
  const bootstrap = await readBootstrap(userDataDir)
  if (bootstrap?.state !== 'ready') throw new Error('数据目录尚未准备完成')
  return bootstrap
}

/** 上次迁移的旧目录未处理前，禁止继续迁移以免积累多个待删来源。 */
async function assertNoOldDataDirectory(userDataDir: string): Promise<void> {
  if ((await readReadyBootstrap(userDataDir)).oldDataDirectory) {
    throw new Error('请先删除旧数据目录，再更改数据位置')
  }
}

/** 切换前记录原目录标记和父目录身份，作为后续删除校验依据。 */
async function captureOldDataDirectory(directory: string): Promise<OldDataDirectory> {
  const normalized = await normalizeDirectory(directory)
  const marker = await ensureDirectoryId(normalized)
  const parentPath = await normalizeDirectory(path.dirname(normalized))
  return {
    path: normalized,
    directoryId: marker.directoryId,
    parentPath,
    parentIdentity: fileSystemIdentity(await stat(parentPath))
  }
}

/** 记录暂存父目录身份，以识别卸载后重新挂载或路径被替换的情况。 */
async function captureStagingParent(
  target: string
): Promise<Pick<PendingCleanup, 'parentPath' | 'parentIdentity'>> {
  const parentPath = await normalizeDirectory(path.dirname(target))
  return {
    parentPath,
    parentIdentity: fileSystemIdentity(await stat(parentPath))
  }
}

/** 为缺少目录标识的受管目录补写稳定标识，同时保留已有迁移标记。 */
async function ensureDirectoryId(
  directory: string
): Promise<DataDirectoryMarker & { directoryId: string }> {
  const marker = await readMarker(directory)
  if (marker.directoryId) return marker as DataDirectoryMarker & { directoryId: string }
  const directoryId = randomUUID()
  await writeMarker(directory, marker.migrationId, directoryId)
  return { ...marker, directoryId }
}

/** 删除前确保旧目录与当前目录分离，且路径类型和目录标记仍与记录一致。 */
async function validateOldDataDirectory(
  oldDataDirectory: OldDataDirectory,
  currentPath: string
): Promise<void> {
  assertOldDataDirectoryRecord(oldDataDirectory)
  const normalizedCurrent = await normalizeDirectory(currentPath)
  const oldPath = path.normalize(path.resolve(oldDataDirectory.path))
  assertSeparateDirectories(normalizedCurrent, oldPath)
  const oldStats = await lstatIfExists(oldPath)
  if (!oldStats) {
    if (!(await hasExpectedParentIdentity(oldDataDirectory))) {
      throw new Error('旧数据目录所在位置不可访问')
    }
    return
  }
  if (!oldStats.isDirectory() || oldStats.isSymbolicLink()) {
    throw new Error('旧数据目录路径已被其他文件占用')
  }
  if (!samePath(await normalizeDirectory(oldPath), oldPath)) {
    throw new Error('旧数据目录路径已发生变化')
  }
  const marker = await readMarker(oldPath)
  if (marker.directoryId !== oldDataDirectory.directoryId) {
    throw new Error('旧数据目录标识不匹配，未执行删除')
  }
}

/** 生成确定的同级删除路径，使删除操作可以在重启后继续。 */
function markOldDataDirectoryDeleting(oldDataDirectory: OldDataDirectory): OldDataDirectory {
  return {
    ...oldDataDirectory,
    deleting: true,
    deletionPath: path.join(
      oldDataDirectory.parentPath,
      `.${path.basename(oldDataDirectory.path)}.deleting-${oldDataDirectory.directoryId}`
    )
  }
}

/** 先改名并持久化接管身份，再递归删除；中途失败则保留恢复记录。 */
async function retryOldDataDirectoryDeletion(
  initialOldDataDirectory: OldDataDirectory,
  currentPath: string,
  persistClaim: (oldDataDirectory: OldDataDirectory) => Promise<void>
): Promise<OldDataDirectory | undefined> {
  let oldDataDirectory = initialOldDataDirectory
  try {
    if (!oldDataDirectory.deleting || !oldDataDirectory.deletionPath) {
      throw new Error('旧数据目录删除状态无效')
    }
    assertSeparateDirectories(
      await normalizeDirectory(currentPath),
      path.normalize(path.resolve(oldDataDirectory.deletionPath))
    )
    const deletionStats = await lstatIfExists(oldDataDirectory.deletionPath)
    if (deletionStats) {
      if (!deletionStats.isDirectory() || deletionStats.isSymbolicLink()) {
        throw new Error('旧数据删除路径已被其他文件占用')
      }
      if (!(await hasExpectedParentIdentity(oldDataDirectory))) return oldDataDirectory
      // 可能上次已完成改名但尚未记录接管，需先确认标记与原路径状态。
      if (!oldDataDirectory.deletionClaimed) {
        if (await pathExists(oldDataDirectory.path)) {
          throw new Error('旧数据删除路径已被占用，原目录仍然存在')
        }
        const marker = await readMarker(oldDataDirectory.deletionPath)
        if (marker.directoryId !== oldDataDirectory.directoryId) {
          throw new Error('旧数据删除路径标识不匹配')
        }
        oldDataDirectory = {
          ...oldDataDirectory,
          deletionClaimed: true,
          deletionIdentity: fileSystemIdentity(deletionStats)
        }
        await persistClaim(oldDataDirectory)
      } else if (
        // 递归删除可能已删掉标记文件，接管后通过文件系统身份继续核对。
        !oldDataDirectory.deletionIdentity ||
        !sameFileSystemIdentity(
          fileSystemIdentity(deletionStats),
          oldDataDirectory.deletionIdentity
        )
      ) {
        throw new Error('旧数据删除路径身份不匹配')
      }
    } else {
      await validateOldDataDirectory(oldDataDirectory, currentPath)
      if (!(await pathExists(oldDataDirectory.path))) return undefined
      await rename(oldDataDirectory.path, oldDataDirectory.deletionPath)
      const claimedStats = await lstat(oldDataDirectory.deletionPath)
      oldDataDirectory = {
        ...oldDataDirectory,
        deletionClaimed: true,
        deletionIdentity: fileSystemIdentity(claimedStats)
      }
      await persistClaim(oldDataDirectory)
    }
    const deletionPath = oldDataDirectory.deletionPath
    if (!deletionPath) throw new Error('旧数据删除路径缺失')
    await rm(deletionPath, { recursive: true, force: true })
    if (await pathExists(deletionPath)) return oldDataDirectory
    return undefined
  } catch (error) {
    console.warn(`Failed to delete old data directory: ${oldDataDirectory.path}`, error)
    return oldDataDirectory
  }
}

async function hasExpectedParentIdentity(oldDataDirectory: OldDataDirectory): Promise<boolean> {
  const parentStats = await statIfExists(oldDataDirectory.parentPath)
  return parentStats
    ? sameFileSystemIdentity(fileSystemIdentity(parentStats), oldDataDirectory.parentIdentity)
    : false
}

async function hasExpectedCleanupParentIdentity(cleanup: PendingCleanup): Promise<boolean> {
  const parentStats = await statIfExists(cleanup.parentPath)
  return parentStats
    ? sameFileSystemIdentity(fileSystemIdentity(parentStats), cleanup.parentIdentity)
    : false
}

/** 转为字符串后可安全写入 JSON，并与后续读取到的身份进行比较。 */
function fileSystemIdentity(stats: Awaited<ReturnType<typeof stat>>): FileSystemIdentity {
  return { device: String(stats.dev), inode: String(stats.ino) }
}

function sameFileSystemIdentity(left: FileSystemIdentity, right: FileSystemIdentity): boolean {
  return left.device === right.device && left.inode === right.inode
}

/** 从复制事务提取重试清理所需的最小所有权记录。 */
function pendingCleanupFromMigration(
  bootstrap: CopyingBootstrap | LegacyCopyingBootstrap
): PendingCleanup {
  return {
    migrationId: bootstrap.migrationId,
    target: bootstrap.target,
    staging: bootstrap.staging,
    parentPath: bootstrap.parentPath,
    parentIdentity: bootstrap.parentIdentity,
    ...(bootstrap.stagingIdentity ? { stagingIdentity: bootstrap.stagingIdentity } : {})
  }
}

/** 递归复制普通文件和目录，拒绝符号链接，并生成按路径排序的源清单。 */
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

/** 遍历目标目录生成同序清单，也用于计算目录内普通文件的总大小。 */
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

/** 检查文件数量、相对路径和大小，防止未完整复制的暂存目录被提交。 */
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

/** 仅在目录不存在或为空时创建受管标记，避免接管无关数据。 */
async function createManagedDirectory(directory: string): Promise<void> {
  const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  if (entries.length > 0) throw new Error(`数据目录不是空目录：${directory}`)
  await mkdir(directory, { recursive: true })
  await writeMarker(directory)
}

/** 将磁盘 JSON 作为未知输入逐项校验，再恢复为对应状态的事务记录。 */
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
    const oldDataDirectory = parseOldDataDirectory(value.oldDataDirectory)
    return {
      formatVersion: FORMAT_VERSION,
      state: 'ready',
      activeDataDirectory: value.activeDataDirectory,
      ...(pendingCleanups.length > 0 ? { pendingCleanups } : {}),
      ...(oldDataDirectory ? { oldDataDirectory } : {})
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
      const retiredSource = parseOldDataDirectory(value.retiredSource, false)
      if (!retiredSource) throw new Error('迁移来源目录记录缺失')
      return {
        formatVersion: FORMAT_VERSION,
        state: 'migrating',
        migrationId: value.migrationId,
        source: value.source,
        target: value.target,
        mode: value.mode,
        retiredSource,
        ...(pendingCleanups.length > 0 ? { pendingCleanups } : {})
      }
    }
    if (typeof value.staging !== 'string') throw new Error('数据目录迁移暂存路径无效')
    if (value.mode === 'copy') {
      const retiredSource = parseOldDataDirectory(value.retiredSource, false)
      if (!retiredSource) throw new Error('迁移来源目录记录缺失')
      const stagingLocation = parseStagingLocation(value)
      const migration: CopyingBootstrap = {
        formatVersion: FORMAT_VERSION,
        state: 'migrating',
        migrationId: value.migrationId,
        source: value.source,
        target: value.target,
        staging: value.staging,
        ...stagingLocation,
        mode: value.mode,
        retiredSource,
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
          !LEGACY_MIGRATION_RESIDUE_DIRECTORIES.includes(
            directory as (typeof LEGACY_MIGRATION_RESIDUE_DIRECTORIES)[number]
          )
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
      ...parseStagingLocation(value),
      mode: value.mode,
      legacyDirectories: [...value.legacyDirectories] as string[],
      ...(pendingCleanups.length > 0 ? { pendingCleanups } : {})
    }
    assertStoredMigrationPaths(migration)
    return migration
  }
  throw new Error('数据目录配置内容无效')
}

/** 校验待清理记录的路径和身份，并拒绝重复的迁移暂存任务。 */
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
      staging: entry.staging,
      ...parseStagingLocation(entry)
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

/** 校验清理所依赖的父目录身份，以及可选的暂存目录身份。 */
function parseStagingLocation(
  value: Record<string, unknown>
): Pick<PendingCleanup, 'parentPath' | 'parentIdentity' | 'stagingIdentity'> {
  if (typeof value.parentPath !== 'string') throw new Error('迁移暂存父目录记录无效')
  const parentIdentity = parseFileSystemIdentity(value.parentIdentity, '迁移暂存父目录身份无效')
  const stagingIdentity =
    value.stagingIdentity === undefined
      ? undefined
      : parseFileSystemIdentity(value.stagingIdentity, '迁移暂存目录身份无效')
  return {
    parentPath: value.parentPath,
    parentIdentity,
    ...(stagingIdentity ? { stagingIdentity } : {})
  }
}

function parseFileSystemIdentity(value: unknown, message: string): FileSystemIdentity {
  if (!isRecord(value) || typeof value.device !== 'string' || typeof value.inode !== 'string') {
    throw new Error(message)
  }
  return { device: value.device, inode: value.inode }
}

/** 解析旧目录记录；迁移来源不允许处于删除中状态。 */
function parseOldDataDirectory(
  value: unknown,
  allowDeleting: boolean = true
): OldDataDirectory | undefined {
  if (value === undefined) return undefined
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    !isMigrationId(value.directoryId) ||
    typeof value.parentPath !== 'string' ||
    !isRecord(value.parentIdentity) ||
    typeof value.parentIdentity.device !== 'string' ||
    typeof value.parentIdentity.inode !== 'string' ||
    (value.deleting !== undefined && value.deleting !== true) ||
    (value.deletionPath !== undefined && typeof value.deletionPath !== 'string') ||
    (value.deletionClaimed !== undefined && value.deletionClaimed !== true) ||
    (value.deletionIdentity !== undefined &&
      (!isRecord(value.deletionIdentity) ||
        typeof value.deletionIdentity.device !== 'string' ||
        typeof value.deletionIdentity.inode !== 'string'))
  ) {
    throw new Error('旧数据目录记录无效')
  }
  if (!allowDeleting && value.deleting === true) throw new Error('迁移来源目录状态无效')
  const oldDataDirectory: OldDataDirectory = {
    path: value.path,
    directoryId: value.directoryId,
    parentPath: value.parentPath,
    parentIdentity: {
      device: value.parentIdentity.device,
      inode: value.parentIdentity.inode
    },
    ...(value.deleting === true ? { deleting: true as const } : {}),
    ...(typeof value.deletionPath === 'string' ? { deletionPath: value.deletionPath } : {}),
    ...(value.deletionClaimed === true ? { deletionClaimed: true as const } : {}),
    ...(isRecord(value.deletionIdentity)
      ? {
          deletionIdentity: {
            device: value.deletionIdentity.device as string,
            inode: value.deletionIdentity.inode as string
          }
        }
      : {})
  }
  assertOldDataDirectoryRecord(oldDataDirectory)
  return oldDataDirectory
}

/** 验证旧目录与删除路径的对应关系，以及删除接管字段的完整性。 */
function assertOldDataDirectoryRecord(oldDataDirectory: OldDataDirectory): void {
  if (!path.isAbsolute(oldDataDirectory.path) || !path.isAbsolute(oldDataDirectory.parentPath)) {
    throw new Error('旧数据目录路径无效')
  }
  const oldPath = path.normalize(path.resolve(oldDataDirectory.path))
  const parentPath = path.normalize(path.resolve(oldDataDirectory.parentPath))
  if (!samePath(path.dirname(oldPath), parentPath)) throw new Error('旧数据目录父路径无效')
  const expectedDeletionPath = path.join(
    parentPath,
    `.${path.basename(oldPath)}.deleting-${oldDataDirectory.directoryId}`
  )
  if (
    oldDataDirectory.deleting === true &&
    (!oldDataDirectory.deletionPath ||
      !samePath(path.normalize(path.resolve(oldDataDirectory.deletionPath)), expectedDeletionPath))
  ) {
    throw new Error('旧数据目录删除路径无效')
  }
  if (oldDataDirectory.deleting !== true && oldDataDirectory.deletionPath) {
    throw new Error('旧数据目录删除状态无效')
  }
  if (oldDataDirectory.deletionClaimed && oldDataDirectory.deleting !== true) {
    throw new Error('旧数据目录接管状态无效')
  }
  if (Boolean(oldDataDirectory.deletionClaimed) !== Boolean(oldDataDirectory.deletionIdentity)) {
    throw new Error('旧数据目录接管身份无效')
  }
}

/** 持久化当前目录，同时保留仍需重试的清理和删除状态。 */
async function writeReadyBootstrap(
  userDataDir: string,
  activeDataDirectory: string,
  pendingCleanups: readonly PendingCleanup[] = [],
  oldDataDirectory?: OldDataDirectory
): Promise<void> {
  await writeBootstrap(userDataDir, {
    formatVersion: FORMAT_VERSION,
    state: 'ready',
    activeDataDirectory,
    ...(pendingCleanups.length > 0 ? { pendingCleanups: [...pendingCleanups] } : {}),
    ...(oldDataDirectory ? { oldDataDirectory } : {})
  })
}

async function writeBootstrap(userDataDir: string, value: Bootstrap): Promise<void> {
  await atomicWriteJson(path.join(userDataDir, BOOTSTRAP_FILENAME), value)
}

/** 为受管目录写入稳定目录标识，并可附带本次已完成的迁移标识。 */
async function writeMarker(
  directory: string,
  migrationId?: string,
  directoryId: string = randomUUID()
): Promise<void> {
  const marker: DataDirectoryMarker = {
    formatVersion: FORMAT_VERSION,
    kind: 'ls101-data-directory',
    directoryId,
    ...(migrationId ? { migrationId } : {})
  }
  await atomicWriteJson(path.join(directory, MARKER_FILENAME), marker)
}

/** 先独占创建临时文件、刷盘并关闭，再替换配置文件以减少半写入风险。 */
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
    await replaceExistingFile(temporary, filename)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** 默认使用改名替换；Windows 拒绝覆盖已有文件时再删除旧文件并重试。 */
async function replaceExistingFile(temporary: string, filename: string): Promise<void> {
  try {
    await rename(temporary, filename)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform !== 'win32' || !['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(code ?? '')) {
      throw error
    }
    try {
      await lstat(filename)
    } catch (targetError) {
      if ((targetError as NodeJS.ErrnoException).code === 'ENOENT') throw error
      throw targetError
    }
    await rm(filename, { force: true })
    await rename(temporary, filename)
  }
}

async function assertManagedDirectory(directory: string): Promise<void> {
  if (!(await isManagedDirectory(directory)))
    throw new Error(`不是可识别的 LS101 数据目录：${directory}`)
}

/** 校验目录标记的版本、类型和可选标识，拒绝把无效文件当作受管标记。 */
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
  if (marker.directoryId !== undefined && !isMigrationId(marker.directoryId)) {
    throw new Error(`数据目录标识无效：${directory}`)
  }
  return marker as unknown as DataDirectoryMarker
}

async function assertMarker(directory: string): Promise<void> {
  await readMarker(directory)
}

/** 标记缺失或格式无效表示事务未完成，其他访问错误仍向上抛出。 */
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

/** 只接受已存在的目录，并解析符号链接以取得规范化的真实路径。 */
async function normalizeDirectory(directory: string): Promise<string> {
  const resolved = path.resolve(directory)
  const stats = await statIfExists(resolved)
  if (!stats?.isDirectory()) throw new Error(`目录不存在或无法访问：${resolved}`)
  return path.normalize(await realpath(resolved))
}

/** 目标尚不存在时解析其父目录，保留最终目录名供后续创建。 */
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

/** 暂存路径必须由目标路径和事务标识唯一推导，不能任意指定。 */
function assertMigrationPaths(
  bootstrap: CopyingBootstrap | LegacyCopyingBootstrap | PendingCleanup,
  target: string
): void {
  const expected = stagingPath(target, bootstrap.migrationId)
  const configured = path.normalize(path.resolve(bootstrap.staging))
  if (!samePath(configured, expected)) throw new Error('数据目录迁移暂存路径与迁移事务不一致')
}

/** 对持久化路径做静态校验，确保目标和暂存目录都位于记录的父目录下。 */
function assertStoredMigrationPaths(bootstrap: PendingCleanup): void {
  if (
    !path.isAbsolute(bootstrap.target) ||
    !path.isAbsolute(bootstrap.staging) ||
    !path.isAbsolute(bootstrap.parentPath)
  ) {
    throw new Error('数据目录迁移路径无效')
  }
  const target = path.normalize(path.resolve(bootstrap.target))
  const staging = path.normalize(path.resolve(bootstrap.staging))
  const parentPath = path.normalize(path.resolve(bootstrap.parentPath))
  assertMigrationPaths(bootstrap, target)
  if (!samePath(path.dirname(target), parentPath) || !samePath(path.dirname(staging), parentPath)) {
    throw new Error('数据目录迁移父路径无效')
  }
}

function stagingPath(target: string, migrationId: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.migrating-${migrationId}`)
}

/** 新旧目录必须完全分离，既不能相同，也不能互为父子目录。 */
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

/** 提交阶段需要删除空目标并改名，因此不允许选择根目录或挂载点。 */
async function assertReplaceableMigrationTarget(directory: string): Promise<void> {
  const parent = path.dirname(directory)
  if (samePath(directory, parent) || (await isMountPoint(directory, parent))) {
    throw new Error('不能选择文件系统根目录或挂载点，请在其中新建一个空目录')
  }
}

/** 先比较设备号，再在 Linux 读取挂载表以识别同设备的绑定挂载。 */
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

/** Linux 挂载表使用八进制转义表示空格等字符，比较路径前先解码。 */
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

/** Windows 路径比较忽略大小写，其他平台按原字符串比较。 */
function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right
}

function compareManifestEntries(left: FileManifestEntry, right: FileManifestEntry): number {
  return left.relativePath.localeCompare(right.relativePath)
}

/** 稍后退出以留出 IPC 回复时间，重启后的初始化流程会执行迁移计划。 */
function relaunchAfterReply(): void {
  setTimeout(() => {
    if (process.env['LS101_DISABLE_AUTO_RELAUNCH'] !== '1') app.relaunch()
    app.exit(0)
  }, 100)
}

/** 在独立进度窗口中执行迁移，无论成功或失败都确保关闭窗口。 */
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

/** 迁移路径等内容写入进度页前先转义，避免被解释为 HTML。 */
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
