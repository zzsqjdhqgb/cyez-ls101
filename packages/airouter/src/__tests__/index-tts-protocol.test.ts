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
    expect(messages).toEqual([{ type: 'error', requestId: 'request', message: 'IndexTTS 合成失败' }])
  })
})
