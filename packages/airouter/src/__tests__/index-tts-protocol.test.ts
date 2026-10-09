import { describe, expect, it, vi } from 'vitest'
import { IndexTtsProtocolDecoder } from '../main/index-tts-protocol'

describe('IndexTTS framed protocol', () => {
  it('handles byte-sized fragmentation and coalesced frames', () => {
    const messages = vi.fn(),
      error = vi.fn()
    const decoder = new IndexTtsProtocolDecoder(messages, error)
    const input = Buffer.concat([
      Buffer.from('READY 1\r\nRESULT req 24000 44\n'),
      Buffer.alloc(44),
      Buffer.from('ERROR next 0\n')
    ])
    for (const byte of input) decoder.push(Uint8Array.of(byte))
    decoder.end()
    expect(error).not.toHaveBeenCalled()
    expect(messages.mock.calls.map(([value]) => value.type)).toEqual(['ready', 'result', 'error'])
    expect(messages.mock.calls[1][0].data).toHaveLength(44)
  })

  it.each([
    'RESULT r 24000 104857601\n',
    'RESULT r 1 44\n',
    'ERROR r -1\n',
    'READY 0\n',
    'x'.repeat(4097)
  ])('rejects bounded protocol violations', (input) => {
    const error = vi.fn(),
      messages = vi.fn()
    const decoder = new IndexTtsProtocolDecoder(messages, error)
    decoder.push(Buffer.from(input))
    decoder.push(Buffer.from('READY 1\n'))
    decoder.end()
    expect(error).toHaveBeenCalledOnce()
    expect(messages).not.toHaveBeenCalled()
  })

  it.each(['REA', 'RESULT r 24000 44\nabc'])('rejects EOF in headers or payloads', (input) => {
    const error = vi.fn()
    const decoder = new IndexTtsProtocolDecoder(vi.fn(), error)
    decoder.push(Buffer.from(input))
    decoder.end()
    expect(error).toHaveBeenCalledOnce()
  })
})
