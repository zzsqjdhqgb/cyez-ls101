import { describe, expect, it, vi } from 'vitest'
import { IndexTtsProtocolDecoder } from '../main/index-tts-protocol'

describe('IndexTTS helper protocol', () => {
  it('decodes fragmented headers and binary payloads', () => {
    const messages: unknown[] = []
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder((message) => messages.push(message), onError)
    const wav = Buffer.alloc(44, 7)
    const response = Buffer.concat([
      Buffer.from('{"type":"ready","version":1}\n'),
      Buffer.from(
        `{"type":"result","requestId":"request_1","sampleRate":22050,"size":${wav.byteLength}}\n`
      ),
      wav,
      Buffer.from('{"type":"error","requestId":"request_2","size":4}\noops')
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
    decoder.push(Buffer.from('{"type":"ready","version":1}\r\n'))

    expect(onError).not.toHaveBeenCalled()
    expect(messages).toEqual([{ type: 'ready', version: 1 }])
  })

  it('reports an empty error payload without waiting for bytes', () => {
    const messages: unknown[] = []
    const decoder = new IndexTtsProtocolDecoder((message) => messages.push(message), vi.fn())
    decoder.push(Buffer.from('{"type":"error","requestId":"request_3","size":0}\n'))

    expect(messages).toEqual([
      { type: 'error', requestId: 'request_3', message: 'IndexTTS 合成失败' }
    ])
  })

  it.each([
    ['unknown message type', '{"type":"hello"}\n'],
    ['malformed JSON header', 'HELLO 1\n'],
    ['invalid request ID', '{"type":"error","requestId":"request!","size":0}\n'],
    [
      'sample rate below range',
      '{"type":"result","requestId":"request","sampleRate":4000,"size":44}\n'
    ],
    [
      'sample rate above range',
      '{"type":"result","requestId":"request","sampleRate":192001,"size":44}\n'
    ],
    [
      'oversized result',
      '{"type":"result","requestId":"request","sampleRate":22050,"size":104857601}\n'
    ],
    ['oversized header', `${'x'.repeat(4097)}\n`]
  ])('rejects %s', (_name, input) => {
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder(vi.fn(), onError)
    decoder.push(Buffer.from(input))
    expect(onError).toHaveBeenCalledOnce()
  })

  it('reports a truncated payload at end of stream', () => {
    const onError = vi.fn()
    const decoder = new IndexTtsProtocolDecoder(vi.fn(), onError)
    decoder.push(
      Buffer.from('{"type":"result","requestId":"request","sampleRate":22050,"size":44}\nshort')
    )
    decoder.end()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('不完整') })
    )
  })
})
