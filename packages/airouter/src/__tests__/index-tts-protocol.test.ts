import { describe, expect, it, vi } from 'vitest'
import { IndexTtsProtocolDecoder } from '../main/index-tts-protocol'

describe('IndexTTS helper protocol', () => {
  it('decodes fragmented headers and binary payloads', () => {
    const messages: unknown[] = []
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder((message) => messages.push(message), onError)
    const wav = Buffer.alloc(44, 7)
    const response = Buffer.concat([
      Buffer.from(`READY 1\nRESULT request_1 22050 ${wav.byteLength}\n`),
      wav,
      Buffer.from('ERROR request_2 4\noops')
    ])

    for (let offset = 0; offset < response.byteLength; offset += 3) {
      decoder.push(response.subarray(offset, offset + 3))
    }
    decoder.end()

    expect(onError).not.toHaveBeenCalled()
    expect(messages).toEqual([
      { type: 'ready', version: 1 },
      { type: 'result', requestId: 'request_1', sampleRate: 22050, data: new Uint8Array(wav) },
      { type: 'error', requestId: 'request_2', message: 'oops' }
    ])
  })

  it('accepts CRLF protocol headers', () => {
    const messages: unknown[] = []
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder((message) => messages.push(message), onError)
    decoder.push(Buffer.from('READY 1\r\n'))

    expect(onError).not.toHaveBeenCalled()
    expect(messages).toEqual([{ type: 'ready', version: 1 }])
  })

  it.each([
    ['unknown message', 'HELLO 1\n'],
    ['invalid request ID', 'ERROR request! 0\n'],
    ['oversized result', `RESULT request 22050 ${100 * 1024 * 1024 + 1}\n`],
    ['oversized header', `${'x'.repeat(4097)}\n`],
    ['result below the WAV minimum', 'RESULT request 22050 43\n'],
    ['result above the sample rate range', 'RESULT request 4000 44\n']
  ])('rejects %s', (_name, input) => {
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder(vi.fn(), onError)
    decoder.push(Buffer.from(input))
    expect(onError).toHaveBeenCalledOnce()
  })

  it('reports a truncated payload at end of stream', () => {
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder(vi.fn(), onError)
    decoder.push(Buffer.from('RESULT request 22050 44\nshort'))
    decoder.end()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('不完整') })
    )
  })

  it('delivers an empty ERROR payload as a generic message', () => {
    const messages: unknown[] = []
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder((message) => messages.push(message), onError)
    decoder.push(Buffer.from('ERROR request 0\n'))
    expect(onError).not.toHaveBeenCalled()
    expect(messages).toEqual([
      { type: 'error', requestId: 'request', message: 'IndexTTS 合成失败' }
    ])
  })

  it('accepts a synchronous push from inside onMessage', () => {
    const messages: unknown[] = []
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder((message) => {
      messages.push(message)
      // 同步重入：交付 result 前已消费完字节并清空 pending，回调内再 push 不会打乱顺序
      if (message.type === 'result') decoder.push(Buffer.from('READY 2\n'))
    }, onError)
    const wav = Buffer.alloc(44, 7)
    decoder.push(Buffer.from(`RESULT request 22050 ${wav.byteLength}\n`))
    decoder.push(wav)
    decoder.end()

    expect(onError).not.toHaveBeenCalled()
    expect(messages).toEqual([
      { type: 'result', requestId: 'request', sampleRate: 22050, data: new Uint8Array(wav) },
      { type: 'ready', version: 2 }
    ])
  })

  it('decodes a 32 MB payload delivered in small chunks without quadratic buffering', () => {
    const messages: unknown[] = []
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder((message) => messages.push(message), onError)
    // 位置相关内容：每 64 KiB 块首尾写入块序号标记，避免常数填充掩盖分块乱序或错位
    const payloadBytes = 32 * 1024 * 1024
    const chunkSize = 4 * 1024
    const blockSize = 64 * 1024
    const tile = Buffer.alloc(blockSize)
    for (let i = 0; i < tile.length; i++) tile[i] = (i * 131 + 7) & 0xff
    const payload = Buffer.concat(
      Array.from({ length: payloadBytes / blockSize }, (_, block) => {
        const part = Buffer.from(tile)
        part[0] = block & 0xff
        part[1] = (block >> 8) & 0xff
        part[blockSize - 1] = (block * 7 + 3) & 0xff
        return part
      })
    )

    const start = performance.now()
    decoder.push(Buffer.from(`RESULT large_payload 22050 ${payload.byteLength}\n`))
    for (let offset = 0; offset < payload.byteLength; offset += chunkSize) {
      decoder.push(payload.subarray(offset, offset + chunkSize))
    }
    decoder.end()
    const elapsedMs = performance.now() - start

    expect(onError).not.toHaveBeenCalled()
    expect(messages).toHaveLength(1)
    const result = messages[0] as { requestId: string; sampleRate: number; data: Uint8Array }
    expect(result.requestId).toBe('large_payload')
    expect(result.sampleRate).toBe(22050)
    expect(result.data).toBeInstanceOf(Uint8Array)
    expect(result.data.byteLength).toBe(payloadBytes)
    expect(Buffer.from(result.data).equals(payload)).toBe(true)
    // 宽松时间上限：线性实现远低于 1 s；O(n²) 逐块拼接（旧实现在 4 KiB 分块下需复制上百 GB）会远超该值
    expect(elapsedMs).toBeLessThan(3000)
  })
})
