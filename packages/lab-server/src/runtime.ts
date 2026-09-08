import { randomBytes } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Server } from 'node:https'
import { LicenseService } from '@ls101/license'
import { LabService } from './service'
import { LabError, requireCondition } from './errors'
import { lockDirectory } from './directory-lock'
import { durableWrite } from './durable-files'
import { createLabHttpServer, closeLabHttpServer } from './http'
import { listenLocalControl } from './control'
import { validateRuntimeConfig, type RuntimeConfig } from './runtime-config'

export interface RuntimeStatus {
  state: 'running' | 'unavailable' | 'uninitialized'
  releaseVersion: string
  license: Awaited<ReturnType<LicenseService['getStatus']>>
  info: ReturnType<LabService['info']> | null
  port: number | null
}

export async function startServiceRuntime(
  root: string,
  releaseVersion: string
): Promise<{ close(): Promise<void>; status(): Promise<RuntimeStatus> }> {
  const lifetime = await lockDirectory(`${root}.runtime`)
  let service: LabService | undefined
  let http: Server | undefined
  let control: Awaited<ReturnType<typeof listenLocalControl>> | undefined
  let closing = false
  let busy = false
  let config: RuntimeConfig | undefined
  let collecting: Promise<void> | undefined
  const gcTimer = setInterval(() => {
    if (!service || collecting || closing) return
    collecting = service.archives
      .collectGarbage()
      .catch(() => undefined)
      .finally(() => {
        collecting = undefined
      })
  }, 60000)
  gcTimer.unref()
  const license = new LicenseService({ storagePath: join(root, 'license.json') })
  const options = {
    root,
    releaseVersion,
    isLicenseActive: () => license.getStatusSync().state === 'active'
  }
  const listen = async (): Promise<void> => {
    http = createLabHttpServer(service!)
    await new Promise<void>((done, fail) => {
      http!.once('error', fail)
      http!.listen(config!.port, config!.host, () => {
        http!.off('error', fail)
        done()
      })
    })
  }
  const close = async (): Promise<void> => {
    if (closing) return
    closing = true
    clearInterval(gcTimer)
    await control?.close()
    if (http) await closeLabHttpServer(http)
    for (const transfer of service?.transfers.values() ?? [])
      transfer.abort(new LabError('SERVICE_NOT_READY'))
    await service?.backups.wait()
    await collecting
    await service?.db.close()
    lifetime.close()
  }
  const status = async (): Promise<RuntimeStatus> => ({
    state: service ? (http?.listening ? 'running' : 'unavailable') : 'uninitialized',
    releaseVersion,
    license: await license.getStatus(),
    info: service?.info() ?? null,
    port: config?.port ?? null
  })
  try {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const initialized = await stat(join(root, 'service.sqlite')).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      }
    )
    if (initialized) {
      config = validateRuntimeConfig(
        JSON.parse(await readFile(join(root, 'service-runtime.json'), 'utf8'))
      )
      service = await LabService.open(options)
      await listen()
    }
    const key = randomBytes(32)
    await durableWrite(join(root, 'control.key'), key)
    control = await listenLocalControl(root, key, async (operation, input) => {
      requireCondition(!closing, 'SERVICE_NOT_READY')
      if (operation === 'status') {
        requireCondition(input === undefined, 'INVALID_REQUEST')
        return status()
      }
      if (operation === 'connection') {
        requireCondition(input === undefined, 'INVALID_REQUEST')
        requireCondition(service && http?.listening && config, 'SERVICE_NOT_READY')
        requireCondition(options.isLicenseActive(), 'LICENSE_INACTIVE')
        return {
          baseUrl: `https://127.0.0.1:${config.port}/`,
          serverId: service.identity.serverId,
          fingerprint: service.identity.fingerprint,
          localProof: service.security.issueLocalProof()
        }
      }
      requireCondition(!busy, 'RESOURCE_BUSY')
      busy = true
      try {
        if (operation === 'activate') {
          requireCondition(typeof input === 'string' && input.length <= 256, 'INVALID_REQUEST')
          const release = service?.db.gate.enter()
          try {
            return await license.activate(input)
          } finally {
            release?.()
          }
        }
        if (operation === 'initialize') {
          requireCondition(!service, 'CONTENT_CONFLICT')
          requireCondition(input !== null && typeof input === 'object', 'INVALID_REQUEST')
          const value = input as {
            name: string
            baseUrl: string
            password: string
            config: RuntimeConfig
          }
          requireCondition(
            Object.keys(value).every((key) =>
              ['name', 'baseUrl', 'password', 'config'].includes(key)
            ) &&
              typeof value.name === 'string' &&
              typeof value.baseUrl === 'string' &&
              typeof value.password === 'string',
            'INVALID_REQUEST'
          )
          config = validateRuntimeConfig(value.config)
          requireCondition(options.isLicenseActive(), 'LICENSE_INACTIVE')
          LabService.validateBaseUrl(value.baseUrl)
          await durableWrite(join(root, 'service-runtime.json'), JSON.stringify(config))
          service = await LabService.initialize(options, value)
          await listen()
          return status()
        }
        throw new LabError('INVALID_REQUEST')
      } finally {
        busy = false
      }
    })
    return { close, status }
  } catch (error) {
    await close()
    throw error
  }
}
