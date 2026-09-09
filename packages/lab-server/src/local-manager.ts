import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { open, stat, readFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { requestLocalControl } from './control'
import { restoreOffline, recoverOfflineRestore } from './restore'
import { LabError, requireCondition } from './errors'
import { validateRuntimeConfig } from './runtime-config'
import { lockDirectory } from './directory-lock'
import { durableWrite, syncDirectory } from './durable-files'

declare const __LAB_VERSION__: string

const notInstalledStatus = {
  state: 'not-installed',
  autostart: false,
  releaseVersion: null,
  license: null,
  info: null,
  port: null,
  error: null
} as const

export interface ManagerPaths {
  root: string
  runtime: string
  source: string
  unit?: string
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

async function command(
  executable: string,
  args: string[],
  allowedExitCodes: number[] = []
): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      executable,
      args,
      { windowsHide: true, timeout: 120000, maxBuffer: 256 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error && !allowedExitCodes.includes(Number(error.code))) {
          fail(new LabError('STORAGE_UNAVAILABLE'))
          return
        }
        done(stdout.trim())
      }
    )
  })
}

async function serviceRegistration(): Promise<{
  installed: boolean
  stopped: boolean
  autostart: boolean
}> {
  if (process.platform === 'linux') {
    const output = await command(
      'systemctl',
      [
        'show',
        'ls101-lab.service',
        '--property=LoadState',
        '--property=ActiveState',
        '--property=UnitFileState'
      ],
      [1]
    )
    const fields = Object.fromEntries(output.split('\n').map((line) => line.split('=')))
    requireCondition(Boolean(fields.LoadState && fields.ActiveState), 'STORAGE_UNAVAILABLE')
    return {
      installed: fields.LoadState !== 'not-found',
      stopped: ['inactive', 'failed'].includes(fields.ActiveState),
      autostart: fields.UnitFileState === 'enabled'
    }
  }
  const output = await command('powershell.exe', [
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

export async function manageLocalService(
  operation: string,
  input: unknown,
  paths: ManagerPaths = installedPaths()
): Promise<unknown> {
  const { root, runtime, source } = paths
  if (operation === 'uninstall') {
    requireCondition(input === undefined, 'INVALID_REQUEST')
    const registration = await serviceRegistration()
    requireCondition(registration.stopped, 'RESOURCE_BUSY')
    if (!registration.installed) return { ...notInstalledStatus }
    // Holding the daemon's lifetime lock prevents it from starting during removal.
    const lifetime = await lockDirectory(`${root}.runtime`)
    try {
      requireCondition((await serviceRegistration()).stopped, 'RESOURCE_BUSY')
      if (process.platform === 'linux') {
        await command('systemctl', ['disable', 'ls101-lab.service'])
        const unit = paths.unit ?? '/etc/systemd/system/ls101-lab.service'
        await unlink(unit).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
        await syncDirectory(dirname(unit))
        await command('systemctl', ['daemon-reload'])
      } else {
        await command('sc.exe', ['config', 'LS101Lab', 'start=', 'disabled'])
        await command('sc.exe', ['delete', 'LS101Lab'])
      }
      requireCondition(!(await serviceRegistration()).installed, 'RESOURCE_BUSY')
      return { ...notInstalledStatus }
    } finally {
      lifetime.close()
    }
  }
  if (operation === 'configure') {
    requireCondition(
      input &&
        typeof input === 'object' &&
        Object.keys(input).length === 1 &&
        Object.hasOwn(input, 'port'),
      'INVALID_REQUEST'
    )
    const lifetime = await lockDirectory(`${root}.runtime`)
    try {
      const current = validateRuntimeConfig(
        JSON.parse(await readFile(join(root, 'service-runtime.json'), 'utf8'))
      )
      const config = validateRuntimeConfig({ ...current, port: (input as { port: number }).port })
      await durableWrite(join(root, 'service-runtime.json'), JSON.stringify(config))
      if (process.platform === 'linux')
        await command('chown', ['ls101-lab:ls101-lab', join(root, 'service-runtime.json')])
      return null
    } finally {
      lifetime.close()
    }
  }
  if (operation === 'upgrade' || operation === 'prepare-install') {
    requireCondition(input === undefined, 'INVALID_REQUEST')
    if (operation === 'prepare-install') {
      try {
        await requestLocalControl(root, 'status')
      } catch (error) {
        // A stopped/absent daemon cannot prepare a new upgrade. The installer still
        // requires the matching durable preparation record before replacing data's runtime.
        if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? ''))
          return null
        throw error
      }
    }
    await requestLocalControl(root, 'prepare-upgrade', __LAB_VERSION__)
    try {
      if (process.platform === 'linux') await command('systemctl', ['stop', 'ls101-lab.service'])
      else await command(join(runtime, 'LS101Lab.exe'), ['stop'])
    } catch (error) {
      await requestLocalControl(root, 'cancel-stop').catch(() => undefined)
      throw error
    }
    return operation === 'upgrade' ? manageLocalService('install', undefined, paths) : null
  }
  if (operation === 'status') {
    requireCondition(input === undefined, 'INVALID_REQUEST')
    const installed = await stat(join(runtime, 'runtime-manifest.json')).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      }
    )
    const registration = installed ? await serviceRegistration() : null
    if (!installed || !registration?.installed) return { ...notInstalledStatus }
    const { autostart } = registration
    try {
      return {
        ...(await requestLocalControl<Record<string, unknown>>(root, 'status')),
        autostart,
        error: null
      }
    } catch (error) {
      const missing = ['ENOENT', 'ECONNREFUSED'].includes(
        (error as NodeJS.ErrnoException).code ?? ''
      )
      const manifest = JSON.parse(await readFile(join(runtime, 'runtime-manifest.json'), 'utf8'))
      const config = await readFile(join(root, 'service-runtime.json'), 'utf8').then(
        (text) => validateRuntimeConfig(JSON.parse(text)),
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
          return null
        }
      )
      return {
        state: missing ? 'stopped' : 'unavailable',
        autostart,
        releaseVersion: manifest.releaseVersion,
        license: null,
        info: null,
        port: config?.port ?? null,
        error: missing ? null : 'LOCAL_CONTROL_UNAVAILABLE'
      }
    }
  }
  if (operation === 'initialize') {
    const value = input as {
      name: string
      baseUrl: string
      password: string
      activationCode: string
      port: number
    }
    requireCondition(
      value &&
        typeof value.activationCode === 'string' &&
        value.activationCode.length <= 256 &&
        typeof value.name === 'string' &&
        typeof value.baseUrl === 'string' &&
        typeof value.password === 'string' &&
        Number.isInteger(value.port) &&
        value.port >= 1 &&
        value.port <= 65535 &&
        Object.keys(value).every((key) =>
          ['name', 'baseUrl', 'password', 'activationCode', 'port'].includes(key)
        ),
      'INVALID_REQUEST'
    )
    const status = await requestLocalControl<{ license: { state: string } }>(root, 'status')
    if (status.license.state !== 'active') {
      const activation = await requestLocalControl<{ activated: boolean }>(
        root,
        'activate',
        value.activationCode
      )
      requireCondition(activation.activated, 'LICENSE_INACTIVE')
    }
    return requestLocalControl(root, 'initialize', {
      name: value.name,
      baseUrl: value.baseUrl,
      password: value.password,
      config: { schemaVersion: 1, port: value.port, host: '0.0.0.0' }
    })
  }
  if (operation === 'connection') {
    requireCondition(input === undefined, 'INVALID_REQUEST')
    return requestLocalControl(root, 'connection')
  }
  if (operation === 'start' || operation === 'stop') {
    requireCondition(input === undefined, 'INVALID_REQUEST')
    if (operation === 'stop') await requestLocalControl(root, 'prepare-stop')
    try {
      if (process.platform === 'linux') await command('systemctl', [operation, 'ls101-lab.service'])
      else await command(join(runtime, 'LS101Lab.exe'), [operation])
    } catch (error) {
      if (operation === 'stop')
        await requestLocalControl(root, 'cancel-stop').catch(() => undefined)
      throw error
    }
    return null
  }
  if (operation === 'autostart') {
    requireCondition(typeof input === 'boolean', 'INVALID_REQUEST')
    if (process.platform === 'linux')
      await command('systemctl', [input ? 'enable' : 'disable', 'ls101-lab.service'])
    else await command('sc.exe', ['config', 'LS101Lab', 'start=', input ? 'auto' : 'demand'])
    return null
  }
  if (operation === 'logs') {
    requireCondition(input === undefined, 'INVALID_REQUEST')
    if (process.platform === 'linux')
      return (
        await command('journalctl', [
          '-u',
          'ls101-lab.service',
          '-n',
          '100',
          '--no-pager',
          '-o',
          'cat'
        ])
      ).slice(-12000)
    const file = await open(join(dirname(root), 'logs', 'LS101Lab.wrapper.log'), 'r')
    try {
      const size = (await file.stat()).size
      const bytes = Buffer.alloc(Math.min(size, 12000))
      await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length))
      return bytes.toString('utf8')
    } finally {
      await file.close()
    }
  }
  if (operation === 'restore') {
    const value = input as { archive: string; password: string }
    requireCondition(
      value &&
        typeof value.archive === 'string' &&
        typeof value.password === 'string' &&
        Object.keys(value).every((key) => ['archive', 'password'].includes(key)),
      'INVALID_REQUEST'
    )
    const result = await restoreOffline({
      root,
      archive: resolve(value.archive),
      password: value.password,
      releaseVersion: __LAB_VERSION__
    })
    if (process.platform === 'linux') await command('chown', ['-R', 'ls101-lab:ls101-lab', root])
    return result
  }
  if (operation === 'recover-restore') {
    requireCondition(input === undefined, 'INVALID_REQUEST')
    const previousDirectory = await recoverOfflineRestore(root, __LAB_VERSION__)
    if (process.platform === 'linux') await command('chown', ['-R', 'ls101-lab:ls101-lab', root])
    return { previousDirectory }
  }
  if (operation === 'install') {
    requireCondition(input === undefined, 'INVALID_REQUEST')
    if (process.platform === 'linux') {
      await command(join(source, 'runtime/node'), [join(source, 'install-linux.mjs'), '--install'])
    } else {
      await command('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(source, 'install-windows.ps1')
      ])
    }
    return null
  }
  throw new LabError('INVALID_REQUEST')
}
