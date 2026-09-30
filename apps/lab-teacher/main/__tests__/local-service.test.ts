import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { requestLocalControl } from '@ls101/lab-server/control'
import { localServiceHost } from '../local-service'
import { inspectLocalService } from '@ls101/lab-server/status'

vi.mock('@ls101/lab-server/status', () => ({ inspectLocalService: vi.fn() }))

it('reads status without launching the administrator helper, including when inspection fails', async () => {
  const launch = vi.fn()
  const host = localServiceHost('/fixed/runtime', launch)
  vi.mocked(inspectLocalService).mockResolvedValueOnce({ state: 'not-installed' } as any)
  await expect(host.invoke('status', undefined)).resolves.toMatchObject({ state: 'not-installed' })
  vi.mocked(inspectLocalService).mockRejectedValueOnce(new Error('unavailable'))
  await expect(host.invoke('status', undefined)).rejects.toThrow('unavailable')
  await expect(host.invoke('status', {})).rejects.toThrow('INVALID_REQUEST')
  expect(launch).not.toHaveBeenCalled()
})

describe.skipIf(process.platform !== 'linux')('elevated helper exchange', () => {
  it.each(['install', 'upgrade'])(
    'preserves installer diagnostics for %s through the authenticated helper channel',
    async (operation) => {
      const manager = localServiceHost('/fixed/runtime', async (_file, args) => {
        const channel = args.at(-1)!
        expect(await requestLocalControl(channel, 'request')).toEqual({ operation })
        await requestLocalControl(channel, 'complete', {
          ok: false,
          error: 'STORAGE_UNAVAILABLE',
          detail: 'LS101_INSTALL_ERROR [configure-service-account]: Access denied'
        })
      })
      await expect(manager.invoke(operation, undefined)).rejects.toThrow(
        'STORAGE_UNAVAILABLE\nLS101_INSTALL_ERROR [configure-service-account]: Access denied'
      )
    }
  )

  it('does not expose helper details for operations that accept credentials', async () => {
    const manager = localServiceHost('/fixed/runtime', async (_file, args) => {
      const channel = args.at(-1)!
      await requestLocalControl(channel, 'request')
      await requestLocalControl(channel, 'complete', {
        ok: false,
        error: 'LICENSE_INACTIVE',
        detail: 'private activation code'
      })
    })
    await expect(manager.invoke('initialize', {})).rejects.toThrow(/^LICENSE_INACTIVE$/)
  })
  it.each(['uninstall', 'force-stop', 'export-data', 'purge'])(
    'routes %s through the authenticated administrator helper',
    async (operation) => {
      const manager = localServiceHost('/fixed/runtime', async (_file, args) => {
        const channel = args.at(-1)!
        expect(await requestLocalControl(channel, 'request')).toEqual({ operation })
        await requestLocalControl(channel, 'complete', { ok: true, value: null })
      })
      await expect(manager.invoke(operation, undefined)).resolves.toBeNull()
    }
  )
  it('transfers secrets through the private authenticated channel and removes it after completion', async () => {
    let channel = ''
    const manager = localServiceHost('/fixed/runtime', async (_file, args) => {
      channel = args.at(-1)!
      expect(args.join(' ')).not.toContain('private-activation-code')
      expect((await stat(channel)).mode & 0o077).toBe(0)
      expect(await readdir(channel)).toEqual(
        expect.arrayContaining(['control.key', 'control.sock'])
      )
      expect((await readFile(join(channel, 'control.key'))).length).toBe(32)
      const request = await requestLocalControl(channel, 'request')
      expect(request).toEqual({
        operation: 'initialize',
        input: { activationCode: 'private-activation-code' }
      })
      await expect(requestLocalControl(channel, 'request')).rejects.toThrow()
      await requestLocalControl(channel, 'complete', { ok: true, value: { initialized: true } })
    })
    expect(
      await manager.invoke('initialize', { activationCode: 'private-activation-code' })
    ).toEqual({ initialized: true })
    await expect(stat(channel)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cleans up a rejected elevation and permits an explicit retry', async () => {
    let attempts = 0
    const channels: string[] = []
    const manager = localServiceHost('/fixed/runtime', async (_file, args) => {
      const channel = args.at(-1)!
      channels.push(channel)
      if (++attempts === 1) throw new Error('elevation cancelled')
      await requestLocalControl(channel, 'request')
      await requestLocalControl(channel, 'complete', { ok: false, error: 'RESOURCE_BUSY' })
    })
    await expect(manager.invoke('stop', undefined)).rejects.toThrow('elevation cancelled')
    await expect(manager.invoke('stop', undefined)).rejects.toThrow('RESOURCE_BUSY')
    for (const channel of channels)
      await expect(stat(channel)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(manager.invoke('execute', 'anything')).rejects.toThrow('INVALID_REQUEST')
  })
})
