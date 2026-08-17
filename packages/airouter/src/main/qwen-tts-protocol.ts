const MAX_HEADER_BYTES = 4096
const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024

export type QwenTtsProtocolMessage =
  | { type: 'ready'; version: number }
  | { type: 'result'; requestId: string; sampleRate: number; data: Uint8Array }
  | { type: 'error'; requestId: string; message: string }

interface PendingPayload {
  type: 'result' | 'error'
  requestId: string
  sampleRate?: number
  size: number
}

export class QwenTtsProtocolDecoder {
  private buffer = Buffer.alloc(0)
  private pending: PendingPayload | null = null

  constructor(
    private readonly onMessage: (message: QwenTtsProtocolMessage) => void,
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
      this.onError(new Error('Qwen TTS helper 返回了不完整的数据'))
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
          throw new Error('Qwen TTS helper 协议头超过限制')
        }
        return
      }
      if (newline > MAX_HEADER_BYTES) throw new Error('Qwen TTS helper 协议头超过限制')
      const header = this.buffer.subarray(0, newline).toString('utf8')
      this.buffer = this.buffer.subarray(newline + 1)
      this.parseHeader(header)
    }
  }

  private parseHeader(header: string): void {
    const fields = header.split(' ')
    if (fields[0] === 'READY' && fields.length === 2) {
      const version = parseInteger(fields[1], 1, 100)
      this.onMessage({ type: 'ready', version })
      return
    }
    if (fields[0] === 'RESULT' && fields.length === 4) {
      const requestId = parseRequestId(fields[1])
      const sampleRate = parseInteger(fields[2], 8000, 192000)
      const size = parseInteger(fields[3], 44, MAX_PAYLOAD_BYTES)
      this.pending = { type: 'result', requestId, sampleRate, size }
      return
    }
    if (fields[0] === 'ERROR' && fields.length === 3) {
      const requestId = parseRequestId(fields[1])
      const size = parseInteger(fields[2], 0, MAX_HEADER_BYTES)
      this.pending = { type: 'error', requestId, size }
      if (size === 0) {
        this.pending = null
        this.onMessage({ type: 'error', requestId, message: 'Qwen TTS 合成失败' })
      }
      return
    }
    throw new Error(`Qwen TTS helper 返回了未知协议消息：${header.slice(0, 120)}`)
  }
}

function parseInteger(value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) throw new Error('Qwen TTS helper 协议包含无效数字')
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error('Qwen TTS helper 协议数字超过限制')
  }
  return result
}

function parseRequestId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error('Qwen TTS helper 协议包含无效请求 ID')
  }
  return value
}
