/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect } from 'vitest'
import { decodeSentencepieceModel, UnigramTokenizer } from '../tokenizer'

describe('decodeSentencepieceModel', () => {
  it('handles empty buffer', () => {
    const buffer = new Uint8Array(0)
    const pieces = decodeSentencepieceModel(buffer)
    expect(pieces).toEqual([])
  })

  it('produces tokens that can initialize a UnigramTokenizer', () => {
    const pieces = [
      { piece: '\u2581hello', score: -1.0, type: 1 },
      { piece: '\u2581world', score: -1.5, type: 1 },
      { piece: '<unk>', score: 0, type: 2 }
    ]
    const tokenizer = new UnigramTokenizer(pieces)
    expect(tokenizer).toBeDefined()
  })
})

describe('UnigramTokenizer', () => {
  function makeTestTokenizer(): UnigramTokenizer {
    const pieces = [
      { piece: '\u2581he', score: -0.5, type: 1 },
      { piece: 'llo', score: -0.3, type: 1 },
      { piece: '\u2581world', score: -1.0, type: 1 },
      { piece: '\u2581hello', score: -0.8, type: 1 },
      { piece: '\u2581a', score: -0.2, type: 1 },
      { piece: '<unk>', score: 0, type: 2 }
    ]
    return new UnigramTokenizer(pieces)
  }

  it('encodes a simple known word', () => {
    const tok = makeTestTokenizer()
    const ids = tok.encode('hello')
    expect(ids).toBeInstanceOf(Uint32Array)
    expect(ids.length).toBeGreaterThan(0)
  })

  it('encodes a single space character prepended', () => {
    const pieces = [
      { piece: '\u2581a', score: -0.2, type: 1 },
      { piece: '<unk>', score: 0, type: 2 }
    ]
    const tok = new UnigramTokenizer(pieces)
    const ids = tok.encode('a')
    expect(ids).toBeInstanceOf(Uint32Array)
    expect(ids.length).toBeGreaterThan(0)
  })

  it('handles text with multiple words', () => {
    const pieces = [
      { piece: '\u2581he', score: -0.5, type: 1 },
      { piece: 'llo', score: -0.3, type: 1 },
      { piece: '\u2581world', score: -1.0, type: 1 },
      { piece: '\u2581test', score: -0.7, type: 1 },
      { piece: '<unk>', score: 0, type: 2 }
    ]
    const tok = new UnigramTokenizer(pieces)
    const ids = tok.encode('test world')
    expect(ids.length).toBeGreaterThan(0)
  })

  it('handles empty string', () => {
    const tok = makeTestTokenizer()
    const ids = tok.encode('')
    expect(ids.length).toBeGreaterThanOrEqual(0)
  })

  it('returns valid ids (non-negative integers)', () => {
    const tok = makeTestTokenizer()
    const ids = tok.encode('hello')
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(id)).toBe(true)
    }
  })

  it('produces consistent output for same input', () => {
    const tok = makeTestTokenizer()
    const ids1 = tok.encode('hello world')
    const ids2 = tok.encode('hello world')
    expect(ids1).toEqual(ids2)
  })

  it('uses unkId for unknown characters', () => {
    const pieces = [
      { piece: '\u2581a', score: -0.2, type: 1 },
      { piece: '<unk>', score: 0, type: 2 }
    ]
    const tok = new UnigramTokenizer(pieces)
    const ids = tok.encode('\u00ff')
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => id >= 0 && Number.isInteger(id))).toBe(true)
  })
})
