/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect } from 'vitest'
import { encodeWav } from '../wav-encoder'

describe('encodeWav', () => {
  it('produces valid WAV header for empty input', () => {
    const samples = new Float32Array(0)
    const wav = encodeWav(samples, 24000)
    expect(wav).toBeInstanceOf(Uint8Array)
    expect(wav.length).toBe(44)
  })

  it('produces valid WAV header with RIFF marker', () => {
    const samples = new Float32Array(0)
    const wav = encodeWav(samples, 24000)
    const header = String.fromCharCode(...wav.slice(0, 4))
    expect(header).toBe('RIFF')
  })

  it('produces valid WAV header with WAVE marker', () => {
    const samples = new Float32Array(0)
    const wav = encodeWav(samples, 24000)
    const wave = String.fromCharCode(...wav.slice(8, 12))
    expect(wave).toBe('WAVE')
  })

  it('produces correct data size for given samples', () => {
    const sampleCount = 100
    const samples = new Float32Array(sampleCount)
    samples.fill(0.5)
    const wav = encodeWav(samples, 24000)
    const expectedSize = 44 + sampleCount * 2
    expect(wav.length).toBe(expectedSize)
  })

  it('handles sample rate 44100', () => {
    const samples = new Float32Array(50)
    samples.fill(0)
    const wav = encodeWav(samples, 44100)
    const expectedSize = 44 + 50 * 2
    expect(wav.length).toBe(expectedSize)
  })

  it('clamps samples to [-1, 1] range', () => {
    const samples = new Float32Array([2.5, -3.7, 0.0])
    const wav = encodeWav(samples, 24000)
    const view = new DataView(wav.buffer)
    const val0 = view.getInt16(44, true)
    const val1 = view.getInt16(46, true)
    const val2 = view.getInt16(48, true)
    expect(val0).toBe(0x7fff)
    expect(val1).toBe(-0x8000)
    expect(val2).toBe(0)
  })

  it('writes fmt chunk with correct size', () => {
    const wav = encodeWav(new Float32Array(0), 24000)
    const view = new DataView(wav.buffer)
    expect(view.getUint32(16, true)).toBe(16)
  })

  it('writes PCM format (1) at offset 20', () => {
    const wav = encodeWav(new Float32Array(0), 24000)
    const view = new DataView(wav.buffer)
    expect(view.getUint16(20, true)).toBe(1)
  })

  it('writes mono channel at offset 22', () => {
    const wav = encodeWav(new Float32Array(0), 24000)
    const view = new DataView(wav.buffer)
    expect(view.getUint16(22, true)).toBe(1)
  })

  it('writes sample rate at offset 24', () => {
    const wav = encodeWav(new Float32Array(0), 44100)
    const view = new DataView(wav.buffer)
    expect(view.getUint32(24, true)).toBe(44100)
  })

  it('writes bits per sample as 16', () => {
    const wav = encodeWav(new Float32Array(0), 24000)
    const view = new DataView(wav.buffer)
    expect(view.getUint16(34, true)).toBe(16)
  })
})
