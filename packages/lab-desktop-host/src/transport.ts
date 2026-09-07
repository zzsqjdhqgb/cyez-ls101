import { Agent, request as httpsRequest } from 'node:https'
import { connect, type TLSSocket } from 'node:tls'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import {
  API_PREFIX,
  CONTROL_BYTES,
  DEFAULT_LIMITS,
  operationDefinitions,
  validateParameters,
  validateRequest,
  validateResponse,
  type OperationId,
  type Schema
} from '@ls101/lab-contracts'
import type { OperationInput, TransportResponse } from '@ls101/lab-client'

export interface TrustedTarget {
  baseUrl: string
  fingerprint: string
  serverId?: string
}
export interface Connection extends TrustedTarget {
  id: string
  epoch: number
  role: 'teacher' | 'student' | 'public'
  token?: string
}
export interface ArchiveHandle {
  handle: string
  sha256: string
  bytes: number
}

export class PinnedTransport {
  private readonly connections = new Map<string, Connection>()
  private readonly files = new Map<
    string,
    { path: string; connectionId: string; digest: string; bytes: number }
  >()
  private epoch = 0
  constructor(
    readonly directory: string,
    readonly version: string
  ) {}

  async open(
    target: TrustedTarget,
    role: Connection['role'],
    token?: string
  ): Promise<{ connectionId: string; epoch: number; info: Schema<'Info'> }> {
    validateTarget(target)
    const connection: Connection = {
      ...target,
      id: randomUUID(),
      epoch: ++this.epoch,
      role: 'public'
    }
    this.connections.set(connection.id, connection)
    try {
      const response = await this.request(connection.id, 'getInfo', {})
      if (response.status !== 200) throw new Error('Service information unavailable')
      const info = response.body as Schema<'Info'>
      if (target.serverId && info.serverId !== target.serverId)
        throw new Error('Service identity mismatch')
      connection.serverId = info.serverId
      connection.role = role
      connection.token = token
      return { connectionId: connection.id, epoch: connection.epoch, info }
    } catch (error) {
      this.connections.delete(connection.id)
      throw error
    }
  }

  get(id: string): Connection {
    const connection = this.connections.get(id)
    if (!connection) throw new Error('Connection is closed')
    return connection
  }

  close(id: string): void {
    this.connections.delete(id)
  }

  async authenticate(id: string, password?: string, localProof?: string): Promise<void> {
    const connection = this.get(id)
    const response = await this.perform(
      connection,
      'postTeacherSessions',
      { body: password === undefined ? {} : { password } },
      undefined,
      localProof ? { 'X-LS101-Local-Authorization': localProof } : {}
    )
    if (response.status !== 200) throw new Error((response.body as Schema<'Error'>).error.code)
    connection.token = (response.body as Schema<'Session'>).token
    connection.role = 'teacher'
  }

  async registerArchive(connectionId: string, filename: string): Promise<ArchiveHandle> {
    this.get(connectionId)
    const bytes = (await stat(filename)).size
    if (
      !Number.isSafeInteger(bytes) ||
      bytes > Math.max(DEFAULT_LIMITS.maxExamArchiveBytes, DEFAULT_LIMITS.maxSubmissionArchiveBytes)
    )
      throw new Error('Archive too large')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(filename)) hash.update(chunk)
    const handle = randomUUID(),
      sha256 = hash.digest('hex')
    this.files.set(handle, { path: filename, connectionId, digest: sha256, bytes })
    return { handle, sha256, bytes }
  }

  file(handle: string, connectionId?: string): string {
    const file = this.files.get(handle)
    if (!file || (connectionId && file.connectionId !== connectionId))
      throw new Error('Invalid archive handle')
    return file.path
  }

  async request(
    id: string,
    operationId: OperationId,
    input: OperationInput,
    signal?: AbortSignal
  ): Promise<TransportResponse> {
    const connection = this.get(id),
      definition = operationDefinitions[operationId]
    if (!definition || (definition.role !== 'public' && definition.role !== connection.role))
      throw new Error('Operation not allowed for this connection')
    if (operationId === 'postTeacherSessions')
      throw new Error('Authentication uses a separate host capability')
    return this.perform(connection, operationId, input, signal)
  }

  private async perform(
    connection: Connection,
    id: OperationId,
    input: OperationInput,
    signal?: AbortSignal,
    privateHeaders: Record<string, string> = {}
  ): Promise<TransportResponse> {
    const definition = operationDefinitions[id]
    validateParameters(id, 'path', input.path ?? {})
    validateParameters(id, 'query', input.query ?? {})
    const url = new URL(
      `${API_PREFIX}${definition.route.replace(/\{([^}]+)\}/g, (_, key: string) => encodeURIComponent(input.path![key]))}`,
      connection.baseUrl
    )
    for (const [key, value] of Object.entries(input.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value))
    const headers: Record<string, string> = {
      'X-LS101-Client-Version': this.version,
      ...privateHeaders
    }
    if (connection.token) headers.Authorization = `Bearer ${connection.token}`
    if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey
    if (input.taskLease) headers['X-LS101-Task-Lease'] = input.taskLease
    let file: string | undefined, body: Buffer | undefined
    if (input.archive) {
      const archive = this.files.get(input.archive.handle)
      if (
        !archive ||
        archive.connectionId !== connection.id ||
        archive.digest !== input.archive.sha256 ||
        archive.bytes !== input.archive.bytes
      )
        throw new Error('Invalid archive ownership')
      file = archive.path
      headers['Content-Type'] = Object.keys(definition.requestBody!.content)[0]
      headers['Content-Length'] = String(archive.bytes)
      headers['X-LS101-Archive-SHA256'] = archive.digest
    } else if (input.body !== undefined) {
      validateRequest(id, input.body)
      body = Buffer.from(JSON.stringify(input.body))
      if (body.length > CONTROL_BYTES) throw new Error('Control message too large')
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(body.length)
    }
    validateParameters(
      id,
      'header',
      Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
    )
    const socket = await pinnedSocket(connection, signal)
    const agent = new Agent({ keepAlive: false })
    agent.createConnection = () => socket
    try {
      return await new Promise<TransportResponse>((resolve, reject) => {
        const call = httpsRequest(
          url,
          { method: definition.method, headers, agent, signal },
          (response) => {
            void (async () => {
              const status = response.statusCode ?? 503
              if (status >= 300 && status < 400)
                throw new Error('Service redirects are not allowed')
              const contentType = String(response.headers['content-type'] ?? '').split(';')[0]
              if (contentType === 'application/json' || status >= 400 || status === 204) {
                const chunks: Buffer[] = []
                let size = 0
                for await (const chunk of response) {
                  size += chunk.length
                  if (size > CONTROL_BYTES) throw new Error('Control response too large')
                  chunks.push(chunk)
                }
                const parsed = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
                validateResponse(id, status, parsed)
                const retryAfter = Number(response.headers['retry-after'])
                resolve({
                  status,
                  body: parsed,
                  ...(Number.isSafeInteger(retryAfter) && retryAfter >= 1 ? { retryAfter } : {})
                })
                return
              }
              const declaredLength = Number(response.headers['content-length'])
              const declaredDigest = response.headers['x-ls101-archive-sha256']
              if (!Number.isSafeInteger(declaredLength) || declaredLength < 0)
                throw new Error('Archive length missing')
              const maxBytes =
                contentType === 'application/x-ls101-enrollment'
                  ? 64 * 1024
                  : contentType === 'application/zip' ||
                      contentType === 'application/x-7z-compressed'
                    ? 128 * 1024 ** 3
                    : DEFAULT_LIMITS.maxExamArchiveBytes
              if (declaredLength > maxBytes) throw new Error('Archive too large')
              await mkdir(this.directory, { recursive: true, mode: 0o700 })
              const handle = randomUUID(),
                temporary = join(this.directory, `${handle}.part`),
                target = join(this.directory, handle)
              const hash = createHash('sha256')
              let received = 0
              const meter = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                  received += chunk.length
                  if (received > declaredLength)
                    return callback(new Error('Archive length exceeded'))
                  hash.update(chunk)
                  callback(null, chunk)
                }
              })
              try {
                await pipeline(
                  response,
                  meter,
                  createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
                  { signal }
                )
                const digest = hash.digest('hex')
                if (received !== declaredLength || (declaredDigest && digest !== declaredDigest))
                  throw new Error('Archive integrity mismatch')
                const file = await open(temporary, 'r+')
                try {
                  await file.sync()
                } finally {
                  await file.close()
                }
                await rename(temporary, target)
                this.files.set(handle, {
                  path: target,
                  connectionId: connection.id,
                  digest,
                  bytes: received
                })
                resolve({ status, archive: { handle, sha256: digest, bytes: received } })
              } finally {
                await rm(temporary, { force: true })
              }
            })().catch((error) => {
              response.destroy()
              reject(error)
            })
          }
        )
        call.on('error', reject)
        call.setTimeout(file || definition.route.endsWith('/archive') ? 120000 : 10000, () =>
          call.destroy(new Error('Transfer timed out'))
        )
        if (file) void pipeline(createReadStream(file), call, { signal }).catch(reject)
        else call.end(body)
      })
    } finally {
      agent.destroy()
      socket.destroy()
    }
  }
}

export function validateTarget(target: TrustedTarget): void {
  const url = new URL(target.baseUrl)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !/^sha256:[a-f0-9]{64}$/.test(target.fingerprint)
  )
    throw new Error('Invalid trusted service target')
}

export async function pinnedSocket(
  target: TrustedTarget,
  signal?: AbortSignal
): Promise<TLSSocket> {
  validateTarget(target)
  const url = new URL(target.baseUrl)
  return new Promise((resolve, reject) => {
    // Certificate-chain trust is replaced only for this socket by explicit SPKI trust.
    // No HTTP request, headers, or credentials exist until the pin has been checked.
    const socket = connect({
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port || 443),
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    })
    const abort = (): void => {
      socket.destroy(new Error('Connection cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    socket.once('close', () => signal?.removeEventListener('abort', abort))
    if (signal?.aborted) abort()
    socket.setTimeout(10000, () => socket.destroy(new Error('TLS connection timed out')))
    socket.once('error', reject)
    socket.once('secureConnect', () => {
      try {
        const peer = socket.getPeerCertificate()
        if (!peer.raw) throw new Error('Service certificate missing')
        const certificate = new X509Certificate(peer.raw)
        const fingerprint = `sha256:${createHash('sha256')
          .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
          .digest('hex')}`
        if (fingerprint !== target.fingerprint) throw new Error('Service public key changed')
        if (
          Date.parse(certificate.validTo) < Date.now() ||
          Date.parse(certificate.validFrom) > Date.now()
        )
          throw new Error('Service certificate expired or not yet valid')
        socket.setTimeout(0)
        resolve(socket)
      } catch (error) {
        socket.destroy()
        reject(error)
      }
    })
  })
}
