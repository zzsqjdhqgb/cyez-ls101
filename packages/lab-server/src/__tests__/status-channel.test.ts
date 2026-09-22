import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { readServiceStatus, statusChannelPath } from '../status-channel'

async function withChannel(send: (socket: Socket) => void, check: (root: string) => Promise<void>) {
  const root = join(tmpdir(), `ls101-status-${randomUUID()}`)
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => undefined)
    socket.once('close', () => sockets.delete(socket))
    send(socket)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(statusChannelPath(root), resolve)
  })
  try {
    await check(root)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

it.each(['{"state":', '{"state":"stopped"}', 'x'.repeat(65537)])(
  'rejects malformed, unsupported or oversized local status responses (%#)',
  async (response) => {
    await withChannel(
      (socket) => socket.end(response),
      async (root) => {
        await expect(readServiceStatus(root)).rejects.toMatchObject({
          code: 'LOCAL_STATUS_INVALID_RESPONSE'
        })
      }
    )
  }
)

it('reports a stalled channel as timeout and closes its connection', async () => {
  await withChannel(
    () => undefined,
    async (root) => {
      await expect(readServiceStatus(root)).rejects.toMatchObject({ code: 'ETIMEDOUT' })
    }
  )
})
