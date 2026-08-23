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
import {
  inProcessLegacyArchiveOperations,
  type LegacyArchiveOperations
} from '../../src/main/legacy-data-archive'

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

  it('ignores legacy-named directories without an old version marker', async () => {
    const userData = await temporaryDirectory('ls101-managed-config-directory-')
    const current = path.join(userData, 'config')
    await mkdir(current)
    await writeFile(path.join(current, 'current.json'), '{"managed":true}')
    const service = legacyDataService(userData, current)

    await expect(service.initialize()).resolves.toMatchObject({ status: 'none' })
    expect(service.hasPendingCleanup()).toBe(false)
    await expect(readFile(path.join(current, 'current.json'), 'utf8')).resolves.toBe(
      '{"managed":true}'
    )
  })

  it.each(['0.4.0', '0.4.0-local.test', '1.0.0', 'not-a-version'])(
    'ignores legacy-named directories for version marker %s',
    async (version) => {
      const userData = await temporaryDirectory('ls101-current-version-marker-')
      const current = path.join(userData, 'data')
      await mkdir(current)
      await mkdir(path.join(userData, 'drafts'))
      await writeFile(path.join(userData, 'drafts', 'draft.json'), 'keep')
      await writeFile(path.join(userData, 'version'), version)
      const service = legacyDataService(userData, current)

      await expect(service.initialize()).resolves.toMatchObject({ status: 'none' })
      await expect(readFile(path.join(userData, 'drafts', 'draft.json'), 'utf8')).resolves.toBe(
        'keep'
      )
    }
  )

  it('removes an old version marker when no legacy directories remain', async () => {
    const userData = await temporaryDirectory('ls101-version-marker-only-')
    const current = path.join(userData, 'data')
    await mkdir(current)
    await writeFile(path.join(userData, 'version'), '0.3.2')
    const service = legacyDataService(userData, current)

    await expect(service.initialize()).resolves.toMatchObject({ status: 'none' })
    await expect(readFile(path.join(userData, 'version'))).rejects.toMatchObject({ code: 'ENOENT' })
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
    await expect(readFile(path.join(userData, 'version'))).rejects.toMatchObject({ code: 'ENOENT' })
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
    await writeFile(path.join(userData, 'version'), '0.3.2')
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

  it('rejects an archive that omits legacy business data', async () => {
    const userData = await legacyProfile('incomplete-business-archive')
    const incompleteArchiveOperations: LegacyArchiveOperations = {
      async create(request) {
        return {
          archiveSizeBytes: 0,
          archiveSha256: '0'.repeat(64),
          manifest: {
            formatVersion: 1,
            createdAt: request.createdAt,
            sourceDirectories: request.sourceDirectories,
            files: [],
            duplicateFiles: []
          }
        }
      },
      verify: inProcessLegacyArchiveOperations.verify
    }
    const service = new LegacyDataService(
      userData,
      path.join(userData, 'data'),
      incompleteArchiveOperations
    )

    await expect(service.initialize()).resolves.toMatchObject({
      status: 'error',
      error: expect.stringContaining('旧数据归档来源统计不匹配：drafts')
    })
    await expect(readFile(path.join(userData, 'drafts', 'draft.json'), 'utf8')).resolves.toBe(
      'draft'
    )
  })

  it('cleans identical legacy-copy residue without adding it to the ZIP', async () => {
    const userData = await temporaryDirectory('ls101-legacy-identical-residue-')
    const current = path.join(userData, 'data')
    await writeFile(path.join(userData, 'version'), '0.3.2')
    await mkdir(path.join(userData, 'config'))
    await mkdir(path.join(current, 'config'), { recursive: true })
    await writeFile(path.join(userData, 'config', 'settings.json'), '{"same":true}')
    await writeFile(path.join(current, 'config', 'settings.json'), '{"same":true}')
    const service = legacyDataService(userData, current)

    const archived = await service.initialize()
    const archive = unzipSync(new Uint8Array(await readFile(archived.archivePath!)))
    const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json'])) as {
      files: Array<{ path: string }>
      duplicateFiles: Array<{ path: string }>
    }

    expect(manifest.files).toEqual([])
    expect(manifest.duplicateFiles).toEqual([
      expect.objectContaining({ path: 'config/settings.json' })
    ])
    expect(archive['config/settings.json']).toBeUndefined()
    await expect(service.cleanup()).resolves.toMatchObject({ status: 'cleaned' })
    await expect(readFile(path.join(userData, 'config', 'settings.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(path.join(current, 'config', 'settings.json'), 'utf8')).resolves.toBe(
      '{"same":true}'
    )
  })

  it('archives only changed or missing files from legacy-copy residue', async () => {
    const userData = await temporaryDirectory('ls101-legacy-mixed-residue-')
    const current = path.join(userData, 'data')
    await writeFile(path.join(userData, 'version'), '0.3.2')
    await mkdir(path.join(userData, 'models'))
    await mkdir(path.join(current, 'models'), { recursive: true })
    await writeFile(path.join(userData, 'models', 'same.bin'), 'same')
    await writeFile(path.join(current, 'models', 'same.bin'), 'same')
    await writeFile(path.join(userData, 'models', 'changed.bin'), 'new-root-value')
    await writeFile(path.join(current, 'models', 'changed.bin'), 'old-data-value')
    await writeFile(path.join(userData, 'models', 'missing.bin'), 'root-only-value')
    const service = legacyDataService(userData, current)

    const archived = await service.initialize()
    const archive = unzipSync(new Uint8Array(await readFile(archived.archivePath!)))

    expect(archive['models/same.bin']).toBeUndefined()
    expect(new TextDecoder().decode(archive['models/changed.bin'])).toBe('new-root-value')
    expect(new TextDecoder().decode(archive['models/missing.bin'])).toBe('root-only-value')
    await expect(service.cleanup()).resolves.toMatchObject({ status: 'cleaned' })
    await expect(readFile(path.join(current, 'models', 'same.bin'), 'utf8')).resolves.toBe('same')
    await expect(readFile(path.join(current, 'models', 'changed.bin'), 'utf8')).resolves.toBe(
      'old-data-value'
    )
  })

  it('does not clean unarchived residue when the root copy changes after comparison', async () => {
    const { userData, current } = await identicalResidueProfile('root-change')
    const service = legacyDataService(userData, current)
    await service.initialize()
    await writeFile(path.join(userData, 'config', 'settings.json'), '{"same":nope}')

    await expect(service.cleanup()).rejects.toThrow('没有归档或相同的数据副本')
    await expect(readFile(path.join(userData, 'config', 'settings.json'), 'utf8')).resolves.toBe(
      '{"same":nope}'
    )
  })

  it('does not clean unarchived residue when the managed copy changes after comparison', async () => {
    const { userData, current } = await identicalResidueProfile('managed-change')
    const service = legacyDataService(userData, current)
    await service.initialize()
    await writeFile(path.join(current, 'config', 'settings.json'), '{"same":nope}')

    await expect(service.cleanup()).rejects.toThrow('没有归档或相同的数据副本')
    await expect(readFile(path.join(userData, 'config', 'settings.json'), 'utf8')).resolves.toBe(
      '{"same":true}'
    )
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

  it('does not clean legacy data when the version marker changes after archival', async () => {
    const userData = await legacyProfile('version-change')
    const service = legacyDataService(userData, path.join(userData, 'data'))
    await service.initialize()
    await writeFile(path.join(userData, 'version'), '0.3.1')

    await expect(service.cleanup()).rejects.toThrow('旧版版本标记已变化')
    await expect(readFile(path.join(userData, 'drafts', 'draft.json'), 'utf8')).resolves.toBe(
      'draft'
    )
    await expect(readFile(path.join(userData, 'version'), 'utf8')).resolves.toBe('0.3.1')
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
        movedDirectories: ['drafts'],
        deletingDirectories: [],
        versionDeletionStarted: false
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

  it('resumes recursive cleanup after an archived file was already deleted', async () => {
    const userData = await legacyProfile('resume-partial-delete')
    const current = path.join(userData, 'data')
    const target = await prepareInterruptedDirectoryDeletion(userData, current)
    await rm(path.join(target, 'draft.json'))

    const resumed = legacyDataService(userData, current)
    await expect(resumed.initialize()).resolves.toMatchObject({ status: 'cleaned' })
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(userData, 'version'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resumes recursive cleanup after an unarchived duplicate was already deleted', async () => {
    const { userData, current } = await identicalResidueProfile('resume-duplicate-delete')
    const target = await prepareInterruptedDirectoryDeletion(userData, current, 'config')
    await rm(path.join(target, 'settings.json'))

    const resumed = legacyDataService(userData, current)
    await expect(resumed.initialize()).resolves.toMatchObject({ status: 'cleaned' })
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(current, 'config', 'settings.json'), 'utf8')).resolves.toBe(
      '{"same":true}'
    )
  })

  it('refuses an unknown file left during resumed recursive cleanup', async () => {
    const userData = await legacyProfile('resume-partial-unknown')
    const current = path.join(userData, 'data')
    const target = await prepareInterruptedDirectoryDeletion(userData, current)
    await rm(path.join(target, 'draft.json'))
    await writeFile(path.join(target, 'unknown.json'), 'unknown')

    const resumed = legacyDataService(userData, current)
    await expect(resumed.initialize()).resolves.toMatchObject({
      status: 'cleaning',
      error: expect.stringContaining('没有归档或相同的数据副本')
    })
    await expect(readFile(path.join(target, 'unknown.json'), 'utf8')).resolves.toBe('unknown')
    await expect(readFile(path.join(userData, 'version'), 'utf8')).resolves.toBe('0.3.2')
  })

  it('refuses a modified file left during resumed recursive cleanup', async () => {
    const userData = await legacyProfile('resume-partial-modified')
    const current = path.join(userData, 'data')
    const target = await prepareInterruptedDirectoryDeletion(userData, current)
    await writeFile(path.join(target, 'draft.json'), 'other')

    const resumed = legacyDataService(userData, current)
    await expect(resumed.initialize()).resolves.toMatchObject({
      status: 'cleaning',
      error: expect.stringContaining('旧数据在归档后发生变化')
    })
    await expect(readFile(path.join(target, 'draft.json'), 'utf8')).resolves.toBe('other')
    await expect(readFile(path.join(userData, 'version'), 'utf8')).resolves.toBe('0.3.2')
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
        movedDirectories: [],
        deletingDirectories: [],
        versionDeletionStarted: false
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
        movedDirectories: [],
        deletingDirectories: [],
        versionDeletionStarted: false
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
  await writeFile(path.join(userData, 'version'), '0.3.2')
  await mkdir(path.join(userData, 'data'))
  await mkdir(path.join(userData, 'drafts'))
  await writeFile(path.join(userData, 'drafts', 'draft.json'), 'draft')
  await mkdir(path.join(userData, 'submissions', 'recordings'), { recursive: true })
  await writeFile(path.join(userData, 'submissions', 'recordings', '0.mp3'), 'audio')
  return userData
}

async function identicalResidueProfile(
  label: string
): Promise<{ userData: string; current: string }> {
  const userData = await temporaryDirectory(`ls101-legacy-identical-${label}-`)
  const current = path.join(userData, 'data')
  await writeFile(path.join(userData, 'version'), '0.3.2-dev.1')
  await mkdir(path.join(userData, 'config'))
  await mkdir(path.join(current, 'config'), { recursive: true })
  await writeFile(path.join(userData, 'config', 'settings.json'), '{"same":true}')
  await writeFile(path.join(current, 'config', 'settings.json'), '{"same":true}')
  return { userData, current }
}

async function prepareInterruptedDirectoryDeletion(
  userData: string,
  current: string,
  sourceName = 'drafts'
): Promise<string> {
  const first = legacyDataService(userData, current)
  await first.initialize()
  const journalPath = path.join(userData, LEGACY_DATA_JOURNAL_FILENAME)
  const journal = (await readJson(journalPath)) as Record<string, unknown>
  const quarantineRelativePath = '.legacy-archives-deleting-44444444-4444-4444-8444-444444444444'
  const quarantine = path.join(userData, quarantineRelativePath)
  const target = path.join(quarantine, sourceName)
  await mkdir(quarantine)
  const quarantineStats = await stat(quarantine)
  await rename(path.join(userData, sourceName), target)
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
      movedDirectories: [sourceName],
      deletingDirectories: [sourceName],
      versionDeletionStarted: false
    })
  )
  return target
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
