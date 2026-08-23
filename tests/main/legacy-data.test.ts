import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'

const electronMocks = vi.hoisted(() => ({
  dialog: { showSaveDialog: vi.fn() },
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler)
    })
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: electronMocks.dialog,
  ipcMain: electronMocks.ipcMain
}))

import { LEGACY_DATA_JOURNAL_FILENAME, LegacyDataService } from '../../src/main/legacy-data'
import { inProcessLegacyArchiveOperations } from '../../src/main/legacy-data-archive'

let roots: string[]

beforeEach(() => {
  roots = []
  electronMocks.handlers.clear()
  electronMocks.dialog.showSaveDialog.mockReset()
})

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })))
})

describe('legacy data archival', () => {
  it('reports no work for a fresh profile', async () => {
    const userData = await temporaryDirectory('ls101-legacy-empty-')
    const current = path.join(userData, 'data')
    await mkdir(current)
    const service = legacyDataService(userData, current)

    expect(service.hasPendingCleanup()).toBe(true)
    await expect(service.initialize()).resolves.toEqual({
      status: 'none',
      archivePath: null,
      archiveSizeBytes: null,
      sourceDirectories: []
    })
    expect(service.hasPendingCleanup()).toBe(false)
  })

  it('archives legacy directories, exports the ZIP and only then removes the sources', async () => {
    const userData = await legacyProfile('archive-cleanup')
    const service = legacyDataService(userData, path.join(userData, 'data'))

    const archived = await service.initialize()

    expect(archived.status).toBe('archived')
    expect(archived.sourceDirectories).toEqual([
      { name: 'drafts', fileCount: 1, sizeBytes: 5 },
      { name: 'submissions', fileCount: 1, sizeBytes: 5 }
    ])
    const archivePath = archived.archivePath!
    const archive = unzipSync(new Uint8Array(await readFile(archivePath)))
    expect(new TextDecoder().decode(archive['drafts/draft.json'])).toBe('draft')
    expect(new TextDecoder().decode(archive['submissions/recordings/0.mp3'])).toBe('audio')
    expect(JSON.parse(new TextDecoder().decode(archive['manifest.json']))).toMatchObject({
      formatVersion: 1,
      sourceDirectories: [
        { name: 'drafts', fileCount: 1, sizeBytes: 5 },
        { name: 'submissions', fileCount: 1, sizeBytes: 5 }
      ]
    })
    await expect(readFile(path.join(userData, 'drafts', 'draft.json'), 'utf8')).resolves.toBe(
      'draft'
    )

    const exported = path.join(await temporaryDirectory('ls101-legacy-export-'), 'saved.zip')
    electronMocks.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exported })
    await expect(service.exportArchive(null)).resolves.toBe(true)
    await expect(readFile(exported)).resolves.toEqual(await readFile(archivePath))

    await expect(service.cleanup()).resolves.toMatchObject({ status: 'cleaned' })
    await expect(readFile(path.join(userData, 'drafts', 'draft.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(
      readFile(path.join(userData, 'submissions', 'recordings', '0.mp3'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(archivePath)).resolves.not.toHaveLength(0)
    await expect(
      readJson(path.join(userData, LEGACY_DATA_JOURNAL_FILENAME))
    ).resolves.toMatchObject({
      formatVersion: 1,
      state: 'cleaned'
    })
  })

  it('archives and removes empty legacy directories', async () => {
    const userData = await temporaryDirectory('ls101-legacy-empty-directory-')
    await mkdir(path.join(userData, 'data'))
    await mkdir(path.join(userData, 'drafts'))
    const service = legacyDataService(userData, path.join(userData, 'data'))

    await expect(service.initialize()).resolves.toMatchObject({
      status: 'archived',
      sourceDirectories: [{ name: 'drafts', fileCount: 0, sizeBytes: 0 }]
    })
    await expect(service.cleanup()).resolves.toMatchObject({ status: 'cleaned' })
    await expect(stat(path.join(userData, 'drafts'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists archival failures and retries without deleting the sources', async () => {
    const userData = await legacyProfile('retry-archive')
    const archiveDirectory = path.join(userData, 'legacy-archives')
    await writeFile(archiveDirectory, 'blocks archive directory creation')
    const service = legacyDataService(userData, path.join(userData, 'data'))

    await expect(service.initialize()).resolves.toMatchObject({ status: 'error' })
    await expect(
      readJson(path.join(userData, LEGACY_DATA_JOURNAL_FILENAME))
    ).resolves.toMatchObject({
      state: 'error'
    })
    await expect(readFile(path.join(userData, 'drafts', 'draft.json'), 'utf8')).resolves.toBe(
      'draft'
    )

    await rm(archiveDirectory)
    await expect(service.retry()).resolves.toMatchObject({ status: 'archived' })
    await expect(
      readJson(path.join(userData, LEGACY_DATA_JOURNAL_FILENAME))
    ).resolves.toMatchObject({
      state: 'archived'
    })
  })

  it('does not clean a legacy directory changed after archival', async () => {
    const userData = await legacyProfile('content-change')
    const service = legacyDataService(userData, path.join(userData, 'data'))
    await service.initialize()
    await writeFile(path.join(userData, 'drafts', 'draft.json'), 'changed after archive')

    await expect(service.cleanup()).rejects.toThrow('旧数据在归档后发生变化')
    await expect(readFile(path.join(userData, 'drafts', 'draft.json'), 'utf8')).resolves.toBe(
      'changed after archive'
    )
  })

  it('resumes cleanup after a source directory was moved into quarantine', async () => {
    const userData = await legacyProfile('resume-cleanup')
    const current = path.join(userData, 'data')
    const first = legacyDataService(userData, current)
    await first.initialize()

    const journalPath = path.join(userData, LEGACY_DATA_JOURNAL_FILENAME)
    const journal = (await readJson(journalPath)) as Record<string, unknown>
    const quarantineRelativePath = '.legacy-archives-deleting-11111111-1111-4111-8111-111111111111'
    const quarantine = path.join(userData, quarantineRelativePath)
    await mkdir(quarantine)
    const quarantineStats = await stat(quarantine)
    await rename(path.join(userData, 'drafts'), path.join(quarantine, 'drafts'))
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        state: 'cleaning',
        quarantineRelativePath,
        quarantineIdentity: {
          device: String(quarantineStats.dev),
          inode: String(quarantineStats.ino)
        },
        movedDirectories: ['drafts']
      })
    )

    const resumed = legacyDataService(userData, current)
    await expect(resumed.initialize()).resolves.toMatchObject({ status: 'cleaned' })
    await expect(readFile(path.join(quarantine, 'drafts', 'draft.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(path.join(userData, 'submissions'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('rejects a cleanup journal whose quarantine path escapes its generated directory', async () => {
    const userData = await legacyProfile('invalid-quarantine-path')
    const current = path.join(userData, 'data')
    await writeFile(path.join(current, 'current-data.txt'), 'keep current data')
    const first = legacyDataService(userData, current)
    await first.initialize()

    const journalPath = path.join(userData, LEGACY_DATA_JOURNAL_FILENAME)
    const journal = (await readJson(journalPath)) as Record<string, unknown>
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        state: 'cleaning',
        quarantineRelativePath:
          '.legacy-archives-deleting-22222222-2222-4222-8222-222222222222/../data',
        quarantineIdentity: { device: '0', inode: '0' },
        movedDirectories: []
      })
    )

    const resumed = legacyDataService(userData, current)
    await expect(resumed.initialize()).resolves.toMatchObject({
      status: 'error',
      error: expect.stringContaining('旧数据清理路径无效')
    })
    await expect(readFile(path.join(current, 'current-data.txt'), 'utf8')).resolves.toBe(
      'keep current data'
    )
    await expect(readFile(path.join(userData, 'drafts', 'draft.json'), 'utf8')).resolves.toBe(
      'draft'
    )
  })

  it('does not use a replaced quarantine directory while resuming cleanup', async () => {
    const userData = await legacyProfile('quarantine-identity-change')
    const current = path.join(userData, 'data')
    const first = legacyDataService(userData, current)
    await first.initialize()

    const journalPath = path.join(userData, LEGACY_DATA_JOURNAL_FILENAME)
    const journal = (await readJson(journalPath)) as Record<string, unknown>
    const quarantineRelativePath = '.legacy-archives-deleting-33333333-3333-4333-8333-333333333333'
    const quarantine = path.join(userData, quarantineRelativePath)
    const preservedQuarantine = `${quarantine}-preserved`
    await mkdir(quarantine)
    const quarantineStats = await stat(quarantine)
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        state: 'cleaning',
        quarantineRelativePath,
        quarantineIdentity: {
          device: String(quarantineStats.dev),
          inode: String(quarantineStats.ino)
        },
        movedDirectories: []
      })
    )
    await rename(quarantine, preservedQuarantine)
    await mkdir(quarantine)
    await writeFile(path.join(quarantine, 'replacement.txt'), 'do not delete')

    const resumed = legacyDataService(userData, current)
    await expect(resumed.initialize()).resolves.toMatchObject({
      status: 'cleaning',
      error: expect.stringContaining('暂存目录标识已变化')
    })
    await expect(readFile(path.join(quarantine, 'replacement.txt'), 'utf8')).resolves.toBe(
      'do not delete'
    )
    await expect(readFile(path.join(userData, 'drafts', 'draft.json'), 'utf8')).resolves.toBe(
      'draft'
    )
  })

  it('refuses to delete a source directory whose identity changed after archival', async () => {
    const userData = await legacyProfile('identity-change')
    const service = legacyDataService(userData, path.join(userData, 'data'))
    await service.initialize()

    await rename(path.join(userData, 'drafts'), path.join(userData, 'drafts-preserved'))
    await mkdir(path.join(userData, 'drafts'))
    await writeFile(path.join(userData, 'drafts', 'replacement.json'), 'replacement')

    await expect(service.cleanup()).rejects.toThrow('旧数据目录标识已变化')
    await expect(readFile(path.join(userData, 'drafts', 'replacement.json'), 'utf8')).resolves.toBe(
      'replacement'
    )
    await expect(
      readFile(path.join(userData, 'drafts-preserved', 'draft.json'), 'utf8')
    ).resolves.toBe('draft')
  })
})

async function legacyProfile(label: string): Promise<string> {
  const userData = await temporaryDirectory(`ls101-legacy-${label}-`)
  await mkdir(path.join(userData, 'data'))
  await mkdir(path.join(userData, 'drafts'))
  await writeFile(path.join(userData, 'drafts', 'draft.json'), 'draft')
  await mkdir(path.join(userData, 'submissions', 'recordings'), { recursive: true })
  await writeFile(path.join(userData, 'submissions', 'recordings', '0.mp3'), 'audio')
  return userData
}

function legacyDataService(userData: string, current: string): LegacyDataService {
  return new LegacyDataService(userData, current, inProcessLegacyArchiveOperations)
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(directory)
  return directory
}

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, 'utf8')) as unknown
}
