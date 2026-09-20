import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { localManagerFailure, manageLocalService } from '../local-manager'
import { requestLocalControl } from '../control'
import { lockDirectory } from '../directory-lock'
import { syncDirectory } from '../durable-files'

vi.mock('../control', () => ({ requestLocalControl: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
// These tests simulate both service managers on either host OS. A fake process.platform must not
// select Linux directory-handle flags for real Windows I/O. Model the persistence barrier here;
// native directory syncing remains exercised by the runtime, archive and restore integration tests.
vi.mock('../durable-files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../durable-files')>()),
  syncDirectory: vi.fn(async () => {})
}))
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

  it('includes bounded Windows process error and output logs when the wrapper log is missing', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    const parent = await mkdtemp(join(tmpdir(), 'ls101-manager-logs-'))
    onTestFinished(async () => rm(parent, { recursive: true, force: true }))
    await mkdir(join(parent, 'logs'))
    await writeFile(join(parent, 'logs', 'LS101Lab.err.log'), 'Error: listen EADDRINUSE')
    await writeFile(join(parent, 'logs', 'LS101Lab.out.log'), 'old entry\n' + 'x'.repeat(12000))
    const logs = await manageLocalService('logs', undefined, {
      ...paths,
      root: join(parent, 'data')
    })
    expect(logs).toContain('LS101Lab.err.log ---\nError: listen EADDRINUSE')
    expect(logs).toContain('LS101Lab.out.log ---\n' + 'x'.repeat(12000))
    expect(logs).not.toContain('old entry')
    expect(logs).toContain('LS101Lab.wrapper.log ---\n（尚未生成日志）')
    expect(execFile).not.toHaveBeenCalled()
  })

  it.each(['linux', 'win32'])('keeps installer stderr and exit status on %s', async (platform) => {
    vi.stubGlobal('process', { ...process, platform })
    vi.mocked(execFile).mockImplementation((_file, _args, options: any, callback: any) => {
      expect(options.timeout).toBe(35 * 60000)
      callback(
        Object.assign(new Error('Command failed'), { code: 1 }),
        'WinSW: service was installed successfully',
        'LS101_INSTALL_ERROR [configure-service-account]: Access denied'
      )
      return {} as any
    })
    const failure = await manageLocalService('install', undefined, paths).catch(localManagerFailure)
    expect(failure).toMatchObject({
      ok: false,
      error: 'STORAGE_UNAVAILABLE',
      detail: expect.stringContaining('[configure-service-account]: Access denied')
    })
    expect((failure as { detail: string }).detail).toContain('安装程序退出状态：1')
    expect((failure as { detail: string }).detail).toContain('service was installed successfully')
  })

  it('bounds installer diagnostics and keeps other operation failures code-only', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback: any) => {
      callback(
        Object.assign(new Error('failed'), { code: 1 }),
        'x'.repeat(10000),
        'y'.repeat(10000)
      )
      return {} as any
    })
    const failure = (await manageLocalService('install', undefined, paths).catch(
      localManagerFailure
    )) as { detail: string }
    expect(failure.detail.length).toBeLessThan(8192)
    expect(await manageLocalService('start', undefined, paths).catch(localManagerFailure)).toEqual({
      ok: false,
      error: 'STORAGE_UNAVAILABLE'
    })
    expect(
      localManagerFailure(
        Object.assign(new Error('private password'), {
          code: 'LICENSE_INACTIVE',
          installerDetail: 'private activation code'
        })
      )
    ).toEqual({ ok: false, error: 'LICENSE_INACTIVE' })
  })

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
        ['uninstall', { deleteData: true }],
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

describe.each(['linux', 'win32'])('service removal on %s', (platform) => {
  async function fixture(): Promise<{
    paths: { root: string; runtime: string; source: string; unit: string }
    state: { installed: boolean; stopped: boolean; fail: string | null; pending: boolean }
    commands: string[]
  }> {
    const parent = await mkdtemp(join(tmpdir(), 'ls101-uninstall-'))
    const paths = {
      root: join(parent, 'data'),
      runtime: join(parent, 'runtime'),
      source: join(parent, 'bundle'),
      unit: join(parent, 'ls101-lab.service')
    }
    await mkdir(paths.root)
    await mkdir(paths.runtime)
    await writeFile(join(paths.root, 'service.sqlite'), 'preserved answers')
    await writeFile(
      join(paths.runtime, 'runtime-manifest.json'),
      JSON.stringify({ releaseVersion: 'test-release' })
    )
    await writeFile(paths.unit, 'service registration')
    const state = { installed: true, stopped: true, fail: null as string | null, pending: false }
    const commands: string[] = []
    vi.stubGlobal('process', { ...process, platform })
    vi.mocked(requestLocalControl).mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }))
    vi.mocked(execFile).mockImplementation((file, args, _options, callback: any) => {
      const argv = args as string[]
      const operation = `${file} ${argv.join(' ')}`
      commands.push(operation)
      if (state.fail && operation.includes(state.fail)) {
        callback(Object.assign(new Error('OS failure'), { code: 1 }), '', '')
        return {} as any
      }
      let output = ''
      if (file === 'systemctl' && argv[0] === 'show')
        output = `LoadState=${state.installed ? 'loaded' : 'not-found'}\nActiveState=${state.stopped ? 'inactive' : 'active'}\nUnitFileState=disabled`
      if (file === 'powershell.exe' && state.installed)
        output = JSON.stringify({
          State: state.stopped ? 'Stopped' : 'Running',
          StartMode: 'Manual'
        })
      if (
        !state.pending &&
        ((file === 'systemctl' && argv[0] === 'daemon-reload') ||
          (file === 'sc.exe' && argv[0] === 'delete'))
      )
        state.installed = false
      callback(null, output, '')
      return {} as any
    })
    onTestFinished(async () => rm(parent, { recursive: true, force: true }))
    return { paths, state, commands }
  }

  it('removes registration, retains data and runtime, and reports not installed', async () => {
    const { paths, commands } = await fixture()
    await expect(manageLocalService('uninstall', undefined, paths)).resolves.toMatchObject({
      state: 'not-installed'
    })
    expect(await readFile(join(paths.root, 'service.sqlite'), 'utf8')).toBe('preserved answers')
    expect(await stat(join(paths.runtime, 'runtime-manifest.json'))).toBeDefined()
    expect(await manageLocalService('status', undefined, paths)).toMatchObject({
      state: 'not-installed',
      autostart: false
    })
    if (platform === 'linux') {
      await expect(stat(paths.unit)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(syncDirectory).toHaveBeenCalledOnce()
      expect(syncDirectory).toHaveBeenCalledWith(dirname(paths.unit))
      expect(commands).toContain('systemctl disable ls101-lab.service')
      expect(commands).toContain('systemctl daemon-reload')
    } else {
      expect(syncDirectory).not.toHaveBeenCalled()
      expect(commands).toContain('sc.exe config LS101Lab start= disabled')
      expect(commands).toContain('sc.exe delete LS101Lab')
    }
    const count = commands.length
    await expect(manageLocalService('uninstall', undefined, paths)).resolves.toMatchObject({
      state: 'not-installed'
    })
    expect(commands.length).toBe(count + 1)
  })

  it('rejects running services without changing their registration', async () => {
    const { paths, state, commands } = await fixture()
    state.stopped = false
    await expect(manageLocalService('uninstall', undefined, paths)).rejects.toMatchObject({
      code: 'RESOURCE_BUSY'
    })
    expect(commands).toHaveLength(1)
    expect(state.installed).toBe(true)
  })

  it('does not report a running OS service as stopped when control is not ready', async () => {
    const { paths, state } = await fixture()
    state.stopped = false
    await expect(manageLocalService('status', undefined, paths)).resolves.toMatchObject({
      state: 'unavailable',
      error: 'LOCAL_CONTROL_UNAVAILABLE'
    })
    state.stopped = true
    await expect(manageLocalService('status', undefined, paths)).resolves.toMatchObject({
      state: 'stopped',
      error: null
    })
  })

  it('returns actual readiness after start, including a service awaiting initialization', async () => {
    const { paths } = await fixture()
    vi.mocked(requestLocalControl).mockResolvedValue({
      state: 'uninitialized',
      info: null,
      settings: null,
      port: null
    })
    await expect(manageLocalService('start', undefined, paths)).resolves.toMatchObject({
      state: 'uninitialized',
      autostart: false
    })
  })

  it('refuses removal while the daemon lifetime lock is held', async () => {
    const { paths, commands } = await fixture()
    const lifetime = await lockDirectory(`${paths.root}.runtime`)
    try {
      await expect(manageLocalService('uninstall', undefined, paths)).rejects.toMatchObject({
        code: 'RESOURCE_BUSY'
      })
      expect(commands).toHaveLength(1)
    } finally {
      lifetime.close()
    }
  })

  it('keeps registration if disabling fails and releases the lifetime lock', async () => {
    const { paths, state, commands } = await fixture()
    state.fail = platform === 'linux' ? ' disable ' : ' config '
    await expect(manageLocalService('uninstall', undefined, paths)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE'
    })
    expect(state.installed).toBe(true)
    expect(commands.some((command) => /daemon-reload|sc.exe delete/.test(command))).toBe(false)
    expect(await stat(paths.unit)).toBeDefined()
    const lifetime = await lockDirectory(`${paths.root}.runtime`)
    lifetime.close()
  })

  if (platform === 'linux') {
    it('propagates a failed directory sync before daemon reload and releases the lifetime lock', async () => {
      const { paths, state, commands } = await fixture()
      const failure = Object.assign(new Error('Directory sync failed'), { code: 'EIO' })
      vi.mocked(syncDirectory).mockRejectedValueOnce(failure)
      await expect(manageLocalService('uninstall', undefined, paths)).rejects.toBe(failure)
      expect(syncDirectory).toHaveBeenCalledWith(dirname(paths.unit))
      expect(commands).toContain('systemctl disable ls101-lab.service')
      expect(commands).not.toContain('systemctl daemon-reload')
      expect(state.installed).toBe(true)
      expect(await stat(join(paths.root, 'service.sqlite'))).toBeDefined()
      const lifetime = await lockDirectory(`${paths.root}.runtime`)
      lifetime.close()
    })
  }

  it('does not treat a service manager failure as an absent service', async () => {
    const { paths, state } = await fixture()
    state.fail = platform === 'linux' ? ' show ' : 'powershell.exe'
    await expect(manageLocalService('status', undefined, paths)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE'
    })
    await expect(manageLocalService('uninstall', undefined, paths)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE'
    })
  })

  it('does not report success while the OS still retains the registration', async () => {
    const { paths, state } = await fixture()
    state.pending = true
    await expect(manageLocalService('uninstall', undefined, paths)).rejects.toMatchObject({
      code: 'RESOURCE_BUSY'
    })
  })
})
