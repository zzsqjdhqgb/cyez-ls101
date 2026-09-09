import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { open, stat, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { requestLocalControl } from './control'
import { restoreOffline, recoverOfflineRestore } from './restore'
import { LabError, requireCondition } from './errors'
import { validateRuntimeConfig } from './runtime-config'
import { lockDirectory } from './directory-lock'
import { durableWrite } from './durable-files'

declare const __LAB_VERSION__: string

export interface ManagerPaths {
  root: string
  runtime: string
  source: string
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

async function command(executable: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      executable,
      args,
      { windowsHide: true, timeout: 120000, maxBuffer: 256 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          fail(new LabError('STORAGE_UNAVAILABLE'))
          return
        }
        done(stdout.trim())
      }
    )
  })
}

export async function manageLocalService(
  operation: string,
  input: unknown,
  paths: ManagerPaths = installedPaths()
): Promise<unknown> {
  const { root, runtime, source } = paths
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
  if (operation === 'upgrade') {
    requireCondition(input === undefined, 'INVALID_REQUEST')
    await requestLocalControl(root, 'prepare-upgrade', __LAB_VERSION__)
    try {
      if (process.platform === 'linux') await command('systemctl', ['stop', 'ls101-lab.service'])
      else await command(join(runtime, 'LS101Lab.exe'), ['stop'])
    } catch (error) {
      await requestLocalControl(root, 'cancel-stop').catch(() => undefined)
      throw error
    }
    return manageLocalService('install', undefined, paths)
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
    if (!installed)
      return {
        state: 'not-installed',
        autostart: false,
        releaseVersion: null,
        license: null,
        info: null,
        port: null,
        error: null
      }
    let autostart = false
    if (process.platform === 'linux') {
      autostart = await command('systemctl', ['is-enabled', 'ls101-lab.service']).then(
        (value) => value === 'enabled',
        () => false
      )
    } else {
      autostart = await command('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_Service -Filter "Name=\'LS101Lab\'").StartMode'
      ]).then(
        (value) => value === 'Auto',
        () => false
      )
    }
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
