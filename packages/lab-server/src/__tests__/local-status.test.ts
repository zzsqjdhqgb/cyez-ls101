import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectLocalService } from '../local-status'
import { readServiceStatus } from '../status-channel'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('../status-channel', () => ({ readServiceStatus: vi.fn() }))
const directories: string[] = []
afterEach(async () => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})

describe.each(['linux', 'win32'])('unprivileged service inspection on %s', (platform) => {
  async function fixture(stopped: boolean) {
    const parent = await mkdtemp(join(tmpdir(), 'ls101-status-'))
    directories.push(parent)
    const paths = {
      root: join(parent, 'private-data'),
      runtime: join(parent, 'runtime'),
      source: parent
    }
    await mkdir(paths.runtime)
    await writeFile(
      join(paths.runtime, 'runtime-manifest.json'),
      JSON.stringify({ releaseVersion: 'test' })
    )
    vi.stubGlobal('process', { ...process, platform })
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback: any) => {
      callback(
        null,
        platform === 'linux'
          ? `LoadState=loaded\nActiveState=${stopped ? 'inactive' : 'active'}\nUnitFileState=enabled`
          : JSON.stringify({ State: stopped ? 'Stopped' : 'Running', StartMode: 'Auto' }),
        ''
      )
      return {} as any
    })
    return paths
  }

  it('reads status through the public channel without reading private data or elevating', async () => {
    const paths = await fixture(false)
    vi.mocked(readServiceStatus).mockResolvedValue({
      state: 'running',
      releaseVersion: 'test',
      info: { name: 'Lab' }
    } as any)
    await expect(inspectLocalService(paths)).resolves.toMatchObject({
      state: 'running',
      autostart: true,
      info: { name: 'Lab' }
    })
    expect(readServiceStatus).toHaveBeenCalledWith(paths.root)
    expect(execFile).toHaveBeenCalledTimes(1)
    const [command, args] = vi.mocked(execFile).mock.calls[0]
    expect(command).toBe(platform === 'linux' ? 'systemctl' : 'powershell.exe')
    expect(String(args)).not.toMatch(/RunAs|Start-Process|pkexec/)
  })

  it('reports stopped with unknown private fields without requesting the runtime', async () => {
    const paths = await fixture(true)
    await expect(inspectLocalService(paths)).resolves.toMatchObject({
      state: 'stopped',
      autostart: true,
      port: null,
      settings: null
    })
    expect(readServiceStatus).not.toHaveBeenCalled()
  })

  it('reports unavailable rather than stopped or elevating when the public channel fails', async () => {
    const paths = await fixture(false)
    vi.mocked(readServiceStatus).mockRejectedValue(new Error('access denied'))
    await expect(inspectLocalService(paths)).resolves.toMatchObject({
      state: 'unavailable',
      error: 'LOCAL_STATUS_UNAVAILABLE'
    })
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('waits briefly for the public channel while a service is starting', async () => {
    const paths = await fixture(false)
    vi.mocked(readServiceStatus)
      .mockRejectedValueOnce(Object.assign(new Error('not ready'), { code: 'ECONNREFUSED' }))
      .mockResolvedValueOnce({
        state: 'running',
        releaseVersion: 'test',
        info: { name: 'Lab' }
      } as any)
    await expect(inspectLocalService(paths)).resolves.toMatchObject({ state: 'running' })
    expect(readServiceStatus).toHaveBeenCalledTimes(2)
  })
})
