import { createServer, type Server } from 'node:https'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  CONTROL_BYTES,
  ContractError,
  matchOperation,
  validateParameters,
  validateRequest,
  validateResponse
} from '@ls101/lab-contracts'
import { LabService, type Context, type Result } from './service'
import { LabError, requireCondition } from './errors'

const activeHandlers = new WeakMap<Server, Set<Promise<void>>>()

export function createLabHttpServer(service: LabService): Server {
  const handlers = new Set<Promise<void>>()
  const server = createServer(
    {
      key: service.identity.privatePem,
      cert: service.identity.certificate,
      minVersion: 'TLSv1.2',
      maxHeaderSize: 16384,
      requestTimeout: 120000,
      headersTimeout: 10000
    },
    (request, response) => {
      if (handlers.size >= 64) {
        response.writeHead(503, {
          'Content-Type': 'application/json',
          'Retry-After': '1',
          Connection: 'close'
        })
        response.end(
          JSON.stringify({
            error: {
              code: 'SERVICE_NOT_READY',
              message: 'Request capacity reached',
              requestId: randomUUID()
            }
          })
        )
        return
      }
      const work = handle(service, request, response)
      handlers.add(work)
      void work.finally(() => handlers.delete(work))
    }
  )
  server.maxRequestsPerSocket = 1000
  server.maxConnections = 256
  server.keepAliveTimeout = 5000
  activeHandlers.set(server, handlers)
  return server
}

export async function closeLabHttpServer(server: Server): Promise<void> {
  await new Promise<void>((done) => {
    server.close(() => done())
    server.closeAllConnections()
  })
  await Promise.allSettled(activeHandlers.get(server) ?? [])
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const value of request) {
    const chunk = Buffer.from(value)
    length += chunk.length
    if (length > CONTROL_BYTES) throw new LabError('PAYLOAD_TOO_LARGE')
    chunks.push(chunk)
  }
  if (!length) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new LabError('INVALID_REQUEST')
  }
}

async function handle(
  service: LabService,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const requestId = randomUUID()
  const controller = new AbortController()
  request.once('aborted', () => controller.abort())
  response.once('close', () => {
    if (!response.writableFinished) controller.abort()
  })
  response.setHeader('X-Request-Id', requestId)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  let result: Result | undefined
  try {
    // Native clients do not send browser Origin. No web origin has management authority.
    requireCondition(
      !request.headers.origin && !request.headers['access-control-request-method'],
      'AUTH_REQUIRED'
    )
    const url = new URL(request.url ?? '/', 'https://lab.invalid')
    const match = matchOperation(request.method ?? '', url.pathname)
    requireCondition(match, 'NOT_FOUND')
    const headers: Record<string, string | undefined> = {}
    for (const [name, value] of Object.entries(request.headers)) {
      requireCondition(!Array.isArray(value), 'INVALID_REQUEST')
      headers[name] = value
    }
    const headerNames = request.rawHeaders
      .filter((_, index) => index % 2 === 0)
      .map((name) => name.toLowerCase())
    for (const name of [
      'authorization',
      'x-ls101-client-version',
      'x-ls101-local-authorization',
      'idempotency-key',
      'x-ls101-archive-sha256'
    ]) {
      requireCondition(headerNames.filter((entry) => entry === name).length <= 1, 'INVALID_REQUEST')
    }
    validateParameters(match.id, 'header', headers)
    validateParameters(match.id, 'path', match.path)
    const query: Record<string, string> = {}
    for (const [key, value] of url.searchParams) {
      requireCondition(!Object.hasOwn(query, key), 'INVALID_REQUEST')
      query[key] = value
    }
    const context: Context = {
      id: match.id,
      path: match.path,
      query: validateParameters(match.id, 'query', query),
      headers,
      body: undefined,
      version: headers['x-ls101-client-version']!,
      loopback: ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        request.socket.remoteAddress ?? ''
      ),
      signal: controller.signal
    }
    if (match.operation.role !== 'public') {
      const authorization = headers.authorization
      requireCondition(authorization && authorization.startsWith('Bearer '), 'AUTH_REQUIRED')
      context.principal = service.security.authenticate(
        authorization.slice(7),
        match.operation.role
      )
      const diagnostic = ['getStudentState', 'postStudentHeartbeat'].includes(match.id)
      if (!diagnostic) service.assertAuthorized(context)
    }
    const contentType = headers['content-type']?.split(';')[0].trim().toLowerCase()
    if (match.operation.requestBody) {
      requireCondition(
        contentType && match.operation.requestBody.content[contentType],
        'UNSUPPORTED_MEDIA_TYPE'
      )
      if (contentType === 'application/json') {
        context.body = await readBody(request)
        validateRequest(match.id, context.body, contentType)
      } else context.stream = request
    } else {
      context.body = await readBody(request)
      validateRequest(match.id, context.body)
    }
    const handler = service.handlers[match.id]
    requireCondition(handler, 'NOT_FOUND')
    service.tasks.expire()
    result = await handler(context)
    if (!result.file && !result.bytes) {
      try {
        validateResponse(match.id, result.status, result.body)
      } catch {
        throw new LabError('STORAGE_UNAVAILABLE')
      }
    }
    if (result.file || result.bytes) {
      const length = result.file ? (await stat(result.file)).size : result.bytes!.byteLength
      response.setHeader('Content-Type', result.contentType ?? 'application/octet-stream')
      response.setHeader('Content-Length', length)
      if (result.filename)
        response.setHeader(
          'Content-Disposition',
          `attachment; filename="${result.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`
        )
      if (result.digest) response.setHeader('X-LS101-Archive-SHA256', result.digest)
      response.writeHead(result.status)
      if (result.file)
        await pipeline(createReadStream(result.file), response, { signal: controller.signal })
      else response.end(result.bytes)
    } else {
      response.statusCode = result.status
      if (result.body !== undefined) {
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify(result.body))
      } else response.end()
    }
  } catch (error) {
    if (response.headersSent) {
      response.destroy()
      return
    }
    const failure =
      error instanceof LabError
        ? error
        : error instanceof ContractError
          ? new LabError('INVALID_REQUEST')
          : new LabError('STORAGE_UNAVAILABLE')
    response.statusCode = failure.status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (failure.retryAfter) response.setHeader('Retry-After', failure.retryAfter)
    response.end(
      JSON.stringify({
        error: {
          code: failure.code,
          message: failure.message,
          requestId,
          ...(failure.details ? { details: failure.details } : {})
        }
      })
    )
  } finally {
    result?.release?.()
  }
}
