/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/main/tts/tokenizer.ts — SentencePiece binary decoder and Unigram Viterbi tokenizer

// ---------- SentencePiece 解码 ----------
export function decodeSentencepieceModel(
  buffer: Uint8Array
): Array<{ piece: string; score: number; type: number }> {
  const decoder = new TextDecoder()
  const pieces: Array<{ piece: string; score: number; type: number }> = []
  let pos = 0
  function readVarint(): number {
    let result = 0,
      shift = 0
    while (pos < buffer.length) {
      const b = buffer[pos++]
      result |= (b & 0x7f) << shift
      shift += 7
      if ((b & 0x80) === 0) return result
    }
    return result
  }
  function readBytes(n: number): Uint8Array {
    const data = buffer.slice(pos, pos + n)
    pos += n
    return data
  }
  function decodePiece(data: Uint8Array): { piece: string; score: number; type: number } {
    let pPos = 0,
      piece = '',
      score = 0,
      type = 1
    const pView = new DataView(data.buffer, data.byteOffset, data.byteLength)
    function readVarIntFrom(buf: Uint8Array, pp: number): { val: number; pos: number } {
      let result = 0,
        shift = 0
      while (pp < buf.length) {
        const b = buf[pp++]
        result |= (b & 0x7f) << shift
        shift += 7
        if ((b & 0x80) === 0) return { val: result, pos: pp }
      }
      return { val: result, pos: pp }
    }
    while (pPos < data.length) {
      const key = readVarIntFrom(data, pPos)
      pPos = key.pos
      const fieldNum = key.val >>> 3
      const wireType = key.val & 0x7
      if (fieldNum === 1 && wireType === 2) {
        const len = readVarIntFrom(data, pPos)
        pPos = len.pos
        piece = decoder.decode(data.slice(pPos, pPos + len.val))
        pPos += len.val
      } else if (fieldNum === 2 && wireType === 5) {
        score = pView.getFloat32(pPos, true)
        pPos += 4
      } else if (fieldNum === 3 && wireType === 0) {
        const v = readVarIntFrom(data, pPos)
        type = v.val
        pPos = v.pos
      } else {
        if (wireType === 0) {
          const v = readVarIntFrom(data, pPos)
          pPos = v.pos
        } else if (wireType === 1) {
          pPos += 8
        } else if (wireType === 2) {
          const len = readVarIntFrom(data, pPos)
          pPos = len.pos + len.val
        } else if (wireType === 5) {
          pPos += 4
        } else break
      }
    }
    return { piece, score, type }
  }
  while (pos < buffer.length) {
    const key = readVarint()
    const fieldNum = key >>> 3
    const wireType = key & 0x7
    if (fieldNum === 1 && wireType === 2) {
      const len = readVarint()
      const data = readBytes(len)
      pieces.push(decodePiece(data))
    } else {
      if (wireType === 0) {
        readVarint()
      } else if (wireType === 1) {
        pos += 8
      } else if (wireType === 2) {
        const len = readVarint()
        pos += len
      } else if (wireType === 5) {
        pos += 4
      } else break
    }
  }
  return pieces
}

// ---------- Unigram 分词器 ----------
export class UnigramTokenizer {
  private vocab: Map<string, { id: number; score: number }> = new Map()
  private unkId = 0
  constructor(pieces: Array<{ piece: string; score: number; type: number }>) {
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]
      if (p.type === 2) this.unkId = i
      if (p.type === 1 || p.type === 4 || p.type === 6) {
        this.vocab.set(p.piece, { id: i, score: p.score })
      }
    }
  }
  encode(text: string): Uint32Array {
    const normalized = '\u2581' + text.replace(/ /g, '\u2581')
    return this.viterbi(normalized)
  }
  private viterbi(text: string): Uint32Array {
    const n = text.length
    const best: { score: number; len: number; id: number }[] = new Array(n + 1)
    best[0] = { score: 0, len: 0, id: -1 }
    for (let i = 1; i <= n; i++) best[i] = { score: -Infinity, len: 0, id: -1 }
    for (let i = 0; i < n; i++) {
      if (best[i].score === -Infinity) continue
      for (let len = 1; len <= n - i && len <= 64; len++) {
        const sub = text.substring(i, i + len)
        const entry = this.vocab.get(sub)
        if (entry) {
          const newScore = best[i].score + entry.score
          if (newScore > best[i + len].score) {
            best[i + len] = { score: newScore, len, id: entry.id }
          }
        }
      }
      if (best[i + 1].score === -Infinity) {
        const ch = text.charCodeAt(i)
        const byteStr = `<0x${ch.toString(16).toUpperCase().padStart(2, '0')}>`
        const byteEntry = this.vocab.get(byteStr)
        const fallbackId = byteEntry ? byteEntry.id : this.unkId
        const fallbackScore = byteEntry ? byteEntry.score : -100
        best[i + 1] = { score: best[i].score + fallbackScore, len: 1, id: fallbackId }
      }
    }
    const ids: number[] = []
    let p = n
    while (p > 0) {
      ids.push(best[p].id)
      p -= best[p].len
    }
    return new Uint32Array(ids.reverse())
  }
}
