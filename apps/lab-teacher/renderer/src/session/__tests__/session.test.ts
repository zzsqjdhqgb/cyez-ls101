import { describe, expect, it, vi } from 'vitest'
import type { LabHost } from '@ls101/lab-desktop-host'
import { TeacherSession, type SavedConnection } from '../session'

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
    const session = new TeacherSession(host)
    vi.spyOn(session, 'refreshService').mockResolvedValue()
    const old = session.connect(target, 'secret')
    const failure = expect(old).rejects.toThrow('authentication failed')
    await vi.waitFor(() =>
      expect(calls.some(([name]) => name === 'connections.authenticate')).toBe(true)
    )
    await session.connectLocal()
    auth.reject(new Error('authentication failed'))
    await failure
    expect(session.getSnapshot().connection?.connectionId).toBe('local')
    expect(calls).toContainEqual(['connections.close', 'remote'])
    expect(calls).not.toContainEqual(['connections.close', 'local'])
  })

  it('closes an elevated local connection that completes after disconnect', async () => {
    const opened = deferred<ReturnType<typeof connection>>()
    const invoke = vi.fn(async (capability: string) =>
      capability === 'localService.connection' ? opened.promise : null
    )
    const session = new TeacherSession({
      invoke,
      onEvent: () => () => undefined
    } as unknown as LabHost)
    const pending = session.connectLocal()
    const failure = expect(pending).rejects.toThrow('连接已取消')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('localService.connection'))
    await session.disconnect()
    opened.resolve(connection('cancelled'))
    await failure
    expect(session.getSnapshot().connection).toBeNull()
    expect(invoke).toHaveBeenCalledWith('connections.close', 'cancelled')
  })
})
