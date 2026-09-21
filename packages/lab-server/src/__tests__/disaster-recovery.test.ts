import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  stat,
  symlink
} from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { exportRawData, purgeExportedService } from '../disaster-recovery'
import { serviceRegistration } from '../local-status'
import { lockDirectory } from '../directory-lock'
import { manageLocalService } from '../local-manager'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, copyFile: vi.fn(fs.copyFile) }
})
vi.mock('../local-status', () => ({
  serviceRegistration: vi.fn(),
  installedPaths: vi.fn(() => {
    throw new Error('Corrupt installation.json')
  })
}))
afterEach(() => vi.resetAllMocks())

async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), 'ls101-disaster-'))
  onTestFinished(() => rm(temp, { recursive: true, force: true }))
  const paths = {
    root: join(temp, 'service/data'),
    program: join(temp, 'program'),
    runtime: join(temp, 'program/current'),
    source: join(temp, 'teacher-bundle'),
    unit: join(temp, 'ls101-lab.service')
  }
  const directory = join(temp, 'export')
  for (const path of [
    paths.root,
    paths.program,
    directory,
    join(temp, 'service/logs'),
    join(temp, 'service/.data.previous-example')
  ])
    await mkdir(path, { recursive: true })
  await writeFile(join(paths.root, 'service.sqlite'), 'unreadable database bytes')
  await writeFile(join(paths.root, 'service.sqlite-wal'), 'uncheckpointed committed records')
  await writeFile(join(paths.root, 'service-runtime.json'), '{broken')
  await writeFile(join(temp, 'service/logs/startup.log'), 'start failed')
  await writeFile(join(temp, 'service/.data.previous-example/answers'), 'original answers')
  await writeFile(join(paths.program, 'installation.json'), '{broken')
  await writeFile(paths.unit, 'test unit')
  const state = { installed: true, stopped: true, refuseDelete: false }
  vi.mocked(serviceRegistration).mockImplementation(async () => ({ ...state, autostart: false }))
  vi.mocked(execFile).mockImplementation((file, args, _options, callback: any) => {
    if (!state.refuseDelete && (args?.[0] === 'delete' || args?.[0] === 'daemon-reload'))
      state.installed = false
    callback(
      null,
      file === 'powershell.exe'
        ? JSON.stringify({ PathName: `"${join(paths.program, 'releases/old/LS101Lab.exe')}"` })
        : args?.includes('--property=FragmentPath')
          ? paths.unit
          : '',
      ''
    )
    return {} as any
  })
  const { uid, gid } = userInfo()
  const exportData = () => exportRawData(paths, { directory, owner: { uid, gid } })
  return { temp, paths, directory, exportData, state }
}

describe('raw export before destructive service removal', () => {
  it('preserves all originals when the export disk fills up', async () => {
    const f = await fixture()
    vi.mocked(copyFile).mockRejectedValueOnce(Object.assign(new Error('full'), { code: 'ENOSPC' }))
    await expect(f.exportData()).rejects.toMatchObject({ code: 'ENOSPC' })
    await expect(stat(join(f.directory, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.paths.root, 'service.sqlite'), 'utf8')).toBe(
      'unreadable database bytes'
    )
    expect(await stat(f.paths.program)).toBeDefined()
    expect(execFile).not.toHaveBeenCalled()
  })
  it('exports corrupt database, WAL, logs and previous data without parsing them; purges only after verification', async () => {
    const f = await fixture()
    const receipt = await f.exportData()
    expect(receipt.files).toBe(5)
    expect(
      await readFile(join(receipt.directory, 'original/data/service.sqlite-wal'), 'utf8')
    ).toBe('uncheckpointed committed records')
    expect(
      await readFile(join(receipt.directory, 'original/.data.previous-example/answers'), 'utf8')
    ).toBe('original answers')
    expect(await stat(join(f.paths.root, 'service.sqlite'))).toBeDefined()
    expect(await manageLocalService('purge', receipt, f.paths)).toMatchObject({
      state: 'not-installed'
    })
    await expect(stat(dirname(f.paths.root))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(f.paths.program)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(receipt.directory, 'original/data/service.sqlite'), 'utf8')).toBe(
      'unreadable database bytes'
    )
    // A lost helper response can be retried using the same verified export.
    await expect(purgeExportedService(f.paths, receipt)).resolves.toBeUndefined()
  })

  it('refuses running services before copying or touching registration', async () => {
    const f = await fixture()
    f.state.stopped = false
    await expect(f.exportData()).rejects.toMatchObject({ code: 'LOCAL_RECOVERY_SERVICE_RUNNING' })
    expect(await readdir(f.directory)).toEqual([])
    expect(execFile).not.toHaveBeenCalled()
  })

  it('refuses a surviving process that still holds the data lock', async () => {
    const f = await fixture()
    const lock = await lockDirectory(f.paths.root)
    try {
      await expect(f.exportData()).rejects.toMatchObject({ code: 'RESOURCE_BUSY' })
    } finally {
      lock.close()
    }
    expect(await readdir(f.directory)).toEqual([])
  })

  it.each(['export', 'manifest', 'source', 'new-file'])(
    'keeps original data if %s changed after export',
    async (change) => {
      const f = await fixture()
      const receipt = await f.exportData()
      const path =
        change === 'export'
          ? join(f.directory, 'original/data/service.sqlite')
          : change === 'manifest'
            ? join(f.directory, 'manifest.json')
            : join(f.paths.root, change === 'new-file' ? 'new-answer' : 'service.sqlite')
      await writeFile(path, 'changed')
      await expect(purgeExportedService(f.paths, receipt)).rejects.toMatchObject({
        code:
          change === 'export' || change === 'manifest'
            ? 'LOCAL_RECOVERY_EXPORT_CHANGED'
            : 'LOCAL_RECOVERY_SOURCE_CHANGED'
      })
      expect(await stat(f.paths.root)).toBeDefined()
      expect(await stat(f.paths.program)).toBeDefined()
      expect(execFile).not.toHaveBeenCalled()
    }
  )

  it('refuses export inside the directory that would be deleted', async () => {
    const f = await fixture()
    const directory = join(f.paths.root, 'export')
    await mkdir(directory)
    await expect(exportRawData(f.paths, { directory, owner: userInfo() })).rejects.toMatchObject({
      code: 'LOCAL_RECOVERY_UNSAFE_PATH'
    })
  })

  it('rejects links to data outside the service rather than following them', async () => {
    const f = await fixture()
    const outside = join(f.temp, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'private'), 'unrelated')
    await symlink(
      outside,
      join(f.paths.root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    await expect(f.exportData()).rejects.toMatchObject({ code: 'LOCAL_RECOVERY_UNSAFE_PATH' })
    expect(await readFile(join(outside, 'private'), 'utf8')).toBe('unrelated')
  })

  it('does not delete data while service registration remains pending removal', async () => {
    const f = await fixture()
    const receipt = await f.exportData()
    f.state.refuseDelete = true
    await expect(purgeExportedService(f.paths, receipt)).rejects.toMatchObject({
      code: 'LOCAL_RECOVERY_OS_FAILED'
    })
    expect(await stat(join(f.paths.root, 'service.sqlite'))).toBeDefined()
    expect(await stat(f.paths.program)).toBeDefined()
  })

  it('refuses to remove a registration that points outside the installed service', async () => {
    const f = await fixture()
    const receipt = await f.exportData()
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback: any) => {
      callback(
        null,
        process.platform === 'win32'
          ? JSON.stringify({ PathName: 'C:\\OtherService\\LS101Lab.exe' })
          : '/other-service.service',
        ''
      )
      return {} as any
    })
    await expect(purgeExportedService(f.paths, receipt)).rejects.toMatchObject({
      code: 'LOCAL_SERVICE_IDENTITY_MISMATCH'
    })
    expect(await stat(join(f.paths.root, 'service.sqlite'))).toBeDefined()
    expect(await stat(f.paths.program)).toBeDefined()
  })

  it('permits cleanup retry after partial file deletion without losing the complete export', async () => {
    const f = await fixture()
    const receipt = await f.exportData()
    await rm(join(f.paths.root, 'service.sqlite'))
    f.state.installed = false
    await purgeExportedService(f.paths, receipt)
    expect(await readFile(join(f.directory, 'original/data/service.sqlite'), 'utf8')).toBe(
      'unreadable database bytes'
    )
  })
})
