import { describe, expect, it, vi } from 'vitest'
import type { LabHost } from '@ls101/lab-desktop-host'
import { TeacherController, type SavedConnection } from '../controller'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
const target: SavedConnection = {
  id: 'saved',
  name: 'Lab',
  baseUrl: 'https://localhost:8443/',
  fingerprint: `sha256:${'a'.repeat(64)}`
}
const connection = (id: string) => ({
  connectionId: id,
  epoch: 1,
  info: { serverId: id, name: id }
})

describe('teacher connection ownership', () => {
  it('does not clear a newer local connection when an old remote authentication fails', async () => {
    const auth = deferred<void>()
    const calls: Array<[string, unknown]> = []
    const host = {
      onEvent: () => () => undefined,
      invoke: vi.fn(async (capability: string, input?: unknown) => {
        calls.push([capability, input])
        if (capability === 'connections.open') return connection('remote')
        if (capability === 'connections.authenticate') return auth.promise
        if (capability === 'localService.connection') return connection('local')
        return null
      })
    } as unknown as LabHost
    const controller = new TeacherController(host)
    vi.spyOn(controller, 'refreshService').mockResolvedValue()
    const old = controller.connect(target, 'secret')
    const failure = expect(old).rejects.toThrow('authentication failed')
    await vi.waitFor(() =>
      expect(calls.some(([name]) => name === 'connections.authenticate')).toBe(true)
    )
    await controller.connectLocal()
    auth.reject(new Error('authentication failed'))
    await failure
    expect(controller.getSnapshot().connection?.connectionId).toBe('local')
    expect(calls).toContainEqual(['connections.close', 'remote'])
    expect(calls).not.toContainEqual(['connections.close', 'local'])
  })

  it('closes an elevated local connection that completes after disconnect', async () => {
    const opened = deferred<ReturnType<typeof connection>>()
    const invoke = vi.fn(async (capability: string) =>
      capability === 'localService.connection' ? opened.promise : null
    )
    const controller = new TeacherController({
      invoke,
      onEvent: () => () => undefined
    } as unknown as LabHost)
    const pending = controller.connectLocal()
    const failure = expect(pending).rejects.toThrow('连接已取消')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('localService.connection'))
    await controller.disconnect()
    opened.resolve(connection('cancelled'))
    await failure
    expect(controller.getSnapshot().connection).toBeNull()
    expect(invoke).toHaveBeenCalledWith('connections.close', 'cancelled')
  })
})
