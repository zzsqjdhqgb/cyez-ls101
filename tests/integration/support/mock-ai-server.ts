import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const OVERSIZED_IMAGE_BASE64 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.alloc(20 * 1024 * 1024)
]).toString('base64')

export interface RecordedAiRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: Record<string, unknown>
  closedBeforeResponse: boolean
}

interface PendingMockFailure {
  status: number
  body: unknown
}

export class MockAiServer {
  private server: Server | null = null
  private readonly requests: RecordedAiRequest[] = []
  private readonly failures = new Map<string, PendingMockFailure[]>()
  private readonly timers = new Set<NodeJS.Timeout>()

  get baseUrl(): string {
    if (!this.server) throw new Error('Mock AI server is not running')
    const address = this.server.address() as AddressInfo
    return `http://127.0.0.1:${address.port}/v1`
  }

  async start(): Promise<void> {
    if (this.server) return
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          this.sendJson(response, 500, {
            error: { message: error instanceof Error ? error.message : String(error) }
          })
        } else if (!response.writableEnded) {
          response.end()
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(0, '127.0.0.1', () => {
        this.server?.off('error', reject)
        resolve()
      })
    })
  }

  reset(): void {
    this.requests.length = 0
    this.failures.clear()
    this.timers.forEach(clearTimeout)
    this.timers.clear()
  }

  async close(): Promise<void> {
    this.reset()
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }

  allRequests(): readonly RecordedAiRequest[] {
    return this.requests
  }

  /** Makes the next matching request fail with the given status instead of the normal handler. */
  failNextRequest(path: string, status = 500, body?: unknown): void {
    const pending = this.failures.get(path) ?? []
    pending.push({ status, body: body ?? { error: { message: 'mock request failed' } } })
    this.failures.set(path, pending)
  }

  findRequest(path: string): RecordedAiRequest | undefined {
    return this.requests.find((request) => request.path === path)
  }

  async waitForRequest(
    predicate: (request: RecordedAiRequest) => boolean,
    timeoutMs = 5_000
  ): Promise<RecordedAiRequest> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const request = this.requests.find(predicate)
      if (request) return request
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('Timed out waiting for mock AI request')
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJsonBody(request)
    const recorded: RecordedAiRequest = {
      method: request.method ?? 'GET',
      path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      headers: normalizeHeaders(request),
      body,
      closedBeforeResponse: false
    }
    this.requests.push(recorded)
    response.on('close', () => {
      recorded.closedBeforeResponse = !response.writableEnded
    })

    const failure = this.failures.get(recorded.path)?.shift()
    if (failure) {
      this.sendJson(response, failure.status, failure.body)
      return
    }

    if (recorded.path === '/v1/models') {
      this.sendJson(response, 200, {
        object: 'list',
        data: [
          { id: 'z-model', name: 'Zulu Model', object: 'model' },
          'a-model',
          { id: 'mock-text', name: 'Mock Text', object: 'model' },
          { id: 'mock-reasoning', name: 'Mock Reasoning', object: 'model' },
          { id: 'mock-image', name: 'Mock Image', object: 'model' },
          { invalid: true }
        ]
      })
      return
    }

    if (recorded.path === '/v1/chat/completions') {
      this.handleOpenAiText(response, recorded)
      return
    }

    if (recorded.path === '/v1/messages') {
      this.handleAnthropicText(response, recorded)
      return
    }

    if (recorded.path === '/v1/images/generations') {
      this.handleImage(response, recorded)
      return
    }

    this.sendJson(response, 404, { error: { message: `Unhandled path: ${recorded.path}` } })
  }

  private handleOpenAiText(response: ServerResponse, request: RecordedAiRequest): void {
    const model = String(request.body.model ?? '')
    if (model.includes('http-error')) {
      this.sendJson(response, 401, { error: { message: 'mock authentication failed' } })
      return
    }
    if (model.includes('slow')) {
      this.delay(
        response,
        () => {
          if (request.body.stream !== true) {
            this.sendJson(response, 200, openAiCompletion(model, 'OK'))
            return
          }
          this.sendOpenAiStream(response, model, 'stop')
        },
        2_000
      )
      return
    }
    if (request.body.stream !== true) {
      this.sendJson(response, 200, openAiCompletion(model, 'OK'))
      return
    }
    if (model.includes('stream-error')) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      response.end(
        `data: ${JSON.stringify({
          error: { message: 'mock stream failure', type: 'server_error', code: 'mock_error' }
        })}\n\n`
      )
      return
    }
    if (model.includes('partial-stall')) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      this.writeOpenAiDelta(response, model, 'Partial ')
      this.delay(
        response,
        () => {
          this.writeOpenAiDelta(response, model, 'response')
          this.writeOpenAiDelta(response, model, null, 'stop')
          response.end('data: [DONE]\n\n')
        },
        2_000
      )
      return
    }
    if (model.includes('mock-json')) {
      const payload = model.includes('image')
        ? '{"title":"AI 标题","picture":"A green circle icon"}'
        : '{"title":"AI 标题","answer":"AI answer"}'
      this.sendOpenAiStream(response, model, 'stop', [payload])
      return
    }
    if (model.includes('mock-nonjson')) {
      this.sendOpenAiStream(response, model, 'stop', ['这不是一个合法的 JSON 响应'])
      return
    }
    const finishReason = model.includes('length')
      ? 'length'
      : model.includes('content-filter')
        ? 'content_filter'
        : 'stop'
    this.sendOpenAiStream(response, model, finishReason)
  }

  private sendOpenAiStream(
    response: ServerResponse,
    model: string,
    finishReason: string,
    deltas: string[] = ['Mock ', 'response']
  ): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    for (const content of deltas) this.writeOpenAiDelta(response, model, content, null)
    this.writeOpenAiDelta(response, model, null, finishReason)
    response.end('data: [DONE]\n\n')
  }

  private writeOpenAiDelta(
    response: ServerResponse,
    model: string,
    content: string | null,
    reason: string | null = null
  ): void {
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        created: 1,
        model,
        choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: reason }]
      })}\n\n`
    )
  }

  private handleAnthropicText(response: ServerResponse, request: RecordedAiRequest): void {
    const model = String(request.body.model ?? '')
    if (model.includes('http-error')) {
      this.sendJson(response, 400, {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'mock anthropic failure' }
      })
      return
    }
    if (request.body.stream !== true) {
      this.sendJson(response, 200, anthropicMessage(model, 'OK'))
      return
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    writeSse(response, 'message_start', {
      type: 'message_start',
      message: anthropicMessage(model, '')
    })
    if (model.includes('reasoning')) {
      writeSse(response, 'content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' }
      })
      writeSse(response, 'content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Mock reasoning' }
      })
      writeSse(response, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    }
    const textIndex = model.includes('reasoning') ? 1 : 0
    writeSse(response, 'content_block_start', {
      type: 'content_block_start',
      index: textIndex,
      content_block: { type: 'text', text: '', citations: null }
    })
    writeSse(response, 'content_block_delta', {
      type: 'content_block_delta',
      index: textIndex,
      delta: { type: 'text_delta', text: 'Anthropic response' }
    })
    writeSse(response, 'content_block_stop', {
      type: 'content_block_stop',
      index: textIndex
    })
    writeSse(response, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 4 }
    })
    writeSse(response, 'message_stop', { type: 'message_stop' })
    response.end()
  }

  private handleImage(response: ServerResponse, request: RecordedAiRequest): void {
    const model = String(request.body.model ?? '')
    if (model.includes('http-error')) {
      this.sendJson(response, 429, { error: { message: 'mock image quota exceeded' } })
      return
    }
    const send = (): void =>
      this.sendJson(response, 200, {
        created: 1,
        data: [
          {
            b64_json: model.includes('invalid-media')
              ? Buffer.from('not an image').toString('base64')
              : model.includes('oversized')
                ? OVERSIZED_IMAGE_BASE64
                : PNG_BASE64,
            revised_prompt: String(request.body.prompt ?? '')
          }
        ]
      })
    if (model.includes('slow')) this.delay(response, send, 2_000)
    else send()
  }

  private delay(response: ServerResponse, callback: () => void, milliseconds: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (!response.destroyed) callback()
    }, milliseconds)
    this.timers.add(timer)
    response.once('close', () => {
      clearTimeout(timer)
      this.timers.delete(timer)
    })
  }

  private sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }
}

function normalizeHeaders(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(', ') : (value ?? '')
    ])
  )
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function openAiCompletion(model: string, content: string): Record<string, unknown> {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, refusal: null },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  }
}

function anthropicMessage(model: string, content: string): Record<string, unknown> {
  return {
    id: 'msg_mock',
    type: 'message',
    role: 'assistant',
    model,
    content: content ? [{ type: 'text', text: content }] : [],
    stop_reason: content ? 'end_turn' : null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: content ? 1 : 0 }
  }
}

function writeSse(response: ServerResponse, event: string, body: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`)
}

export const MOCK_PNG_BASE64 = PNG_BASE64
