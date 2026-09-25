import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { LabError, requireCondition } from './errors'
import { readServiceStatus } from './status-channel'
import type { ManagerPaths } from './local-manager'
import type { RuntimeStatus } from './runtime'

const STATUS_RETRY_COUNT = 8
const STATUS_RETRY_DELAY_MS = 250

function isTransientStatusError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(String(code))
}

function statusFailureCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EACCES' || code === 'EPERM') return 'LOCAL_STATUS_ACCESS_DENIED'
  if (code === 'ETIMEDOUT') return 'LOCAL_STATUS_TIMEOUT'
  if (isTransientStatusError(error)) return 'LOCAL_STATUS_NOT_READY'
  if (code === 'LOCAL_STATUS_INVALID_RESPONSE') return code
  return 'LOCAL_STATUS_UNAVAILABLE'
}

async function readStatusWithStartupRetry(root: string): Promise<RuntimeStatus> {
  let last: unknown
  for (let attempt = 0; attempt < STATUS_RETRY_COUNT; attempt += 1) {
    try {
      return await readServiceStatus(root)
    } catch (error) {
      last = error
      if (!isTransientStatusError(error) || attempt === STATUS_RETRY_COUNT - 1) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, STATUS_RETRY_DELAY_MS))
    }
  }
  throw last instanceof Error ? last : new Error('LOCAL_STATUS_UNAVAILABLE')
}

export interface InspectedServiceStatus extends Omit<
  RuntimeStatus,
  'state' | 'releaseVersion' | 'license'
> {
  state: RuntimeStatus['state'] | 'stopped' | 'not-installed'
  releaseVersion: string | null
  license: RuntimeStatus['license'] | null
  autostart: boolean
  error: string | null
}

export function installedPaths(): ManagerPaths {
  if (process.platform === 'win32') {
    const program = join(process.env.ProgramFiles || 'C:\\Program Files', 'LS101LabService')
    let release = 'not-installed'
    try {
      const value = JSON.parse(readFileSync(join(program, 'installation.json'), 'utf8'))
      requireCondition(
        typeof value.release === 'string' && /^[0-9A-Za-z.+-]+$/.test(value.release),
        'STORAGE_UNAVAILABLE'
      )
      release = value.release
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return {
      root: join(process.env.ProgramData || 'C:\\ProgramData', 'LS101Lab', 'data'),
      runtime: join(program, 'releases', release),
      source: __dirname
    }
  }
  return { root: '/var/lib/ls101-lab/data', runtime: '/opt/ls101-lab/current', source: __dirname }
}

export async function serviceRegistration(): Promise<{
  installed: boolean
  stopped: boolean
  autostart: boolean
}> {
  if (process.platform === 'linux') {
    const output = await query(
      'systemctl',
      [
        'show',
        'ls101-lab.service',
        '--property=LoadState',
        '--property=ActiveState',
        '--property=UnitFileState'
      ],
      { allowedExitCodes: [1] }
    )
    const fields = Object.fromEntries(output.split('\n').map((line) => line.split('=')))
    requireCondition(Boolean(fields.LoadState && fields.ActiveState), 'STORAGE_UNAVAILABLE')
    return {
      installed: fields.LoadState !== 'not-found',
      stopped: ['inactive', 'failed'].includes(fields.ActiveState),
      autostart: fields.UnitFileState === 'enabled'
    }
  }
  const output = await query('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$ErrorActionPreference = "Stop"; Get-CimInstance Win32_Service -Filter "Name=\'LS101Lab\'" | Select-Object State, StartMode | ConvertTo-Json -Compress'
  ])
  const service = output ? JSON.parse(output) : null
  requireCondition(!service || typeof service.State === 'string', 'STORAGE_UNAVAILABLE')
  return {
    installed: service !== null,
    stopped: !service || service.State === 'Stopped',
    autostart: service?.StartMode === 'Auto'
  }
}

function query(
  executable: string,
  args: string[],
  options: { allowedExitCodes?: number[] } = {}
): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      executable,
      args,
      { windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error && !options.allowedExitCodes?.includes(Number(error.code)))
          fail(new LabError('STORAGE_UNAVAILABLE'))
        else done(stdout.trim())
      }
    )
  })
}

export async function inspectLocalService(
  paths: ManagerPaths = installedPaths()
): Promise<InspectedServiceStatus> {
  const empty = {
    state: 'not-installed' as const,
    autostart: false,
    releaseVersion: null as string | null,
    license: null,
    info: null,
    fingerprint: null,
    port: null,
    error: null as string | null,
    settings: null
  }
  const installed = await stat(join(paths.runtime, 'runtime-manifest.json')).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    }
  )
  if (!installed) return empty
  const registration = await serviceRegistration()
  if (!registration.installed) return empty
  const manifest = JSON.parse(await readFile(join(paths.runtime, 'runtime-manifest.json'), 'utf8'))
  const base = {
    ...empty,
    autostart: registration.autostart,
    releaseVersion: manifest.releaseVersion as string
  }
  if (registration.stopped) return { ...base, state: 'stopped' as const }
  try {
    const status = await readStatusWithStartupRetry(paths.root)
    return {
      ...base,
      ...status,
      error: status.state === 'unavailable' ? 'LOCAL_SERVICE_NOT_LISTENING' : null
    }
  } catch (error) {
    // Startup may have failed while we waited for the status channel. Only a fresh
    // OS observation can justify enabling start or offline management actions.
    const current = await serviceRegistration().catch(() => null)
    if (current && !current.installed) return empty
    if (current?.stopped) return { ...base, autostart: current.autostart, state: 'stopped' }
    return {
      ...base,
      ...(current ? { autostart: current.autostart } : {}),
      state: 'unavailable' as const,
      error: statusFailureCode(error)
    }
  }
}
