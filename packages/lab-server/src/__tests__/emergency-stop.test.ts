import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { manageLocalService } from '../local-manager'
import { emergencyStopMarker, windowsEmergencyStopScript } from '../emergency-stop'
import { serviceRegistration } from '../local-status'
import { requestLocalControl } from '../control'
import { lockDirectory } from '../directory-lock'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('../local-status', () => ({ serviceRegistration: vi.fn(), installedPaths: vi.fn() }))
vi.mock('../control', () => ({ requestLocalControl: vi.fn() }))
// OS manager simulations must not select Windows directory flags for Linux I/O or vice versa.
// Native durable writes remain covered by the runtime integration tests.
vi.mock('../durable-files', () => ({
  durableWrite: vi.fn((filename: string, bytes: string) => writeFile(filename, bytes))
}))
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe.each(['linux', 'win32'])('emergency service stop on %s', (platform) => {
  async function fixture() {
    const parent = await mkdtemp(join(tmpdir(), 'ls101-emergency-'))
    onTestFinished(() => rm(parent, { recursive: true, force: true }))
    const paths = { root: join(parent, 'data'), runtime: join(parent, 'runtime'), source: parent }
    await mkdir(paths.root)
    const state = { stopped: false, graceful: true, killed: true, failed: false, identity: true }
    const commands: string[][] = []
    vi.stubGlobal('process', { ...process, platform })
    vi.mocked(serviceRegistration).mockImplementation(async () => ({
      installed: true,
      stopped: state.stopped,
      autostart: false
    }))
    vi.mocked(execFile).mockImplementation((file, args, _options, callback: any) => {
      const argv = args as string[]
      commands.push([String(file), ...argv])
      let output = ''
      if (argv.includes('--property=FragmentPath'))
        output = state.identity ? '/etc/systemd/system/ls101-lab.service' : '/other.service'
      if (argv.includes('--property=ExecStart'))
        output = `{ path=${join(paths.runtime, 'runtime/node')} ; argv[]=${join(paths.runtime, 'runtime/node')} ${join(paths.runtime, 'server.cjs')} serve --data-dir ${paths.root} ; }`
      if (argv[0] === 'stop') state.stopped = state.graceful
      if (argv[0] === 'kill' || file === 'powershell.exe') state.stopped = state.killed
      callback(state.failed ? new Error('OS failure') : null, output, '')
      return {} as any
    })
    return { paths, state, commands }
  }

  it('stops without the service channel, persists recovery and releases management locks', async () => {
    const { paths, commands } = await fixture()
    await expect(manageLocalService('force-stop', undefined, paths)).resolves.toMatchObject({
      state: 'stopped',
      autostart: false
    })
    expect(requestLocalControl).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(emergencyStopMarker(paths.root), 'utf8'))).toHaveProperty(
      'requestedAt'
    )
    const lock = await lockDirectory(`${paths.root}.emergency`)
    lock.close()
    if (platform === 'linux') {
      expect(commands).toContainEqual(['systemctl', 'stop', '--no-block', 'ls101-lab.service'])
      expect(commands.some((c) => c[1] === 'kill')).toBe(false)
    } else {
      const command = commands.find((c) => c[0] === 'powershell.exe')!
      const script = Buffer.from(command.at(-1)!, 'base64').toString('utf16le')
      expect(script).toContain('sc.exe config LS101Lab start= disabled')
      expect(script).toContain('taskkill.exe /PID $servicePid /T /F /FI "SERVICES eq LS101Lab"')
    }
  })

  it('refuses caller-selected targets before any OS action', async () => {
    const { paths, commands } = await fixture()
    await expect(manageLocalService('force-stop', { pid: 123 }, paths)).rejects.toMatchObject({
      code: 'INVALID_REQUEST'
    })
    expect(commands).toEqual([])
  })

  it('does not report stopped while a surviving child owns the runtime', async () => {
    const { paths } = await fixture()
    const lifetime = await lockDirectory(`${paths.root}.runtime`)
    try {
      await expect(manageLocalService('force-stop', undefined, paths)).rejects.toMatchObject({
        code: 'RESOURCE_BUSY'
      })
      expect(await stat(emergencyStopMarker(paths.root))).toBeDefined()
    } finally {
      lifetime.close()
    }
  })

  it('rejects OS command failures rather than reporting success', async () => {
    const { paths, state } = await fixture()
    state.failed = true
    await expect(manageLocalService('force-stop', undefined, paths)).rejects.toMatchObject({
      code: 'LOCAL_FORCE_STOP_FAILED'
    })
    expect(requestLocalControl).not.toHaveBeenCalled()
  })

  it('rejects missing registration without killing anything', async () => {
    const { paths, commands } = await fixture()
    vi.mocked(serviceRegistration).mockResolvedValue({
      installed: false,
      stopped: true,
      autostart: false
    })
    await expect(manageLocalService('force-stop', undefined, paths)).rejects.toMatchObject({
      code: 'LOCAL_SERVICE_NOT_INSTALLED'
    })
    expect(commands.some((c) => /stop|kill/.test(c[1]))).toBe(false)
  })

  if (platform === 'linux') {
    it('refuses a different registered unit', async () => {
      const { paths, state, commands } = await fixture()
      state.identity = false
      await expect(manageLocalService('force-stop', undefined, paths)).rejects.toMatchObject({
        code: 'LOCAL_SERVICE_IDENTITY_MISMATCH'
      })
      expect(commands.some((c) => c[1] === 'stop' || c[1] === 'kill')).toBe(false)
    })

    it.each([true, false])(
      'escalates a stalled stop and verifies the outcome (exited=%s)',
      async (exited) => {
        const { paths, state, commands } = await fixture()
        state.graceful = false
        state.killed = exited
        vi.useFakeTimers()
        const result = manageLocalService('force-stop', undefined, paths).catch((error) => error)
        await vi.waitFor(() => expect(commands.some((c) => c[1] === 'stop')).toBe(true))
        await vi.runAllTimersAsync()
        expect(commands).toContainEqual([
          'systemctl',
          'kill',
          '--signal=SIGKILL',
          '--kill-who=all',
          'ls101-lab.service'
        ])
        expect(await result).toMatchObject(
          exited ? { state: 'stopped' } : { code: 'LOCAL_FORCE_STOP_INCOMPLETE' }
        )
      }
    )
  }
})

it('quotes installed Windows paths and validates PID identity again before killing', () => {
  const script = windowsEmergencyStopScript("C:\\Program Files\\O'Brien\\runtime")
  expect(script).toContain("O''Brien")
  expect(script).toContain('$heldHandle = $target.Handle')
  expect(script).toContain('$current.ProcessId -ne $servicePid')
  expect(script).toContain('$owners.Count -ne 1')
})
