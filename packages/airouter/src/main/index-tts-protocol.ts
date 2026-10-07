const MAX_HEADER_BYTES = 4096
const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024
const MIN_SAMPLE_RATE = 8000
const MAX_SAMPLE_RATE = 192000

export type IndexTtsProtocolMessage =
  | { type: 'ready'; version: number }
  | { type: 'result'; requestId: string; sampleRate: number; data: Uint8Array }
  | { type: 'error'; requestId: string; message: string }

interface PendingPayload {
  type: 'result' | 'error'
  requestId: string
  sampleRate?: number
  size: number
}

export class IndexTtsProtocolDecoder {
  private buffer = Buffer.alloc(0)
  private pending: PendingPayload | null = null

  constructor(
    private readonly onMessage: (message: IndexTtsProtocolMessage) => void,
    private readonly onError: (error: Error) => void
  ) {}

  push(chunk: Uint8Array): void {
    if (!chunk.byteLength) return
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    try {
      this.drain()
    } catch (error) {
      this.buffer = Buffer.alloc(0)
      this.pending = null
      this.onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  end(): void {
    if (this.buffer.byteLength || this.pending) {
      this.onError(new Error('IndexTTS helper 返回了不完整的数据'))
    }
    this.buffer = Buffer.alloc(0)
    this.pending = null
  }

  private drain(): void {
    while (this.buffer.byteLength) {
      if (this.pending) {
        if (this.buffer.byteLength < this.pending.size) return
        const payload = this.buffer.subarray(0, this.pending.size)
        this.buffer = this.buffer.subarray(this.pending.size)
        const pending = this.pending
        this.pending = null
        if (pending.type === 'result') {
          this.onMessage({
            type: 'result',
            requestId: pending.requestId,
            sampleRate: pending.sampleRate as number,
            data: new Uint8Array(payload)
          })
        } else {
          this.onMessage({
            type: 'error',
            requestId: pending.requestId,
            message: payload.toString('utf8')
          })
        }
        continue
      }

      const newline = this.buffer.indexOf(0x0a)
      if (newline < 0) {
        if (this.buffer.byteLength > MAX_HEADER_BYTES) {
          throw new Error('IndexTTS helper 协议头超过限制')
        }
        return
      }
      if (newline > MAX_HEADER_BYTES) throw new Error('IndexTTS helper 协议头超过限制')
      const header = this.buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '')
      this.buffer = this.buffer.subarray(newline + 1)
      this.parseHeader(header)
    }
  }

  private parseHeader(header: string): void {
    const value = parseHeaderJson(header)
    if (value.type === 'ready') {
      this.onMessage({ type: 'ready', version: parseInteger(value.version, 1, 100) })
      return
    }
    if (value.type === 'result') {
      const requestId = parseRequestId(value.requestId)
      const sampleRate = parseInteger(value.sampleRate, MIN_SAMPLE_RATE, MAX_SAMPLE_RATE)
      const size = parseInteger(value.size, 44, MAX_PAYLOAD_BYTES)
      this.pending = { type: 'result', requestId, sampleRate, size }
      return
    }
    if (value.type === 'error') {
      const requestId = parseRequestId(value.requestId)
      const size = parseInteger(value.size, 0, MAX_HEADER_BYTES)
      this.pending = { type: 'error', requestId, size }
      if (size === 0) {
        this.pending = null
        this.onMessage({ type: 'error', requestId, message: 'IndexTTS 合成失败' })
      }
      return
    }
    throw new Error(`IndexTTS helper 返回了未知协议消息：${header.slice(0, 120)}`)
  }
}

function parseHeaderJson(header: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(header)
  } catch {
    throw new Error(`IndexTTS helper 返回了未知协议消息：${header.slice(0, 120)}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`IndexTTS helper 返回了未知协议消息：${header.slice(0, 120)}`)
  }
  return value as Record<string, unknown>
}

function parseInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('IndexTTS helper 协议包含无效数字')
  }
  if (value < min || value > max) throw new Error('IndexTTS helper 协议数字超过限制')
  return value
}

function parseRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error('IndexTTS helper 协议包含无效请求 ID')
  }
  return value
}
