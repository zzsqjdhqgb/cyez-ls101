import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir
} from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { strToU8, unzipSync, zipSync } from 'fflate'
import {
  LEGACY_DATA_CHANNELS,
  type LegacyDataInfo,
  type LegacyDataSourceInfo
} from '@ls101/core-types'

export const LEGACY_DATA_JOURNAL_FILENAME = 'legacy-migration.json'
export const LEGACY_ARCHIVE_DIRECTORY = 'legacy-archives'

/** Directories used by the legacy application and the intermediate data layout. */
export const LEGACY_DATA_DIRECTORIES = [
  'drafts',
  'exams',
  'submissions',
  'templates',
  'grading',
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

const JOURNAL_FORMAT_VERSION = 1
const ARCHIVE_FORMAT_VERSION = 1
const ARCHIVE_MANIFEST_FILENAME = 'manifest.json'
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ARCHIVE_RELATIVE_PATH_PATTERN = new RegExp(
  `^${LEGACY_ARCHIVE_DIRECTORY}/legacy-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.\\d{3}Z-${UUID_PATTERN}\\.zip$`,
  'i'
)
const QUARANTINE_RELATIVE_PATH_PATTERN = new RegExp(
  `^\\.${LEGACY_ARCHIVE_DIRECTORY}-deleting-${UUID_PATTERN}$`,
  'i'
)

type JournalState = 'archiving' | 'archived' | 'cleaning' | 'cleaned' | 'error'

interface FileSystemIdentity {
  device: string
  inode: string
}

interface JournalSource extends LegacyDataSourceInfo {
  identity: FileSystemIdentity
}

interface LegacyMigrationJournal {
  formatVersion: typeof JOURNAL_FORMAT_VERSION
  state: JournalState
  archiveRelativePath?: string
  archiveSizeBytes?: number
  archiveSha256?: string
  sourceDirectories: JournalSource[]
  quarantineRelativePath?: string
  quarantineIdentity?: FileSystemIdentity
  movedDirectories?: string[]
  createdAt: string
  error?: string
}

interface ScannedSource {
  info: JournalSource
  files: Array<{ archivePath: string; data: Uint8Array; sizeBytes: number }>
}

interface ArchiveManifest {
  formatVersion: typeof ARCHIVE_FORMAT_VERSION
  createdAt: string
  sourceDirectories: LegacyDataSourceInfo[]
  files: Array<{ path: string; sizeBytes: number; sha256: string }>
}

interface VerifiedArchive {
  sizeBytes: number
  sha256: string
  manifest: ArchiveManifest
}

export class LegacyDataService {
  private initializationPromise: Promise<void> | null = null
  private journal: LegacyMigrationJournal | null = null
  // Treat the initial scan as pending so data-directory IPC cannot race ahead of it.
  private status: LegacyDataInfo = emptyInfo('archiving')

  constructor(
    private readonly userDataDirectory: string,
    private readonly currentDataDirectory: string
  ) {}

  /** Start the one-time scan/archive operation after the application is ready. */
  async initialize(): Promise<LegacyDataInfo> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeInternal().catch((error: unknown) =>
        this.handleInitializationError(error)
      )
    }
    await this.initializationPromise
    return this.getStatus()
  }

  async getInfo(): Promise<LegacyDataInfo> {
    await this.initialize()
    return this.getStatus()
  }

  async retry(): Promise<LegacyDataInfo> {
    await this.initializationPromise
    if (this.journal?.state === 'error') {
      const retrying: LegacyMigrationJournal = {
        ...this.journal,
        state: 'archiving',
        archiveSizeBytes: undefined,
        archiveSha256: undefined,
        quarantineRelativePath: undefined,
        quarantineIdentity: undefined,
        movedDirectories: undefined,
        error: undefined
      }
      await this.saveJournal(retrying)
      this.journal = retrying
      this.status = this.infoFromJournal(retrying)
    }
    this.initializationPromise = null
    return this.initialize()
  }

  /** Used by data-directory settings to avoid switching paths mid-cleanup. */
  hasPendingCleanup(): boolean {
    return this.status.status !== 'none' && this.status.status !== 'cleaned'
  }

  async exportArchive(parent: BrowserWindow | null): Promise<boolean> {
    await this.initialize()
    const archivePath = this.requireArchivePath()
    if (!this.journal) throw new Error('旧数据归档不存在')
    await verifyArchive(archivePath, this.journal)
    const defaultName = path.basename(archivePath)
    const options = {
      title: '导出旧数据归档',
      defaultPath: defaultName,
      filters: [{ name: 'ZIP 归档', extensions: ['zip'] }]
    }
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    if (!samePath(result.filePath, archivePath)) await copyFile(archivePath, result.filePath)
    return true
  }

  async cleanup(): Promise<LegacyDataInfo> {
    await this.initialize()
    try {
      return await this.cleanupInternal()
    } catch (error) {
      this.status = this.journal
        ? { ...this.infoFromJournal(this.journal), error: errorMessage(error) }
        : { ...this.status, error: errorMessage(error) }
      throw error
    }
  }

  private async cleanupInternal(): Promise<LegacyDataInfo> {
    if (!this.journal || this.journal.state === 'cleaned') return this.getStatus()
    if (this.journal.state === 'error') throw new Error(this.journal.error ?? '旧数据归档失败')
    const archivePath = this.requireArchivePath()
    const verifiedArchive = await verifyArchive(archivePath, this.journal)

    let journal = this.journal
    await assertNoUnexpectedLegacyDirectories(
      this.userDataDirectory,
      this.currentDataDirectory,
      journal.sourceDirectories
    )
    const quarantineRelativePath =
      journal.quarantineRelativePath ?? `.${LEGACY_ARCHIVE_DIRECTORY}-deleting-${randomUUID()}`
    assertQuarantineRelativePath(quarantineRelativePath)
    const quarantinePath = resolveJournalPath(this.userDataDirectory, quarantineRelativePath)
    const quarantineExisted = (await lstatIfExists(quarantinePath)) !== null
    if (!quarantineExisted) await mkdir(quarantinePath)
    const quarantineStats = await lstat(quarantinePath)
    assertLegacyDirectory(quarantinePath, quarantineStats)
    const quarantineIdentity = fileSystemIdentity(quarantineStats)

    if (journal.state !== 'cleaning') {
      journal = {
        ...journal,
        state: 'cleaning',
        quarantineRelativePath,
        quarantineIdentity,
        movedDirectories: journal.movedDirectories ?? [],
        error: undefined
      }
      await this.saveJournal(journal)
    } else {
      if (
        quarantineExisted &&
        (!journal.quarantineIdentity ||
          !sameIdentity(quarantineIdentity, journal.quarantineIdentity))
      ) {
        throw new Error('旧数据清理暂存目录标识已变化，未执行清理')
      }
      if (!quarantineExisted) {
        journal = { ...journal, quarantineIdentity }
        await this.saveJournal(journal)
      }
    }

    this.journal = journal
    this.status = this.infoFromJournal(journal)
    const moved = new Set(journal.movedDirectories ?? [])

    for (const source of journal.sourceDirectories) {
      const sourcePath = path.join(this.userDataDirectory, source.name)
      const targetPath = path.join(quarantinePath, source.name)
      const sourceStats = await lstatIfExists(sourcePath)
      const targetStats = await lstatIfExists(targetPath)

      if (sourceStats && targetStats) {
        throw new Error(`旧数据清理路径同时存在源目录和暂存目录：${source.name}`)
      }
      if (targetStats) {
        assertLegacyDirectory(targetPath, targetStats)
        if (!sameIdentity(fileSystemIdentity(targetStats), source.identity)) {
          throw new Error(`旧数据暂存目录标识已变化，未执行清理：${source.name}`)
        }
      }
      if (!sourceStats && !targetStats) {
        moved.add(source.name)
        await this.persistMovedDirectories(moved)
        continue
      }
      if (!sourceStats) {
        moved.add(source.name)
        await this.persistMovedDirectories(moved)
        continue
      }
      assertLegacyDirectory(sourcePath, sourceStats)
      if (!sameIdentity(fileSystemIdentity(sourceStats), source.identity)) {
        throw new Error(`旧数据目录标识已变化，未执行清理：${source.name}`)
      }
      await verifyLegacyDirectoryContents(sourcePath, source.name, verifiedArchive.manifest)
      await rename(sourcePath, targetPath)
      const movedStats = await lstat(targetPath)
      assertLegacyDirectory(targetPath, movedStats)
      if (!sameIdentity(fileSystemIdentity(movedStats), source.identity)) {
        throw new Error(`旧数据暂存目录标识校验失败：${source.name}`)
      }
      moved.add(source.name)
      await this.persistMovedDirectories(moved)
    }

    await assertNoUnexpectedLegacyDirectories(
      this.userDataDirectory,
      this.currentDataDirectory,
      journal.sourceDirectories
    )
    for (const source of journal.sourceDirectories) {
      const targetPath = path.join(quarantinePath, source.name)
      const targetStats = await lstatIfExists(targetPath)
      if (!targetStats) continue
      assertLegacyDirectory(targetPath, targetStats)
      if (!sameIdentity(fileSystemIdentity(targetStats), source.identity)) {
        throw new Error(`旧数据暂存目录标识已变化，未执行删除：${source.name}`)
      }
      await verifyLegacyDirectoryContents(targetPath, source.name, verifiedArchive.manifest)
      await rm(targetPath, { recursive: true, force: true })
    }
    const finalQuarantineStats = await lstat(quarantinePath)
    assertLegacyDirectory(quarantinePath, finalQuarantineStats)
    if (!sameIdentity(fileSystemIdentity(finalQuarantineStats), quarantineIdentity)) {
      throw new Error('旧数据清理暂存目录标识已变化，未执行删除')
    }
    await rmdir(quarantinePath)
    journal = {
      ...this.journal!,
      state: 'cleaned',
      quarantineRelativePath: undefined,
      quarantineIdentity: undefined,
      movedDirectories: undefined,
      error: undefined
    }
    await this.saveJournal(journal)
    this.journal = journal
    this.status = this.infoFromJournal(journal)
    return this.getStatus()
  }

  private async initializeInternal(): Promise<void> {
    const existing = await this.readJournal()
    if (existing) {
      this.journal = existing
      this.status = this.infoFromJournal(existing)
      if (existing.state === 'cleaning') {
        await this.cleanupInternal()
      } else if (existing.state === 'archiving') {
        await this.createArchive(existing)
      } else if (existing.state === 'error') {
        return
      } else if (existing.state === 'archived') {
        await verifyArchive(this.requireArchivePath(), existing)
      }
      return
    }

    const sources = await scanLegacySources(this.userDataDirectory, this.currentDataDirectory)
    if (sources.length === 0) {
      this.status = emptyInfo('none')
      return
    }

    const journal: LegacyMigrationJournal = {
      formatVersion: JOURNAL_FORMAT_VERSION,
      state: 'archiving',
      archiveRelativePath: archiveRelativePath(),
      sourceDirectories: sources.map(({ info }) => info),
      createdAt: new Date().toISOString()
    }
    await this.saveJournal(journal)
    this.journal = journal
    this.status = this.infoFromJournal(journal)
    await this.createArchive(journal, sources)
  }

  private async createArchive(
    journal: LegacyMigrationJournal,
    scannedSources?: ScannedSource[]
  ): Promise<void> {
    const sources =
      scannedSources ?? (await scanLegacySources(this.userDataDirectory, this.currentDataDirectory))
    const files: Record<string, Uint8Array> = {}
    const manifestFiles: ArchiveManifest['files'] = []
    for (const source of sources) {
      for (const file of source.files) {
        files[file.archivePath] = file.data
        manifestFiles.push({
          path: file.archivePath,
          sizeBytes: file.sizeBytes,
          sha256: sha256(file.data)
        })
      }
    }
    const archiveJournal: LegacyMigrationJournal = {
      ...journal,
      sourceDirectories: sources.map(({ info }) => info),
      archiveSizeBytes: undefined,
      archiveSha256: undefined,
      error: undefined
    }
    const manifest: ArchiveManifest = {
      formatVersion: ARCHIVE_FORMAT_VERSION,
      createdAt: journal.createdAt,
      sourceDirectories: archiveJournal.sourceDirectories.map(({ name, fileCount, sizeBytes }) => ({
        name,
        fileCount,
        sizeBytes
      })),
      files: manifestFiles.sort((left, right) => left.path.localeCompare(right.path))
    }
    files[ARCHIVE_MANIFEST_FILENAME] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)
    const archiveBytes = zipSync(files, { level: 6, os: 3 })
    const archivePath = this.requireArchivePath(journal)
    await writeBinaryAtomically(archivePath, archiveBytes)
    const verified = await verifyArchive(archivePath, archiveJournal)
    const next: LegacyMigrationJournal = {
      ...archiveJournal,
      state: 'archived',
      archiveSizeBytes: verified.sizeBytes,
      archiveSha256: verified.sha256,
      error: undefined
    }
    await this.saveJournal(next)
    this.journal = next
    this.status = this.infoFromJournal(next)
  }

  private async persistMovedDirectories(moved: Set<string>): Promise<void> {
    if (!this.journal) return
    const next = { ...this.journal, state: 'cleaning' as const, movedDirectories: [...moved] }
    await this.saveJournal(next)
    this.journal = next
    this.status = this.infoFromJournal(next)
  }

  private requireArchivePath(journal = this.journal): string {
    if (!journal?.archiveRelativePath) throw new Error('旧数据归档不存在')
    return resolveJournalPath(this.userDataDirectory, journal.archiveRelativePath)
  }

  private async readJournal(): Promise<LegacyMigrationJournal | null> {
    let raw: string
    try {
      raw = await readFile(path.join(this.userDataDirectory, LEGACY_DATA_JOURNAL_FILENAME), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const value: unknown = JSON.parse(raw)
    return parseJournal(value)
  }

  private async saveJournal(journal: LegacyMigrationJournal): Promise<void> {
    await writeJsonAtomically(
      path.join(this.userDataDirectory, LEGACY_DATA_JOURNAL_FILENAME),
      journal
    )
  }

  private async handleInitializationError(error: unknown): Promise<void> {
    const message = errorMessage(error)
    if (this.journal?.state === 'archiving' || this.journal?.state === 'archived') {
      const failed: LegacyMigrationJournal = {
        ...this.journal,
        state: 'error',
        error: message
      }
      this.journal = failed
      this.status = this.infoFromJournal(failed)
      try {
        await this.saveJournal(failed)
      } catch (saveError) {
        this.status = {
          ...this.status,
          error: `${message}；迁移日志写入失败：${errorMessage(saveError)}`
        }
      }
      return
    }
    this.status = this.journal
      ? { ...this.infoFromJournal(this.journal), error: message }
      : { ...this.status, status: 'error', error: message }
  }

  private getStatus(): LegacyDataInfo {
    return structuredClone(this.status)
  }

  private infoFromJournal(journal: LegacyMigrationJournal): LegacyDataInfo {
    return {
      status: journal.state,
      archivePath: journal.archiveRelativePath
        ? resolveJournalPath(this.userDataDirectory, journal.archiveRelativePath)
        : null,
      archiveSizeBytes: journal.archiveSizeBytes ?? null,
      sourceDirectories: journal.sourceDirectories.map(({ name, fileCount, sizeBytes }) => ({
        name,
        fileCount,
        sizeBytes
      })),
      ...(journal.error ? { error: journal.error } : {})
    }
  }
}

export function registerLegacyDataHandlers(service: LegacyDataService): void {
  ipcMain.handle(LEGACY_DATA_CHANNELS.getInfo, () => service.getInfo())
  ipcMain.handle(LEGACY_DATA_CHANNELS.retry, () => service.retry())
  ipcMain.handle(LEGACY_DATA_CHANNELS.cleanup, () => service.cleanup())
  ipcMain.handle(LEGACY_DATA_CHANNELS.exportArchive, async (event) => {
    return service.exportArchive(BrowserWindow.fromWebContents(event.sender))
  })
}

export function emptyLegacyDataInfo(): LegacyDataInfo {
  return emptyInfo('none')
}

async function scanLegacySources(
  userDataDirectory: string,
  currentDataDirectory: string
): Promise<ScannedSource[]> {
  const sources: ScannedSource[] = []
  for (const name of LEGACY_DATA_DIRECTORIES) {
    const sourcePath = path.join(userDataDirectory, name)
    const stats = await lstatIfExists(sourcePath)
    if (!stats) continue
    assertLegacyDirectory(sourcePath, stats)
    if (pathsOverlap(sourcePath, currentDataDirectory)) {
      throw new Error(`旧数据目录与当前数据目录重叠：${name}`)
    }
    const files: ScannedSource['files'] = []
    await collectFiles(sourcePath, name, sourcePath, files)
    sources.push({
      info: {
        name,
        fileCount: files.length,
        sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
        identity: fileSystemIdentity(stats)
      },
      files
    })
  }
  return sources
}

async function collectFiles(
  directory: string,
  archivePrefix: string,
  sourceRoot: string,
  output: ScannedSource['files']
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    const stats = await lstat(fullPath)
    if (stats.isSymbolicLink()) throw new Error(`旧数据包含不支持的符号链接：${fullPath}`)
    if (stats.isDirectory()) {
      await collectFiles(fullPath, archivePrefix, sourceRoot, output)
      continue
    }
    if (!stats.isFile()) throw new Error(`旧数据包含不支持的文件类型：${fullPath}`)
    const data = new Uint8Array(await readFile(fullPath))
    const after = await lstat(fullPath)
    if (
      !sameIdentity(fileSystemIdentity(stats), fileSystemIdentity(after)) ||
      after.size !== stats.size
    ) {
      throw new Error(`旧数据在归档期间发生变化：${fullPath}`)
    }
    const relative = path.relative(sourceRoot, fullPath).split(path.sep).join('/')
    const archivePath = `${archivePrefix}/${relative}`
    assertArchiveEntryPath(archivePath)
    output.push({
      archivePath,
      data,
      sizeBytes: data.byteLength
    })
  }
}

async function verifyArchive(
  archivePath: string,
  journal: LegacyMigrationJournal
): Promise<VerifiedArchive> {
  const data = new Uint8Array(await readFile(archivePath))
  const archiveSha256 = sha256(data)
  if (journal.archiveSizeBytes !== undefined && data.byteLength !== journal.archiveSizeBytes) {
    throw new Error('旧数据归档大小不匹配')
  }
  if (journal.archiveSha256 && archiveSha256 !== journal.archiveSha256) {
    throw new Error('旧数据归档摘要不匹配')
  }
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Error('旧数据归档无法读取')
  }
  const manifestData = files[ARCHIVE_MANIFEST_FILENAME]
  if (!manifestData) throw new Error('旧数据归档缺少清单文件')
  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(new TextDecoder().decode(manifestData)) as unknown
  } catch {
    throw new Error('旧数据归档清单无效')
  }
  const manifest = parseArchiveManifest(manifestValue)
  assertManifestMatchesJournal(manifest, journal)

  const expectedPaths = new Set([
    ARCHIVE_MANIFEST_FILENAME,
    ...manifest.files.map((file) => file.path)
  ])
  const actualPaths = Object.keys(files)
  if (
    actualPaths.length !== expectedPaths.size ||
    actualPaths.some((filename) => !expectedPaths.has(filename))
  ) {
    throw new Error('旧数据归档包含未记录的文件')
  }
  for (const file of manifest.files) {
    const archivedFile = hasOwn(files, file.path) ? files[file.path] : undefined
    if (
      !archivedFile ||
      archivedFile.byteLength !== file.sizeBytes ||
      sha256(archivedFile) !== file.sha256
    ) {
      throw new Error(`旧数据归档文件校验失败：${file.path}`)
    }
  }
  return {
    sizeBytes: data.byteLength,
    sha256: archiveSha256,
    manifest
  }
}

function parseJournal(value: unknown): LegacyMigrationJournal {
  if (!isRecord(value)) throw new Error('旧数据迁移日志格式无效')
  const state = value.state
  if (
    value.formatVersion !== JOURNAL_FORMAT_VERSION ||
    !isJournalState(state) ||
    !Array.isArray(value.sourceDirectories) ||
    value.sourceDirectories.length === 0 ||
    !isIsoTimestamp(value.createdAt)
  ) {
    throw new Error('旧数据迁移日志格式无效或版本不受支持')
  }
  const sourceDirectories = value.sourceDirectories.map(parseJournalSource)
  assertUniqueNames(sourceDirectories, '旧数据迁移日志来源重复')

  if (typeof value.archiveRelativePath !== 'string') throw new Error('旧数据归档路径无效')
  assertArchiveRelativePath(value.archiveRelativePath)
  const archiveSizeBytes = parseOptionalNonNegativeInteger(
    value.archiveSizeBytes,
    '旧数据归档大小无效'
  )
  const archiveSha256 = parseOptionalSha256(value.archiveSha256, '旧数据归档摘要无效')
  if (
    (state === 'archived' || state === 'cleaning' || state === 'cleaned') &&
    (archiveSizeBytes === undefined || archiveSha256 === undefined)
  ) {
    throw new Error('旧数据归档校验信息缺失')
  }

  let quarantineRelativePath: string | undefined
  let quarantineIdentity: FileSystemIdentity | undefined
  let movedDirectories: string[] | undefined
  if (state === 'cleaning') {
    if (typeof value.quarantineRelativePath !== 'string') throw new Error('旧数据清理路径无效')
    assertQuarantineRelativePath(value.quarantineRelativePath)
    quarantineRelativePath = value.quarantineRelativePath
    quarantineIdentity = parseFileSystemIdentity(
      value.quarantineIdentity,
      '旧数据清理暂存目录标识无效'
    )
    if (!Array.isArray(value.movedDirectories)) throw new Error('旧数据清理进度无效')
    const sourceNames = new Set(sourceDirectories.map((source) => source.name))
    movedDirectories = value.movedDirectories.map((name) => {
      if (typeof name !== 'string' || !sourceNames.has(name)) {
        throw new Error('旧数据清理进度无效')
      }
      return name
    })
    if (new Set(movedDirectories).size !== movedDirectories.length) {
      throw new Error('旧数据清理进度包含重复目录')
    }
  } else if (
    value.quarantineRelativePath !== undefined ||
    value.quarantineIdentity !== undefined ||
    value.movedDirectories !== undefined
  ) {
    throw new Error('旧数据清理状态与进度不一致')
  }

  const error = value.error
  if (error !== undefined && (typeof error !== 'string' || error.length === 0)) {
    throw new Error('旧数据迁移错误信息无效')
  }
  if (state === 'error' && typeof error !== 'string') {
    throw new Error('旧数据迁移错误信息缺失')
  }

  return {
    formatVersion: JOURNAL_FORMAT_VERSION,
    state,
    archiveRelativePath: value.archiveRelativePath,
    ...(archiveSizeBytes !== undefined ? { archiveSizeBytes } : {}),
    ...(archiveSha256 !== undefined ? { archiveSha256 } : {}),
    sourceDirectories,
    ...(quarantineRelativePath ? { quarantineRelativePath } : {}),
    ...(quarantineIdentity ? { quarantineIdentity } : {}),
    ...(movedDirectories ? { movedDirectories } : {}),
    createdAt: value.createdAt,
    ...(error ? { error } : {})
  }
}

function parseArchiveManifest(value: unknown): ArchiveManifest {
  if (
    !isRecord(value) ||
    value.formatVersion !== ARCHIVE_FORMAT_VERSION ||
    !isIsoTimestamp(value.createdAt) ||
    !Array.isArray(value.sourceDirectories) ||
    value.sourceDirectories.length === 0 ||
    !Array.isArray(value.files)
  ) {
    throw new Error('旧数据归档格式无效')
  }

  const sourceDirectories = value.sourceDirectories.map(parseLegacyDataSourceInfo)
  assertUniqueNames(sourceDirectories, '旧数据归档来源重复')
  const sourceNames = new Set(sourceDirectories.map((source) => source.name))
  const files = value.files.map((file): ArchiveManifest['files'][number] => {
    if (
      !isRecord(file) ||
      typeof file.path !== 'string' ||
      !isNonNegativeSafeInteger(file.sizeBytes) ||
      typeof file.sha256 !== 'string' ||
      !isSha256(file.sha256)
    ) {
      throw new Error('旧数据归档文件清单无效')
    }
    assertArchiveEntryPath(file.path)
    const sourceName = file.path.split('/')[0]
    if (!sourceNames.has(sourceName)) throw new Error('旧数据归档文件来源无效')
    return { path: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256 }
  })
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error('旧数据归档文件清单包含重复路径')
  }

  const totals = new Map<string, { fileCount: number; sizeBytes: number }>()
  for (const source of sourceDirectories) totals.set(source.name, { fileCount: 0, sizeBytes: 0 })
  for (const file of files) {
    const total = totals.get(file.path.split('/')[0])!
    total.fileCount += 1
    total.sizeBytes += file.sizeBytes
  }
  for (const source of sourceDirectories) {
    const total = totals.get(source.name)!
    if (total.fileCount !== source.fileCount || total.sizeBytes !== source.sizeBytes) {
      throw new Error(`旧数据归档来源统计不匹配：${source.name}`)
    }
  }

  return {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    createdAt: value.createdAt,
    sourceDirectories,
    files
  }
}

function parseJournalSource(value: unknown): JournalSource {
  if (!isRecord(value)) throw new Error('旧数据迁移日志来源无效')
  const source = parseLegacyDataSourceInfo(value)
  return {
    ...source,
    identity: parseFileSystemIdentity(value.identity, '旧数据迁移日志来源标识无效')
  }
}

function parseLegacyDataSourceInfo(value: unknown): LegacyDataSourceInfo {
  if (
    !isRecord(value) ||
    !isLegacyDirectoryName(value.name) ||
    !isNonNegativeSafeInteger(value.fileCount) ||
    !isNonNegativeSafeInteger(value.sizeBytes)
  ) {
    throw new Error('旧数据来源信息无效')
  }
  return { name: value.name, fileCount: value.fileCount, sizeBytes: value.sizeBytes }
}

function parseFileSystemIdentity(value: unknown, message: string): FileSystemIdentity {
  if (
    !isRecord(value) ||
    typeof value.device !== 'string' ||
    !/^\d+$/.test(value.device) ||
    typeof value.inode !== 'string' ||
    !/^\d+$/.test(value.inode)
  ) {
    throw new Error(message)
  }
  return { device: value.device, inode: value.inode }
}

function parseOptionalNonNegativeInteger(value: unknown, message: string): number | undefined {
  if (value === undefined) return undefined
  if (!isNonNegativeSafeInteger(value)) throw new Error(message)
  return value
}

function parseOptionalSha256(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !isSha256(value)) throw new Error(message)
  return value
}

function assertManifestMatchesJournal(
  manifest: ArchiveManifest,
  journal: LegacyMigrationJournal
): void {
  if (manifest.createdAt !== journal.createdAt) throw new Error('旧数据归档创建时间不匹配')
  if (manifest.sourceDirectories.length !== journal.sourceDirectories.length) {
    throw new Error('旧数据归档来源与迁移日志不匹配')
  }
  const manifestSources = new Map(
    manifest.sourceDirectories.map((source) => [source.name, source] as const)
  )
  for (const source of journal.sourceDirectories) {
    const archived = manifestSources.get(source.name)
    if (
      !archived ||
      archived.fileCount !== source.fileCount ||
      archived.sizeBytes !== source.sizeBytes
    ) {
      throw new Error(`旧数据归档来源与迁移日志不匹配：${source.name}`)
    }
  }
}

async function verifyLegacyDirectoryContents(
  directory: string,
  sourceName: string,
  manifest: ArchiveManifest
): Promise<void> {
  const actualFiles: ScannedSource['files'] = []
  await collectFiles(directory, sourceName, directory, actualFiles)
  const prefix = `${sourceName}/`
  const expectedFiles = new Map(
    manifest.files
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => [file.path, file] as const)
  )
  if (actualFiles.length !== expectedFiles.size) {
    throw new Error(`旧数据在归档后发生变化，未执行清理：${sourceName}`)
  }
  for (const actual of actualFiles) {
    const expected = expectedFiles.get(actual.archivePath)
    if (
      !expected ||
      actual.sizeBytes !== expected.sizeBytes ||
      sha256(actual.data) !== expected.sha256
    ) {
      throw new Error(`旧数据在归档后发生变化，未执行清理：${sourceName}`)
    }
  }
}

async function assertNoUnexpectedLegacyDirectories(
  userDataDirectory: string,
  currentDataDirectory: string,
  expectedSources: JournalSource[]
): Promise<void> {
  const expectedNames = new Set(expectedSources.map((source) => source.name))
  for (const name of LEGACY_DATA_DIRECTORIES) {
    const sourcePath = path.join(userDataDirectory, name)
    if (pathsOverlap(sourcePath, currentDataDirectory)) {
      throw new Error(`旧数据目录与当前数据目录重叠：${name}`)
    }
    if (expectedNames.has(name)) continue
    const stats = await lstatIfExists(sourcePath)
    if (!stats) continue
    assertLegacyDirectory(sourcePath, stats)
    throw new Error(`归档后检测到新增的旧数据目录，未执行清理：${name}`)
  }
}

function assertUniqueNames(values: Array<{ name: string }>, message: string): void {
  if (new Set(values.map((value) => value.name)).size !== values.length) throw new Error(message)
}

function assertArchiveEntryPath(filename: string): void {
  const segments = filename.split('/')
  if (
    filename.includes('\\') ||
    path.posix.isAbsolute(filename) ||
    path.posix.normalize(filename) !== filename ||
    segments.length < 2 ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !isLegacyDirectoryName(segments[0])
  ) {
    throw new Error(`旧数据归档文件路径无效：${filename}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJournalState(value: unknown): value is JournalState {
  return (
    value === 'archiving' ||
    value === 'archived' ||
    value === 'cleaning' ||
    value === 'cleaned' ||
    value === 'error'
  )
}

function isLegacyDirectoryName(value: unknown): value is (typeof LEGACY_DATA_DIRECTORIES)[number] {
  return (
    typeof value === 'string' &&
    LEGACY_DATA_DIRECTORIES.includes(value as (typeof LEGACY_DATA_DIRECTORIES)[number])
  )
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function archiveRelativePath(): string {
  return `${LEGACY_ARCHIVE_DIRECTORY}/legacy-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.zip`
}

function resolveJournalPath(userDataDirectory: string, relativePath: string): string {
  const resolved = path.resolve(userDataDirectory, relativePath)
  if (!pathsWithin(userDataDirectory, resolved)) throw new Error('旧数据迁移路径越界')
  return resolved
}

function assertArchiveRelativePath(relativePath: string): void {
  if (!ARCHIVE_RELATIVE_PATH_PATTERN.test(relativePath)) throw new Error('旧数据归档路径无效')
}

function assertQuarantineRelativePath(relativePath: string): void {
  if (!QUARANTINE_RELATIVE_PATH_PATTERN.test(relativePath)) {
    throw new Error('旧数据清理路径无效')
  }
}

function assertLegacyDirectory(filename: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`旧数据路径不是普通目录：${filename}`)
  }
}

function fileSystemIdentity(stats: Awaited<ReturnType<typeof lstat>>): FileSystemIdentity {
  return { device: String(stats.dev), inode: String(stats.ino) }
}

function sameIdentity(left: FileSystemIdentity, right: FileSystemIdentity): boolean {
  return left.device === right.device && left.inode === right.inode
}

function pathsOverlap(left: string, right: string): boolean {
  return samePath(left, right) || pathsWithin(left, right) || pathsWithin(right, left)
}

function pathsWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right
}

async function lstatIfExists(filename: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function emptyInfo(status: LegacyDataInfo['status']): LegacyDataInfo {
  return { status, archivePath: null, archiveSizeBytes: null, sourceDirectories: [] }
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

async function writeBinaryAtomically(filename: string, data: Uint8Array): Promise<void> {
  const directory = path.dirname(filename)
  const temporary = `${filename}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | null = null
  let renamed = false
  await mkdir(directory, { recursive: true })
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(data)
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

async function writeJsonAtomically(filename: string, value: object): Promise<void> {
  await writeBinaryAtomically(filename, strToU8(`${JSON.stringify(value, null, 2)}\n`))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
