/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect } from 'vitest'
import { prefixContentNodesForExam } from '../utils'

describe('prefixContentNodesForExam', () => {
  it('prefixes src for image nodes', () => {
    const nodes = [{ type: 'image', src: 'media/photo.png' }] as Record<string, unknown>[]
    const result = prefixContentNodesForExam(nodes, 'exam123')
    expect(result[0].src).toBe('exam-resource://exam123/media/photo.png')
  })

  it('prefixes src for video nodes', () => {
    const nodes = [{ type: 'video', src: 'media/video.mp4' }] as Record<string, unknown>[]
    const result = prefixContentNodesForExam(nodes, 'exam456')
    expect(result[0].src).toBe('exam-resource://exam456/media/video.mp4')
  })

  it('prefixes src for audio nodes', () => {
    const nodes = [{ type: 'audio', src: 'media/audio.wav', text: 'test' }] as Record<string, unknown>[]
    const result = prefixContentNodesForExam(nodes, 'exam789')
    expect(result[0].src).toBe('exam-resource://exam789/media/audio.wav')
  })

  it('prefixes images array for quad-image nodes', () => {
    const nodes = [{ type: 'quad-image', images: ['a.png', 'b.png', 'c.png', 'd.png'] }] as Record<string, unknown>[]
    const result = prefixContentNodesForExam(nodes, 'exam000')
    expect(result[0].images).toEqual([
      'exam-resource://exam000/a.png',
      'exam-resource://exam000/b.png',
      'exam-resource://exam000/c.png',
      'exam-resource://exam000/d.png'
    ])
  })

  it('leaves text nodes unchanged', () => {
    const nodes = [{ type: 'text', text: 'Hello world' }] as Record<string, unknown>[]
    const result = prefixContentNodesForExam(nodes, 'exam123')
    expect(result[0]).toEqual({ type: 'text', text: 'Hello world' })
  })

  it('handles nodes without src', () => {
    const nodes = [{ type: 'text', text: 'No src' }] as Record<string, unknown>[]
    const result = prefixContentNodesForExam(nodes, 'exam123')
    expect(result[0]).toEqual({ type: 'text', text: 'No src' })
  })

  it('does not mutate original nodes', () => {
    const original = [{ type: 'image', src: 'media/test.png' }]
    const nodes = structuredClone(original) as Record<string, unknown>[]
    const result = prefixContentNodesForExam(nodes, 'exam123')
    expect(nodes[0].src).toBe('media/test.png')
    expect(result[0].src).toBe('exam-resource://exam123/media/test.png')
  })
})
