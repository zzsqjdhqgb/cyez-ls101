import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_DIRECTORY_CHANNELS } from '@ls101/core-types'

type IpcHandler = (event: { sender: object }, ...args: never[]) => unknown

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  class BrowserWindowMock {
    static fromWebContents(): null {
      return null
    }

    destroy = vi.fn()
    isDestroyed = vi.fn(() => false)
    loadURL = vi.fn().mockResolvedValue(undefined)
    once = vi.fn()
    removeMenu = vi.fn()
  }
  return {
    app: { exit: vi.fn(), relaunch: vi.fn() },
    BrowserWindow: BrowserWindowMock,
    dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler))
    }
  }
})

vi.mock('electron', () => ({
  app: electronMocks.app,
  BrowserWindow: electronMocks.BrowserWindow,
  dialog: electronMocks.dialog,
  ipcMain: electronMocks.ipcMain
}))

import {
  initializeDataDirectory,
  recoverDataDirectory,
  registerDataDirectoryHandlers
} from '../../src/main/data-directory'

let roots: string[]

beforeEach(() => {
  roots = []
  electronMocks.handlers.clear()
  vi.useFakeTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })))
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(directory)
  return directory
}

describe('data directory initialization', () => {
  it('creates a managed default directory for a fresh profile', async () => {
    const userData = await temporaryDirectory('ls101-data-fresh-')
    const result = await initializeDataDirectory(userData)

    expect(result).toBe(path.join(userData, 'data'))
    await expect(readJson(path.join(result, '.ls101-data.json'))).resolves.toMatchObject({
      formatVersion: 1,
      kind: 'ls101-data-directory'
    })
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: result
    })
  })

  it('copies only known legacy business data into the managed directory', async () => {
    const userData = await temporaryDirectory('ls101-data-legacy-')
    await mkdir(path.join(userData, 'template-editor'), { recursive: true })
    await writeFile(path.join(userData, 'template-editor', 'draft.json'), '{"draft":true}')
    await mkdir(path.join(userData, 'models', 'tts'), { recursive: true })
    await writeFile(path.join(userData, 'models', 'tts', 'model.bin'), 'model')
    await mkdir(path.join(userData, 'Cache'))
    await writeFile(path.join(userData, 'Cache', 'cache.bin'), 'cache')
    await mkdir(path.join(userData, 'qwen-tts-runtime'))
    await writeFile(path.join(userData, 'qwen-tts-runtime', 'runtime.bin'), 'runtime')

    const result = await initializeDataDirectory(userData)

    await expect(
      readFile(path.join(result, 'template-editor', 'draft.json'), 'utf8')
    ).resolves.toBe('{"draft":true}')
    await expect(readFile(path.join(result, 'models', 'tts', 'model.bin'), 'utf8')).resolves.toBe(
      'model'
    )
    await expect(readFile(path.join(result, 'Cache', 'cache.bin'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(
      readFile(path.join(result, 'qwen-tts-runtime', 'runtime.bin'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('finishes a scheduled copy on the next initialization and retains the source', async () => {
    const userData = await temporaryDirectory('ls101-data-copy-')
    const targetParent = await temporaryDirectory('ls101-data-target-')
    const target = path.join(targetParent, 'selected')
    await mkdir(target)
    const source = await initializeDataDirectory(userData)
    await writeFile(path.join(source, 'document.json'), '{"value":1}')
    registerDataDirectoryHandlers(userData, source)
    const migrate = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.migrate)
    expect(migrate).toBeDefined()
    await expect(migrate!({ sender: {} }, target as never)).resolves.toBeUndefined()

    const result = await initializeDataDirectory(userData)
    expect(result).toBe(target)
    await expect(readFile(path.join(target, 'document.json'), 'utf8')).resolves.toBe('{"value":1}')
    await expect(readFile(path.join(source, 'document.json'), 'utf8')).resolves.toBe('{"value":1}')
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: target
    })
  })

  it('requires deleting the recorded old directory before another migration', async () => {
    const { userData, source, target } = await scheduledCopy('delete-old-before-next')
    await initializeDataDirectory(userData)
    registerDataDirectoryHandlers(userData, target)
    const getInfo = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.getInfo)
    const migrate = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.migrate)
    const deleteOld = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.deleteOld)
    expect(getInfo).toBeDefined()
    expect(migrate).toBeDefined()
    expect(deleteOld).toBeDefined()

    await expect(getInfo!({ sender: {} })).resolves.toMatchObject({
      currentPath: target,
      oldDataDirectory: {
        path: source,
        deleting: false
      }
    })
    const nextTarget = path.join(await temporaryDirectory('ls101-data-next-'), 'selected')
    await mkdir(nextTarget)
    await expect(migrate!({ sender: {} }, nextTarget as never)).rejects.toThrow(
      '请先删除旧数据目录，再更改数据位置'
    )

    await expect(deleteOld!({ sender: {} })).resolves.toBeUndefined()
    await expect(readFile(path.join(source, 'document.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(getInfo!({ sender: {} })).resolves.toMatchObject({ oldDataDirectory: null })
    await expect(migrate!({ sender: {} }, nextTarget as never)).resolves.toBeUndefined()
  })

  it('does not delete an old path whose directory identity changed', async () => {
    const { userData, source, target } = await scheduledCopy('old-identity-changed')
    await initializeDataDirectory(userData)
    await writeFile(
      path.join(source, '.ls101-data.json'),
      JSON.stringify({
        formatVersion: 1,
        kind: 'ls101-data-directory',
        directoryId: '44444444-4444-4444-8444-444444444444'
      })
    )
    registerDataDirectoryHandlers(userData, target)
    const deleteOld = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.deleteOld)
    expect(deleteOld).toBeDefined()

    await expect(deleteOld!({ sender: {} })).rejects.toThrow('旧数据目录标识不匹配')
    await expect(readFile(path.join(source, 'document.json'), 'utf8')).resolves.toBe(
      '{"source":"old-identity-changed"}'
    )
  })

  it('resumes old directory deletion after the source was renamed before the claim was saved', async () => {
    const { userData, source, target } = await scheduledCopy('resume-old-deletion')
    await initializeDataDirectory(userData)
    const bootstrapPath = path.join(userData, 'data-location.json')
    const ready = (await readJson(bootstrapPath)) as Record<string, unknown>
    const oldDataDirectory = ready.oldDataDirectory as Record<string, unknown>
    const deletionPath = path.join(
      path.dirname(source),
      `.${path.basename(source)}.deleting-${String(oldDataDirectory.directoryId)}`
    )
    await rename(source, deletionPath)
    await writeFile(
      bootstrapPath,
      JSON.stringify({
        ...ready,
        oldDataDirectory: {
          ...oldDataDirectory,
          deleting: true,
          deletionPath
        }
      })
    )

    await expect(initializeDataDirectory(userData)).resolves.toBe(target)
    await expect(readFile(path.join(deletionPath, 'document.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readJson(bootstrapPath)).resolves.not.toHaveProperty('oldDataDirectory')
  })

  it('does not resume deletion when the claimed hidden directory identity changed', async () => {
    const { userData, source, target } = await scheduledCopy('changed-deletion-identity')
    await initializeDataDirectory(userData)
    const bootstrapPath = path.join(userData, 'data-location.json')
    const ready = (await readJson(bootstrapPath)) as Record<string, unknown>
    const oldDataDirectory = ready.oldDataDirectory as Record<string, unknown>
    const deletionPath = path.join(
      path.dirname(source),
      `.${path.basename(source)}.deleting-${String(oldDataDirectory.directoryId)}`
    )
    await rename(source, deletionPath)
    const deletionStats = await stat(deletionPath)
    await writeFile(
      bootstrapPath,
      JSON.stringify({
        ...ready,
        oldDataDirectory: {
          ...oldDataDirectory,
          deleting: true,
          deletionPath,
          deletionClaimed: true,
          deletionIdentity: {
            device: String(deletionStats.dev),
            inode: `${deletionStats.ino}-changed`
          }
        }
      })
    )
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(initializeDataDirectory(userData)).resolves.toBe(target)
    await expect(readFile(path.join(deletionPath, 'document.json'), 'utf8')).resolves.toBe(
      '{"source":"changed-deletion-identity"}'
    )
    await expect(readJson(bootstrapPath)).resolves.toHaveProperty(
      'oldDataDirectory.deletionClaimed',
      true
    )
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete old data directory'),
      expect.objectContaining({ message: '旧数据删除路径身份不匹配' })
    )
    warning.mockRestore()
  })

  it('rejects ordinary non-empty migration targets', async () => {
    const userData = await temporaryDirectory('ls101-data-reject-')
    const target = await temporaryDirectory('ls101-data-nonempty-')
    await writeFile(path.join(target, 'unrelated.txt'), 'keep')
    const source = await initializeDataDirectory(userData)
    registerDataDirectoryHandlers(userData, source)
    const migrate = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.migrate)
    expect(migrate).toBeDefined()

    await expect(migrate!({ sender: {} }, target as never)).rejects.toThrow(
      '请选择空目录，或选择一个已有的 LS101 数据目录'
    )
    await expect(readFile(path.join(target, 'unrelated.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('rejects a filesystem root before scheduling a migration', async () => {
    const userData = await temporaryDirectory('ls101-data-root-target-')
    const source = await initializeDataDirectory(userData)
    registerDataDirectoryHandlers(userData, source)
    const migrate = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.migrate)
    expect(migrate).toBeDefined()

    await expect(migrate!({ sender: {} }, path.parse(process.cwd()).root as never)).rejects.toThrow(
      '不能选择文件系统根目录或挂载点，请在其中新建一个空目录'
    )
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: source
    })
  })

  it.skipIf(process.platform !== 'linux')(
    'rejects a Linux mount point before scheduling a migration',
    async () => {
      const userData = await temporaryDirectory('ls101-data-mount-target-')
      const source = await initializeDataDirectory(userData)
      registerDataDirectoryHandlers(userData, source)
      const migrate = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.migrate)
      expect(migrate).toBeDefined()

      await expect(migrate!({ sender: {} }, '/proc' as never)).rejects.toThrow(
        '不能选择文件系统根目录或挂载点，请在其中新建一个空目录'
      )
    }
  )

  it('preserves files written to the target after migration is scheduled', async () => {
    const { userData, target, migration } = await scheduledCopy('target-race')
    await writeFile(path.join(target, 'external.txt'), 'do not delete')

    await expect(initializeDataDirectory(userData)).rejects.toThrow(
      '迁移目标在复制期间被写入，已停止迁移并保留目标内容'
    )

    await expect(readFile(path.join(target, 'external.txt'), 'utf8')).resolves.toBe('do not delete')
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'migrating',
      migrationId: migration.migrationId
    })
    await expect(readJson(path.join(migration.staging, '.ls101-data.json'))).resolves.toMatchObject(
      {
        migrationId: migration.migrationId
      }
    )
  })

  it('removes an incomplete owned staging directory and restarts the copy', async () => {
    const { userData, source, target, migration } = await scheduledCopy('partial-staging')
    await mkdir(migration.staging)
    await writeFile(path.join(migration.staging, 'partial.bin'), 'partial')
    await recordStagingIdentity(userData, migration.staging)

    const result = await initializeDataDirectory(userData)

    expect(result).toBe(target)
    await expect(readFile(path.join(target, 'document.json'), 'utf8')).resolves.toBe(
      await readFile(path.join(source, 'document.json'), 'utf8')
    )
    await expect(readFile(path.join(target, 'partial.bin'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('commits a completed staging directory when the empty target was already removed', async () => {
    const { userData, target, migration } = await scheduledCopy('removed-target')
    await rm(target, { recursive: true })
    await mkdir(migration.staging)
    await writeFile(path.join(migration.staging, 'document.json'), '{"from":"staging"}')
    await writeMigrationMarker(migration.staging, migration.migrationId)

    const result = await initializeDataDirectory(userData)

    expect(result).toBe(target)
    await expect(readFile(path.join(target, 'document.json'), 'utf8')).resolves.toBe(
      '{"from":"staging"}'
    )
  })

  it('commits ready when staging was already renamed to the target', async () => {
    const { userData, source, target, migration } = await scheduledCopy('renamed-target')
    await rm(target, { recursive: true })
    await mkdir(target)
    await writeFile(path.join(target, 'document.json'), '{"from":"target"}')
    await writeMigrationMarker(target, migration.migrationId)
    await mkdir(migration.staging)
    await writeFile(path.join(migration.staging, 'orphan.bin'), 'owned staging')
    await recordStagingIdentity(userData, migration.staging)
    await rm(source, { recursive: true })

    const result = await initializeDataDirectory(userData)

    expect(result).toBe(target)
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: target
    })
    await expect(readFile(path.join(migration.staging, 'orphan.bin'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('preserves a default target written while legacy data is being organized', async () => {
    const userData = await temporaryDirectory('ls101-data-legacy-race-')
    const target = path.join(userData, 'data')
    await mkdir(path.join(userData, 'config'), { recursive: true })
    await writeFile(path.join(userData, 'config', 'settings.json'), '{}')
    await mkdir(target)
    await writeFile(path.join(target, 'external.txt'), 'keep')

    await expect(initializeDataDirectory(userData)).rejects.toThrow(
      '迁移目标在复制期间被写入，已停止迁移并保留目标内容'
    )
    await expect(readFile(path.join(target, 'external.txt'), 'utf8')).resolves.toBe('keep')

    await rm(path.join(target, 'external.txt'))
    await expect(initializeDataDirectory(userData)).resolves.toBe(target)
    await expect(readFile(path.join(target, 'config', 'settings.json'), 'utf8')).resolves.toBe('{}')
  })

  it('removes owned staging before abandoning a failed migration', async () => {
    const { userData, source, target, migration } = await scheduledCopy('abandon-staging')
    await writeFile(path.join(target, 'external.txt'), 'blocks commit')
    await expect(initializeDataDirectory(userData)).rejects.toThrow('迁移目标在复制期间被写入')
    await expect(readFile(path.join(migration.staging, 'document.json'), 'utf8')).resolves.toBe(
      '{"source":"abandon-staging"}'
    )
    electronMocks.dialog.showMessageBox
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 2 })
    electronMocks.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [source]
    })
    const exit = new Error('exit')
    electronMocks.app.exit
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw exit
      })

    await expect(recoverDataDirectory(userData, new Error('migration failed'))).rejects.toBe(exit)

    await expect(readFile(path.join(migration.staging, 'document.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: source
    })
  })

  it('retains an offline staging cleanup and removes it after the volume returns', async () => {
    const { userData, source, target, migration } = await scheduledCopy('offline-staging')
    await writeFile(path.join(target, 'external.txt'), 'blocks commit')
    await expect(initializeDataDirectory(userData)).rejects.toThrow('迁移目标在复制期间被写入')

    const targetParent = path.dirname(target)
    const offlineParent = `${targetParent}-offline`
    roots.push(offlineParent)
    await rename(targetParent, offlineParent)
    electronMocks.dialog.showMessageBox
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 2 })
    electronMocks.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [source]
    })
    const exit = new Error('exit')
    electronMocks.app.exit
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw exit
      })

    await expect(recoverDataDirectory(userData, new Error('volume offline'))).rejects.toBe(exit)
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: source,
      pendingCleanups: [
        {
          migrationId: migration.migrationId,
          target,
          staging: migration.staging
        }
      ]
    })

    await rename(offlineParent, targetParent)
    await expect(initializeDataDirectory(userData)).resolves.toBe(source)
    await expect(readFile(path.join(migration.staging, 'document.json'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    const ready = (await readJson(path.join(userData, 'data-location.json'))) as Record<
      string,
      unknown
    >
    expect(ready).not.toHaveProperty('pendingCleanups')
  })

  it('preserves ready cleanup records when recovery selects another managed directory', async () => {
    const { userData, source, target } = await scheduledCopy('ready-recovery-cleanups')
    await initializeDataDirectory(userData)
    const bootstrapPath = path.join(userData, 'data-location.json')
    const ready = (await readJson(bootstrapPath)) as Record<string, unknown>
    const oldDataDirectory = ready.oldDataDirectory as Record<string, unknown>
    const deletionPath = path.join(
      path.dirname(source),
      `.${path.basename(source)}.deleting-${String(oldDataDirectory.directoryId)}`
    )
    const cleanupParent = await temporaryDirectory('ls101-data-ready-cleanup-')
    const cleanupParentStats = await stat(cleanupParent)
    const cleanupTarget = path.join(cleanupParent, 'abandoned')
    const cleanupId = '55555555-5555-4555-8555-555555555555'
    const cleanupStaging = path.join(cleanupParent, `.abandoned.migrating-${cleanupId}`)
    await mkdir(cleanupStaging)
    await writeMigrationMarker(cleanupStaging, cleanupId)
    const selected = await temporaryDirectory('ls101-data-ready-selected-')
    await writeManagedMarker(selected)
    await writeFile(
      bootstrapPath,
      JSON.stringify({
        ...ready,
        pendingCleanups: [
          {
            migrationId: cleanupId,
            target: cleanupTarget,
            staging: cleanupStaging,
            parentPath: cleanupParent,
            parentIdentity: {
              device: String(cleanupParentStats.dev),
              inode: String(cleanupParentStats.ino)
            }
          }
        ],
        oldDataDirectory: {
          ...oldDataDirectory,
          deleting: true,
          deletionPath
        }
      })
    )
    const targetParent = path.dirname(target)
    const offlineTargetParent = `${targetParent}-offline`
    roots.push(offlineTargetParent)
    await rename(targetParent, offlineTargetParent)
    electronMocks.dialog.showMessageBox
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 2 })
    electronMocks.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [selected]
    })
    const exit = new Error('exit')
    electronMocks.app.exit
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw exit
      })

    await expect(recoverDataDirectory(userData, new Error('active volume offline'))).rejects.toBe(
      exit
    )

    await expect(readJson(bootstrapPath)).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: selected,
      pendingCleanups: [{ migrationId: cleanupId, staging: cleanupStaging }],
      oldDataDirectory: {
        path: source,
        deleting: true,
        deletionPath
      }
    })
  })

  it('rejects selecting the old path when its directory marker identity changed', async () => {
    const { userData, source, target } = await scheduledCopy('recovery-old-marker-changed')
    await initializeDataDirectory(userData)
    const bootstrapPath = path.join(userData, 'data-location.json')
    const ready = (await readJson(bootstrapPath)) as Record<string, unknown>
    const oldDataDirectory = ready.oldDataDirectory as Record<string, unknown>
    await writeFile(
      path.join(source, '.ls101-data.json'),
      JSON.stringify({
        formatVersion: 1,
        kind: 'ls101-data-directory',
        directoryId: '99999999-9999-4999-8999-999999999999'
      })
    )
    const exit = new Error('exit')
    electronMocks.dialog.showMessageBox
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 2 })
    electronMocks.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [source]
    })
    electronMocks.app.exit.mockImplementationOnce(() => {
      throw exit
    })

    await expect(recoverDataDirectory(userData, new Error('active volume offline'))).rejects.toBe(
      exit
    )
    await expect(readJson(bootstrapPath)).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: target,
      oldDataDirectory
    })
  })

  it('rejects selecting the old path when its parent identity changed', async () => {
    const { userData, source, target } = await scheduledCopy('recovery-old-parent-changed')
    await initializeDataDirectory(userData)
    const bootstrapPath = path.join(userData, 'data-location.json')
    const ready = (await readJson(bootstrapPath)) as Record<string, unknown>
    const oldDataDirectory = ready.oldDataDirectory as Record<string, unknown>
    await writeFile(
      bootstrapPath,
      JSON.stringify({
        ...ready,
        oldDataDirectory: {
          ...oldDataDirectory,
          parentIdentity: {
            device: 'wrong-device',
            inode: 'wrong-inode'
          }
        }
      })
    )
    const exit = new Error('exit')
    electronMocks.dialog.showMessageBox
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 2 })
    electronMocks.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [source]
    })
    electronMocks.app.exit.mockImplementationOnce(() => {
      throw exit
    })

    await expect(recoverDataDirectory(userData, new Error('active volume offline'))).rejects.toBe(
      exit
    )
    await expect(readJson(bootstrapPath)).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: target,
      oldDataDirectory: {
        path: source,
        directoryId: oldDataDirectory.directoryId,
        parentPath: oldDataDirectory.parentPath,
        parentIdentity: {
          device: 'wrong-device',
          inode: 'wrong-inode'
        }
      }
    })
  })

  it('clears a missing staging cleanup when its recorded parent is still online', async () => {
    const userData = await temporaryDirectory('ls101-data-missing-cleanup-')
    const source = await initializeDataDirectory(userData)
    const cleanupParent = await temporaryDirectory('ls101-data-missing-cleanup-parent-')
    const cleanupParentStats = await stat(cleanupParent)
    const migrationId = '66666666-6666-4666-8666-666666666666'
    await writeFile(
      path.join(userData, 'data-location.json'),
      JSON.stringify({
        formatVersion: 1,
        state: 'ready',
        activeDataDirectory: source,
        pendingCleanups: [
          {
            migrationId,
            target: path.join(cleanupParent, 'missing'),
            staging: path.join(cleanupParent, `.missing.migrating-${migrationId}`),
            parentPath: cleanupParent,
            parentIdentity: {
              device: String(cleanupParentStats.dev),
              inode: String(cleanupParentStats.ino)
            }
          }
        ]
      })
    )

    await expect(initializeDataDirectory(userData)).resolves.toBe(source)
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.not.toHaveProperty(
      'pendingCleanups'
    )
  })

  it('does not delete a staging path under a replacement parent directory', async () => {
    const userData = await temporaryDirectory('ls101-data-replaced-cleanup-parent-')
    const source = await initializeDataDirectory(userData)
    const cleanupParent = await temporaryDirectory('ls101-data-original-cleanup-parent-')
    const cleanupParentStats = await stat(cleanupParent)
    const offlineCleanupParent = `${cleanupParent}-offline`
    roots.push(offlineCleanupParent)
    await rename(cleanupParent, offlineCleanupParent)
    await mkdir(cleanupParent)
    const migrationId = '77777777-7777-4777-8777-777777777777'
    const staging = path.join(cleanupParent, `.replacement.migrating-${migrationId}`)
    await mkdir(staging)
    await writeFile(path.join(staging, 'unrelated.txt'), 'keep')
    await writeFile(
      path.join(userData, 'data-location.json'),
      JSON.stringify({
        formatVersion: 1,
        state: 'ready',
        activeDataDirectory: source,
        pendingCleanups: [
          {
            migrationId,
            target: path.join(cleanupParent, 'replacement'),
            staging,
            parentPath: cleanupParent,
            parentIdentity: {
              device: String(cleanupParentStats.dev),
              inode: String(cleanupParentStats.ino)
            }
          }
        ]
      })
    )

    await expect(initializeDataDirectory(userData)).resolves.toBe(source)
    await expect(readFile(path.join(staging, 'unrelated.txt'), 'utf8')).resolves.toBe('keep')
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toHaveProperty(
      'pendingCleanups.0.staging',
      staging
    )
  })

  it('does not delete an unclaimed non-empty staging path under the original parent', async () => {
    const userData = await temporaryDirectory('ls101-data-unclaimed-cleanup-')
    const source = await initializeDataDirectory(userData)
    const cleanupParent = await temporaryDirectory('ls101-data-unclaimed-cleanup-parent-')
    const cleanupParentStats = await stat(cleanupParent)
    const migrationId = '88888888-8888-4888-8888-888888888888'
    const staging = path.join(cleanupParent, `.unclaimed.migrating-${migrationId}`)
    await mkdir(staging)
    await writeFile(path.join(staging, 'unrelated.txt'), 'keep')
    await writeFile(
      path.join(userData, 'data-location.json'),
      JSON.stringify({
        formatVersion: 1,
        state: 'ready',
        activeDataDirectory: source,
        pendingCleanups: [
          {
            migrationId,
            target: path.join(cleanupParent, 'unclaimed'),
            staging,
            parentPath: cleanupParent,
            parentIdentity: {
              device: String(cleanupParentStats.dev),
              inode: String(cleanupParentStats.ino)
            }
          }
        ]
      })
    )
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(initializeDataDirectory(userData)).resolves.toBe(source)
    await expect(readFile(path.join(staging, 'unrelated.txt'), 'utf8')).resolves.toBe('keep')
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toHaveProperty(
      'pendingCleanups.0.staging',
      staging
    )
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clean pending data migration staging directory'),
      expect.objectContaining({ message: '迁移暂存路径所有权无法确认，未执行清理' })
    )
    warning.mockRestore()
  })

  it('preserves deferred cleanups through a later migration', async () => {
    const userData = await temporaryDirectory('ls101-data-deferred-cleanup-')
    const source = await initializeDataDirectory(userData)
    const abandonedParent = await temporaryDirectory('ls101-data-abandoned-volume-')
    const abandonedTarget = path.join(abandonedParent, 'data')
    const migrationId = '22222222-2222-4222-8222-222222222222'
    const abandonedStaging = path.join(abandonedParent, `.data.migrating-${migrationId}`)
    const abandonedParentStats = await stat(abandonedParent)
    const offlineAbandonedParent = `${abandonedParent}-offline`
    roots.push(offlineAbandonedParent)
    await rename(abandonedParent, offlineAbandonedParent)
    await writeFile(
      path.join(userData, 'data-location.json'),
      JSON.stringify({
        formatVersion: 1,
        state: 'ready',
        activeDataDirectory: source,
        pendingCleanups: [
          {
            migrationId,
            target: abandonedTarget,
            staging: abandonedStaging,
            parentPath: abandonedParent,
            parentIdentity: {
              device: String(abandonedParentStats.dev),
              inode: String(abandonedParentStats.ino)
            }
          }
        ]
      })
    )
    await initializeDataDirectory(userData)

    const targetParent = await temporaryDirectory('ls101-data-next-target-')
    const target = path.join(targetParent, 'selected')
    await mkdir(target)
    registerDataDirectoryHandlers(userData, source)
    const migrate = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.migrate)
    expect(migrate).toBeDefined()
    await migrate!({ sender: {} }, target as never)

    await expect(initializeDataDirectory(userData)).resolves.toBe(target)
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: target,
      pendingCleanups: [
        {
          migrationId,
          target: abandonedTarget,
          staging: abandonedStaging
        }
      ]
    })
  })
})

interface StoredMigration {
  migrationId: string
  staging: string
}

async function scheduledCopy(label: string): Promise<{
  userData: string
  source: string
  target: string
  migration: StoredMigration
}> {
  const userData = await temporaryDirectory(`ls101-data-${label}-`)
  const targetParent = await temporaryDirectory(`ls101-data-${label}-target-`)
  const target = path.join(targetParent, 'selected')
  await mkdir(target)
  const source = await initializeDataDirectory(userData)
  await writeFile(path.join(source, 'document.json'), `{"source":"${label}"}`)
  registerDataDirectoryHandlers(userData, source)
  const migrate = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.migrate)
  expect(migrate).toBeDefined()
  await migrate!({ sender: {} }, target as never)
  const stored = (await readJson(path.join(userData, 'data-location.json'))) as Record<
    string,
    unknown
  >
  expect(stored).toMatchObject({ state: 'migrating', mode: 'copy' })
  return {
    userData,
    source,
    target,
    migration: {
      migrationId: String(stored.migrationId),
      staging: String(stored.staging)
    }
  }
}

async function writeMigrationMarker(directory: string, migrationId: string): Promise<void> {
  await writeFile(
    path.join(directory, '.ls101-data.json'),
    JSON.stringify({ formatVersion: 1, kind: 'ls101-data-directory', migrationId })
  )
}

async function writeManagedMarker(directory: string): Promise<void> {
  await writeFile(
    path.join(directory, '.ls101-data.json'),
    JSON.stringify({ formatVersion: 1, kind: 'ls101-data-directory' })
  )
}

async function recordStagingIdentity(userData: string, staging: string): Promise<void> {
  const bootstrapPath = path.join(userData, 'data-location.json')
  const bootstrap = (await readJson(bootstrapPath)) as Record<string, unknown>
  const stagingStats = await stat(staging)
  await writeFile(
    bootstrapPath,
    JSON.stringify({
      ...bootstrap,
      stagingIdentity: {
        device: String(stagingStats.dev),
        inode: String(stagingStats.ino)
      }
    })
  )
}

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, 'utf8')) as unknown
}
