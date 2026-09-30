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

async function connectedSession() {
  let nextConnection = 0
  const invoke = vi.fn(async (capability: string, _input?: unknown): Promise<unknown> => {
    if (capability === 'localService.connection') return connection(`local-${++nextConnection}`)
    return null
  })
  const session = new TeacherSession({ invoke } as unknown as LabHost)
  vi.spyOn(session, 'refreshService').mockResolvedValue()
  await session.connectLocal()
  return { session, invoke }
}

it('reuses an unknown write key, but gives a successful subsequent operation a new key', async () => {
  const { session, invoke } = await connectedSession()
  const keys: string[] = []
  invoke.mockImplementation(async (capability, input) => {
    if (capability !== 'transport.request') return null
    keys.push((input as { input: { idempotencyKey: string } }).input.idempotencyKey)
    if (keys.length === 1) throw new Error('response lost')
    return { status: 200, body: { items: [] } }
  })
  const input = { body: { submissionIds: ['3f2504e0-4f89-41d3-9a0c-0305e82c3301'] } }
  await expect(session.mutate('postTeacherSubmissionsDelete', input)).rejects.toThrow(
    'response lost'
  )
  await expect(session.mutate('postTeacherSubmissionsDelete', input)).resolves.toEqual({
    items: []
  })
  await session.mutate('postTeacherSubmissionsDelete', input)
  expect(keys[0]).toMatch(/^[a-f\d-]{36}$/)
  expect(keys[1]).toBe(keys[0])
  expect(keys[2]).not.toBe(keys[0])
})

it.each(['TOKEN_EXPIRED', 'TOKEN_REVOKED', 'AUTH_REQUIRED'])(
  'disconnects the current session on %s',
  async (code) => {
    const { session, invoke } = await connectedSession()
    invoke.mockImplementation(async (capability) =>
      capability === 'transport.request'
        ? { status: 401, body: { error: { code, message: code, requestId: 'test-request' } } }
        : null
    )
    await expect(session.request('getTeacherExams')).rejects.toThrow(code)
    expect(session.getSnapshot()).toMatchObject({ connection: null, service: null })
    expect(invoke).toHaveBeenCalledWith('connections.close', 'local-1')
  }
)

it.each(['success', 'expired'] as const)(
  'cancels old requests and isolates a late %s after switching services',
  async (outcome) => {
    const { session, invoke } = await connectedSession()
    const pending = deferred<unknown>()
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (capability, input) =>
      capability === 'transport.request' ? pending.promise : original(capability, input)
    )
    const request = session.request('getTeacherExams')
    const rejected = expect(request).rejects.toThrow(
      outcome === 'success' ? '服务连接已切换' : 'TOKEN_EXPIRED'
    )
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('transport.request', expect.anything())
    )
    const requestId = (
      invoke.mock.calls.find(([name]) => name === 'transport.request')![1] as { requestId: string }
    ).requestId
    await session.connectLocal()
    expect(invoke).toHaveBeenCalledWith('transport.cancel', requestId)
    pending.resolve(
      outcome === 'success'
        ? { status: 200, body: { items: [], nextCursor: null } }
        : {
            status: 401,
            body: {
              error: { code: 'TOKEN_EXPIRED', message: 'expired', requestId: 'test-request' }
            }
          }
    )
    await rejected
    expect(session.getSnapshot().connection?.connectionId).toBe('local-2')
    expect(invoke).not.toHaveBeenCalledWith('connections.close', 'local-2')
  }
)
