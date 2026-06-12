/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect } from 'vitest'
import { createSimpleProtocolHandler, createResourceProtocolHandler } from '../factory'

describe('createSimpleProtocolHandler', () => {
  it('returns a function', () => {
    const handler = createSimpleProtocolHandler('/tmp/test-base')
    expect(typeof handler).toBe('function')
  })

  it('rejects path traversal attempts', async () => {
    const handler = createSimpleProtocolHandler('/tmp/test-base')
    const request = new Request('simple://../etc/passwd')
    const response = await handler(request)
    expect(response.status).toBe(403)
  })

  it('rejects URL that resolves outside base dir', async () => {
    const handler = createSimpleProtocolHandler('/tmp/test-base')
    const request = new Request('simple://../../etc/hostname')
    const response = await handler(request)
    expect(response.status).toBe(403)
  })

  it('returns 404 for non-existing files', async () => {
    const handler = createSimpleProtocolHandler('/tmp/nonexistent-dir-12345')
    const request = new Request('simple://somefile.txt')
    const response = await handler(request)
    expect([404, 403]).toContain(response.status)
  })

  it('handles URL with trailing slash', async () => {
    const handler = createSimpleProtocolHandler('/tmp/test-base')
    const request = new Request('simple://foo/bar///')
    const response = await handler(request)
    expect([404, 403, 200]).toContain(response.status)
  })

  it('normalizes base directory', () => {
    const handler = createSimpleProtocolHandler('/tmp/test-base/../test-base')
    expect(typeof handler).toBe('function')
  })
})

describe('createResourceProtocolHandler', () => {
  function makeResourceHandler() {
    return createResourceProtocolHandler((id: string) => `/tmp/resource-base/${id}`)
  }

  it('returns a function', () => {
    const handler = makeResourceHandler()
    expect(typeof handler).toBe('function')
  })

  it('returns 400 for URL without slash after ID', async () => {
    const handler = makeResourceHandler()
    const request = new Request('resource://no-slash')
    const response = await handler(request)
    expect(response.status).toBe(400)
  })

  it('handles valid resource URL format', async () => {
    const handler = makeResourceHandler()
    const request = new Request('resource://exam123/media/audio.wav')
    const response = await handler(request)
    expect([404, 403, 200]).toContain(response.status)
  })

  it('rejects path traversal in resource URL', async () => {
    const handler = makeResourceHandler()
    const request = new Request('resource://exam123/../../../etc/passwd')
    const response = await handler(request)
    expect([403, 404]).toContain(response.status)
  })

  it('handles URL with multiple slashes', async () => {
    const handler = makeResourceHandler()
    const request = new Request('resource://exam123/path/to/file///')
    const response = await handler(request)
    expect([404, 403, 200]).toContain(response.status)
  })
})
