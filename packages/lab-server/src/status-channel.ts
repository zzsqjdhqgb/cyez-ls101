import { createHash } from 'node:crypto'
import { createConnection, createServer, type Socket } from 'node:net'
import { resolve } from 'node:path'
import type { RuntimeStatus } from './runtime'

const MAX_BYTES = 64 * 1024

export function statusChannelPath(root: string): string {
  const path = resolve(root)
  const id = createHash('sha256')
    .update(process.platform === 'win32' ? path.toLowerCase() : path)
    .digest('hex')
    .slice(0, 32)
  // Linux abstract sockets do not require traversal of the private service data directory.
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\ls101-lab-status-${id}`
    : `\0ls101-lab-status-${id}`
}

/** Public local observation only: no commands, credentials or authorization proofs. */
export async function listenServiceStatus(
  root: string,
  status: () => Promise<RuntimeStatus>
): Promise<{ close(): Promise<void> }> {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    if (sockets.size >= 32) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    socket.setTimeout(5000, () => socket.destroy())
    // This channel never accepts or dispatches a request body.
    socket.on('data', () => socket.destroy())
    void status().then(
      (value) => {
        const bytes = JSON.stringify(value)
        if (Buffer.byteLength(bytes) > MAX_BYTES) socket.destroy()
        else socket.end(bytes)
      },
      () => socket.destroy()
    )
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(
      {
        path: statusChannelPath(root),
        ...(process.platform === 'win32' ? { readableAll: true, writableAll: true } : {})
      },
      () => {
        server.off('error', fail)
        done()
      }
    )
  })
  return {
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => done())
      })
  }
}

export function readServiceStatus(root: string): Promise<RuntimeStatus> {
  return new Promise((done, fail) => {
    const socket = createConnection(statusChannelPath(root))
    const chunks: Buffer[] = []
    let size = 0
    socket.setTimeout(5000, () => socket.destroy(new Error('LOCAL_STATUS_UNAVAILABLE')))
    socket.on('error', fail)
    socket.once('close', () => fail(new Error('LOCAL_STATUS_UNAVAILABLE')))
    socket.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BYTES) socket.destroy(new Error('LOCAL_STATUS_UNAVAILABLE'))
      else chunks.push(chunk)
    })
    socket.once('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RuntimeStatus
        if (!['running', 'uninitialized', 'unavailable'].includes(value?.state))
          throw new Error('LOCAL_STATUS_UNAVAILABLE')
        done(value)
      } catch (error) {
        fail(error)
      } finally {
        socket.destroy()
      }
    })
  })
}
