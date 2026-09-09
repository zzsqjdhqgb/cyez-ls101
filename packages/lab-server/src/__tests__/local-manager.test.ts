import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { manageLocalService } from '../local-manager'
import { requestLocalControl } from '../control'

vi.mock('../control', () => ({ requestLocalControl: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('fixed local manager capabilities', () => {
  const paths = {
    root: '/fixture/data',
    runtime: '/fixture/old-release',
    source: '/fixture/new-release'
  }

  it('prepares the bundled target version before stopping an older running service', async () => {
    vi.stubGlobal('__LAB_VERSION__', 'next-release')
    vi.mocked(requestLocalControl)
      .mockResolvedValueOnce({ releaseVersion: 'old-release' })
      .mockResolvedValue(null)
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback: any) => {
      callback(null, '', '')
      return {} as any
    })
    await expect(manageLocalService('prepare-install', undefined, paths)).resolves.toBeNull()
    expect(vi.mocked(requestLocalControl).mock.calls).toEqual([
      [paths.root, 'status'],
      [paths.root, 'prepare-upgrade', 'next-release']
    ])
    expect(execFile).toHaveBeenCalledOnce()
    expect(vi.mocked(execFile).mock.calls[0].slice(0, 2)).toEqual(
      process.platform === 'linux'
        ? ['systemctl', ['stop', 'ls101-lab.service']]
        : [join(paths.runtime, 'LS101Lab.exe'), ['stop']]
    )
    expect(vi.mocked(requestLocalControl).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(execFile).mock.invocationCallOrder[0]
    )
  })

  it.each(['SERVICE_MAINTENANCE', 'RESOURCE_BUSY', 'STORAGE_UNAVAILABLE'])(
    'does not stop the service when preparation rejects with %s',
    async (code) => {
      vi.stubGlobal('__LAB_VERSION__', 'next-release')
      vi.mocked(requestLocalControl)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(Object.assign(new Error(code), { code }))
      await expect(manageLocalService('prepare-install', undefined, paths)).rejects.toThrow(code)
      expect(execFile).not.toHaveBeenCalled()
    }
  )

  it.each(['ENOENT', 'ECONNREFUSED'])(
    'leaves absent/stopped daemons to installer validation (%s)',
    async (code) => {
      vi.mocked(requestLocalControl).mockRejectedValue(Object.assign(new Error(code), { code }))
      await expect(manageLocalService('prepare-install', undefined, paths)).resolves.toBeNull()
      expect(execFile).not.toHaveBeenCalled()
    }
  )

  it('does not mistake a failed control channel for a stopped daemon', async () => {
    vi.mocked(requestLocalControl).mockRejectedValue(new Error('Local control timed out'))
    await expect(manageLocalService('prepare-install', undefined, paths)).rejects.toThrow(
      'timed out'
    )
    expect(execFile).not.toHaveBeenCalled()
  })

  it('releases preparation when the operating system refuses to stop', async () => {
    vi.stubGlobal('__LAB_VERSION__', 'next-release')
    vi.mocked(requestLocalControl).mockResolvedValue(null)
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback: any) => {
      callback(new Error('stop failed'), '', '')
      return {} as any
    })
    await expect(manageLocalService('prepare-install', undefined, paths)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE'
    })
    expect(requestLocalControl).toHaveBeenLastCalledWith(paths.root, 'cancel-stop')
  })

  it('reports an absent install and rejects arbitrary commands and malformed inputs before OS execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ls101-manager-test-'))
    const paths = { root, runtime: join(root, 'missing'), source: join(root, 'source') }
    try {
      expect(await manageLocalService('status', undefined, paths)).toMatchObject({
        state: 'not-installed'
      })
      for (const [operation, input] of [
        ['execute', { command: 'anything' }],
        ['start', {}],
        ['autostart', 'yes'],
        ['configure', { port: 8443, directory: '/arbitrary' }],
        ['initialize', { port: -1 }]
      ] as const) {
        await expect(manageLocalService(operation, input, paths)).rejects.toMatchObject({
          code: 'INVALID_REQUEST'
        })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
