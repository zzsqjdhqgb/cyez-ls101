import { describe, expect, it, vi } from 'vitest'
import { QwenTtsProtocolDecoder } from '../main/qwen-tts-protocol'

describe('Qwen TTS helper protocol', () => {
  it('decodes fragmented headers and binary payloads', () => {
    const messages: unknown[] = []
    const onError = vi.fn()
    const decoder = new QwenTtsProtocolDecoder((message) => messages.push(message), onError)
    const wav = Buffer.alloc(44, 7)
    const response = Buffer.concat([
      Buffer.from(`READY 1\nRESULT request_1 24000 ${wav.byteLength}\n`),
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
      { type: 'result', requestId: 'request_1', sampleRate: 24000, data: new Uint8Array(wav) },
      { type: 'error', requestId: 'request_2', message: 'oops' }
    ])
  })

  it.each([
    ['unknown message', 'HELLO 1\n'],
    ['invalid request ID', 'ERROR request! 0\n'],
    ['oversized result', `RESULT request 24000 ${100 * 1024 * 1024 + 1}\n`],
    ['oversized header', `${'x'.repeat(4097)}\n`]
  ])('rejects %s', (_name, input) => {
    const onError = vi.fn()
    const decoder = new QwenTtsProtocolDecoder(vi.fn(), onError)
    decoder.push(Buffer.from(input))
    expect(onError).toHaveBeenCalledOnce()
  })

  it('reports a truncated payload at end of stream', () => {
    const onError = vi.fn()
    const decoder = new QwenTtsProtocolDecoder(vi.fn(), onError)
    decoder.push(Buffer.from('RESULT request 24000 44\nshort'))
    decoder.end()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('不完整') })
    )
  })
})
