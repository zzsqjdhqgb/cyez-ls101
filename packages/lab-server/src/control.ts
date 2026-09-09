import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createConnection, createServer, type Socket } from 'node:net'
import { chmod, lstat, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const LIMIT = 64 * 1024
const operationTimeout = (operation: string): number =>
  operation === 'prepare-upgrade' ? 30 * 60 * 1000 : 30000
export function controlPath(root: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\ls101-lab-${createHmac('sha256', 'ls101-path').update(resolve(root).toLowerCase()).digest('hex').slice(0, 32)}`
    : join(root, 'control.sock')
}
function encrypt(key: Buffer, direction: 'request' | 'response', message: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(direction))
  const ciphertext = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()])
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('base64')
  })
}
function decrypt(key: Buffer, direction: 'request' | 'response', envelope: string): string {
  const value = JSON.parse(envelope)
  if (
    !value ||
    typeof value.iv !== 'string' ||
    !/^[a-f0-9]{24}$/.test(value.iv) ||
    typeof value.tag !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.tag) ||
    typeof value.ciphertext !== 'string'
  )
    throw new Error('Invalid local control envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'hex'))
  decipher.setAAD(Buffer.from(direction))
  decipher.setAuthTag(Buffer.from(value.tag, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8')
}

function readMessage(socket: Socket): Promise<string> {
  return new Promise((done, fail) => {
    let bytes = 0
    const chunks: Buffer[] = []
    const cleanup = (): void => {
      socket.off('data', data)
      socket.off('error', error)
      socket.off('end', end)
      socket.off('close', end)
    }
    const error = (reason?: Error): void => {
      cleanup()
      fail(reason ?? new Error('Local control connection failed'))
    }
    const end = (): void => {
      cleanup()
      fail(new Error('Local control response incomplete'))
    }
    const data = (chunk: Buffer): void => {
      bytes += chunk.length
      if (bytes > LIMIT) {
        cleanup()
        socket.destroy()
        fail(new Error('Local control message too large'))
        return
      }
      chunks.push(chunk)
      if (chunk.includes(10)) {
        const all = Buffer.concat(chunks)
        cleanup()
        if (all.indexOf(10) !== all.length - 1) {
          fail(new Error('Invalid local control framing'))
          return
        }
        done(all.subarray(0, -1).toString('utf8'))
      }
    }
    socket.on('data', data)
    socket.once('error', error)
    socket.once('end', end)
    socket.once('close', end)
  })
}

export async function readControlKey(root: string): Promise<Buffer> {
  const filename = join(root, 'control.key')
  const info = await lstat(filename)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size !== 32 ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  )
    throw new Error('Local control key permissions invalid')
  return readFile(filename)
}

export async function requestLocalControl<T>(
  root: string,
  operation: string,
  input?: unknown
): Promise<T> {
  const key = await readControlKey(root)
  const socket = createConnection(controlPath(root))
  socket.setTimeout(30000, () => socket.destroy(new Error('Local control timed out')))
  socket.on('error', () => undefined)
  try {
    const nonce = JSON.parse(await readMessage(socket)) as unknown
    if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce))
      throw new Error('Invalid local control challenge')
    const message = JSON.stringify({ nonce, operation, input })
    const envelope = encrypt(key, 'request', message)
    if (Buffer.byteLength(envelope) >= LIMIT) throw new Error('Local control message too large')
    const response = readMessage(socket)
    socket.setTimeout(operationTimeout(operation))
    socket.write(`${envelope}\n`)
    const result = JSON.parse(decrypt(key, 'response', await response))
    if (result.nonce !== nonce) throw new Error('Stale local control response')
    if (!result.ok) throw Object.assign(new Error(result.error), { code: result.error })
    return result.value as T
  } finally {
    socket.destroy()
  }
}

export async function listenLocalControl(
  root: string,
  key: Buffer,
  invoke: (operation: string, input: unknown) => Promise<unknown>
): Promise<{ close(): Promise<void> }> {
  const sockets = new Set<Socket>()
  const jobs = new Set<Promise<void>>()
  const server = createServer((socket) => {
    if (sockets.size >= 32) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.on('error', () => undefined)
    socket.once('close', () => sockets.delete(socket))
    socket.setTimeout(30000, () => socket.destroy())
    const job = (async () => {
      const nonce = randomBytes(32).toString('hex')
      const request = readMessage(socket)
      socket.write(`${JSON.stringify(nonce)}\n`)
      const message = JSON.parse(decrypt(key, 'request', await request))
      if (message.nonce !== nonce || typeof message.operation !== 'string')
        throw new Error('Invalid local control request')
      socket.setTimeout(operationTimeout(message.operation))
      let response: string
      try {
        response = JSON.stringify({
          nonce,
          ok: true,
          value: await invoke(message.operation, message.input)
        })
      } catch (error) {
        const code = (error as { code?: string }).code
        response = JSON.stringify({
          nonce,
          ok: false,
          error:
            typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'LOCAL_OPERATION_FAILED'
        })
      }
      const output = encrypt(key, 'response', response)
      if (Buffer.byteLength(output) >= LIMIT) throw new Error('Local response too large')
      socket.end(`${output}\n`)
    })().catch(() => {
      socket.destroy()
    })
    jobs.add(job)
    void job.finally(() => jobs.delete(job))
  })
  const path = controlPath(root)
  // The runtime owns a separate lifetime lock before removing a stale Unix socket.
  if (process.platform !== 'win32') {
    const previous = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (previous && !previous.isSocket()) throw new Error('Unexpected local control path')
    if (previous) await rm(path)
  }
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(path, () => {
      server.off('error', fail)
      done()
    })
  })
  if (process.platform !== 'win32') await chmod(path, 0o600)
  return {
    close: async () => {
      await new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => done())
      })
      await Promise.allSettled(jobs)
    }
  }
}
