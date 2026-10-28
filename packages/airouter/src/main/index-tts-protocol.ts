export const INDEX_TTS_MAX_TEXT_BYTES = 64 * 1024
export const INDEX_TTS_MAX_REQUEST_BYTES = 512 * 1024

const MAX_HEADER_BYTES = 4096
const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024

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
  // 未消费数据按分块累积（push 时拷贝入队），避免每个 chunk 都重新拼接整个缓冲区的 O(n²) 开销
  private chunks: Buffer[] = []
  private headOffset = 0
  private bufferedBytes = 0
  private pending: PendingPayload | null = null

  constructor(
    private readonly onMessage: (message: IndexTtsProtocolMessage) => void,
    private readonly onError: (error: Error) => void
  ) {}

  push(chunk: Uint8Array): void {
    if (!chunk.byteLength) return
    this.chunks.push(Buffer.from(chunk))
    this.bufferedBytes += chunk.byteLength
    try {
      this.drain()
    } catch (error) {
      this.reset()
      this.onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  end(): void {
    if (this.bufferedBytes || this.pending) {
      this.onError(new Error('IndexTTS helper 返回了不完整的数据'))
    }
    this.reset()
  }

  private reset(): void {
    this.chunks = []
    this.headOffset = 0
    this.bufferedBytes = 0
    this.pending = null
  }

  private drain(): void {
    while (this.bufferedBytes) {
      if (this.pending) {
        if (this.bufferedBytes < this.pending.size) return
        const pending = this.pending
        this.pending = null
        if (pending.type === 'result') {
          this.onMessage({
            type: 'result',
            requestId: pending.requestId,
            sampleRate: pending.sampleRate as number,
            data: this.takePayload(pending.size)
          })
        } else {
          this.onMessage({
            type: 'error',
            requestId: pending.requestId,
            message: this.takeBytes(pending.size).toString('utf8')
          })
        }
        continue
      }

      const newline = this.findNewline()
      if (newline < 0) {
        if (this.bufferedBytes > MAX_HEADER_BYTES) {
          throw new Error('IndexTTS helper 协议头超过限制')
        }
        return
      }
      if (newline > MAX_HEADER_BYTES) throw new Error('IndexTTS helper 协议头超过限制')
      const header = this.takeBytes(newline).toString('utf8').replace(/\r$/, '')
      this.consume(1)
      this.parseHeader(header)
    }
  }

  /** 在未消费数据中查找换行符，返回相对消费起点的偏移；未找到返回 -1。 */
  private findNewline(): number {
    let scanned = 0
    for (let index = 0; index < this.chunks.length; index++) {
      const chunk = this.chunks[index]
      const start = index === 0 ? this.headOffset : 0
      const found = chunk.indexOf(0x0a, start)
      if (found >= 0) return scanned + found - start
      scanned += chunk.length - start
    }
    return -1
  }

  /** 取出 count 字节的连续 Buffer（跨分块时按需拼接一次），并推进消费位置。 */
  private takeBytes(count: number): Buffer {
    if (count <= 0) return Buffer.alloc(0)
    const head = this.chunks[0]
    const headAvailable = head.length - this.headOffset
    if (headAvailable >= count) {
      const view = head.subarray(this.headOffset, this.headOffset + count)
      this.consume(count)
      return view
    }
    const parts: Buffer[] = [head.subarray(this.headOffset)]
    let remaining = count - headAvailable
    for (let index = 1; remaining > 0; index++) {
      const chunk = this.chunks[index]
      const take = Math.min(chunk.length, remaining)
      parts.push(chunk.subarray(0, take))
      remaining -= take
    }
    this.consume(count)
    return Buffer.concat(parts)
  }

  /** 取出 count 字节并拷贝为独立 Uint8Array（跨分块时直接填充目标，避免中间拼接的额外拷贝）。 */
  private takePayload(count: number): Uint8Array {
    if (count <= 0) return new Uint8Array(0)
    const head = this.chunks[0]
    const headAvailable = head.length - this.headOffset
    if (headAvailable >= count) {
      const view = head.subarray(this.headOffset, this.headOffset + count)
      this.consume(count)
      return new Uint8Array(view)
    }
    const data = new Uint8Array(count)
    data.set(head.subarray(this.headOffset), 0)
    let written = headAvailable
    let remaining = count - headAvailable
    for (let index = 1; remaining > 0; index++) {
      const chunk = this.chunks[index]
      const take = Math.min(chunk.length, remaining)
      data.set(chunk.subarray(0, take), written)
      written += take
      remaining -= take
    }
    this.consume(count)
    return data
  }

  /** 丢弃已消费的分块并推进 headOffset；调用方保证未消费字节数不少于 count。 */
  private consume(count: number): void {
    this.bufferedBytes -= count
    let remaining = count
    let dropCount = 0
    while (remaining > 0 && dropCount < this.chunks.length) {
      const chunk = this.chunks[dropCount]
      const offset = dropCount === 0 ? this.headOffset : 0
      const available = chunk.length - offset
      if (available <= remaining) {
        remaining -= available
        dropCount++
      } else if (dropCount === 0) {
        this.headOffset += remaining
        return
      } else {
        this.chunks.splice(0, dropCount)
        this.headOffset = remaining
        return
      }
    }
    if (dropCount > 0) {
      this.chunks.splice(0, dropCount)
      this.headOffset = 0
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
        this.onMessage({ type: 'error', requestId, message: 'IndexTTS 合成失败' })
      }
      return
    }
    throw new Error(`IndexTTS helper 返回了未知协议消息：${header.slice(0, 120)}`)
  }
}

function parseInteger(value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) throw new Error('IndexTTS helper 协议包含无效数字')
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error('IndexTTS helper 协议数字超过限制')
  }
  return result
}

function parseRequestId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error('IndexTTS helper 协议包含无效请求 ID')
  }
  return value
}
