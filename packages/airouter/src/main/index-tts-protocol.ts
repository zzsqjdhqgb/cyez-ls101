export const INDEX_TTS_MAX_TEXT_BYTES = 64 * 1024
export const INDEX_TTS_MAX_REQUEST_BYTES = 512 * 1024
const MAX_HEADER_BYTES = 4096
const MAX_RESULT_BYTES = 100 * 1024 * 1024

export type IndexTtsProtocolMessage =
  | { type: 'ready'; version: number }
  | { type: 'result'; requestId: string; sampleRate: number; data: Uint8Array }
  | { type: 'error'; requestId: string; message: string }

interface Payload {
  type: 'result' | 'error'
  requestId: string
  sampleRate: number
  data: Buffer
  offset: number
}

// Allocate each bounded payload once, including when pipe reads are very small.
export class IndexTtsProtocolDecoder {
  private header = Buffer.alloc(0)
  private payload: Payload | null = null
  private ended = false

  constructor(
    private readonly onMessage: (message: IndexTtsProtocolMessage) => void,
    private readonly onError: (error: Error) => void
  ) {}

  push(chunk: Uint8Array): void {
    if (this.ended) return
    const input = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    let offset = 0
    try {
      while (offset < input.length && !this.ended) {
        if (this.payload) {
          const pending = this.payload
          const count = Math.min(pending.data.length - pending.offset, input.length - offset)
          input.copy(pending.data, pending.offset, offset, offset + count)
          offset += count
          pending.offset += count
          if (pending.offset === pending.data.length) this.emitPayload()
          continue
        }
        const newline = input.indexOf(0x0a, offset)
        const end = newline < 0 ? input.length : newline
        if (this.header.length + end - offset > MAX_HEADER_BYTES) {
          throw new Error('IndexTTS helper 协议头超过限制')
        }
        this.header = Buffer.concat([this.header, input.subarray(offset, end)])
        offset = end + (newline < 0 ? 0 : 1)
        if (newline < 0) break
        const line = this.header.toString('utf8').replace(/\r$/, '')
        this.header = Buffer.alloc(0)
        this.parseHeader(line)
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  end(): void {
    if (this.ended) return
    if (this.header.length || this.payload) {
      this.fail(new Error('IndexTTS helper 返回了不完整的数据'))
    }
    this.ended = true
  }

  private fail(error: Error): void {
    this.ended = true
    this.header = Buffer.alloc(0)
    this.payload = null
    this.onError(error)
  }

  private parseHeader(line: string): void {
    const fields = line.split(' ')
    if (fields[0] === 'READY' && fields.length === 2) {
      this.onMessage({ type: 'ready', version: integer(fields[1], 1, 100) })
      return
    }
    if (
      (fields[0] === 'RESULT' && fields.length === 4) ||
      (fields[0] === 'ERROR' && fields.length === 3)
    ) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(fields[1])) {
        throw new Error('IndexTTS helper 请求 ID 无效')
      }
      const result = fields[0] === 'RESULT'
      const size = integer(
        fields[result ? 3 : 2],
        result ? 44 : 0,
        result ? MAX_RESULT_BYTES : MAX_HEADER_BYTES
      )
      this.payload = {
        type: result ? 'result' : 'error',
        requestId: fields[1],
        sampleRate: result ? integer(fields[2], 8000, 192000) : 0,
        data: Buffer.allocUnsafe(size),
        offset: 0
      }
      if (size === 0) this.emitPayload()
      return
    }
    throw new Error(`IndexTTS helper 协议消息无效：${line.slice(0, 120)}`)
  }

  private emitPayload(): void {
    const pending = this.payload!
    this.payload = null
    this.onMessage(
      pending.type === 'result'
        ? {
            type: 'result',
            requestId: pending.requestId,
            sampleRate: pending.sampleRate,
            data: pending.data
          }
        : {
            type: 'error',
            requestId: pending.requestId,
            message: pending.data.toString('utf8') || 'IndexTTS 推理失败'
          }
    )
  }
}

function integer(text: string, min: number, max: number): number {
  const value = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error('IndexTTS helper 协议数字无效或超过限制')
  }
  return value
}
