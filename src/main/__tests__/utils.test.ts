/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect } from 'vitest'
import { isSafeMediaPath } from '../utils'

describe('isSafeMediaPath', () => {
  const baseDir = '/data/exam123'

  it('accepts valid relative path under media', () => {
    expect(isSafeMediaPath(baseDir, 'media/audio.wav')).toBe(true)
  })

  it('accepts valid path with subdirectory under media', () => {
    expect(isSafeMediaPath(baseDir, 'media/images/photo.png')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isSafeMediaPath(baseDir, '')).toBe(false)
  })

  it('rejects non-string', () => {
    expect(isSafeMediaPath(baseDir, 123 as unknown as string)).toBe(false)
  })

  it('rejects null', () => {
    expect(isSafeMediaPath(baseDir, null as unknown as string)).toBe(false)
  })

  it('rejects absolute path starting with /', () => {
    expect(isSafeMediaPath(baseDir, '/etc/passwd')).toBe(false)
  })

  it('rejects path starting with backslash', () => {
    expect(isSafeMediaPath(baseDir, '\\windows\\system32')).toBe(false)
  })

  it('rejects path traversal with ..', () => {
    expect(isSafeMediaPath(baseDir, 'media/../secret.txt')).toBe(false)
  })

  it('rejects path outside media directory', () => {
    expect(isSafeMediaPath(baseDir, 'other/file.txt')).toBe(false)
  })

  it('rejects path that resolves outside media after normalization', () => {
    expect(isSafeMediaPath(baseDir, 'media/../../etc/passwd')).toBe(false)
  })

  it('rejects just media path without file (exact media dir)', () => {
    expect(isSafeMediaPath(baseDir, 'media')).toBe(true)
  })
})
