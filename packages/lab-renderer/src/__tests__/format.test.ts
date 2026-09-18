import { describe, expect, it } from 'vitest'
import { RemoteError } from '@ls101/lab-client'
import { describeLabError, formatBytes, formatTime } from '../format'

describe('describeLabError', () => {
  it('localizes a known remote code and keeps the code visible', () => {
    const description = describeLabError(new RemoteError('RESOURCE_BUSY', 503))

    expect(description.code).toBe('RESOURCE_BUSY')
    expect(description.message).toContain('服务正忙')
    expect(description.message).toContain('RESOURCE_BUSY')
  })

  it('keeps blockers and the retry hint', () => {
    const description = describeLabError(
      new RemoteError(
        'REVISION_CONFLICT',
        409,
        { blockers: [{ kind: 'enrollment', resourceId: '11111111-1111-4111-8111-111111111111' }] },
        7
      )
    )

    expect(description.message).toContain('REVISION_CONFLICT')
    expect(description.blockers).toEqual([
      { kind: 'enrollment', resourceId: '11111111-1111-4111-8111-111111111111' }
    ])
    expect(description.retryAfterSeconds).toBe(7)
  })

  it('passes through errors raised outside the remote contract', () => {
    const description = describeLabError(
      new Error('LS101_INSTALL_ERROR [configure-service-account]: Access denied')
    )

    expect(description.code).toBeNull()
    expect(description.message).toContain('LS101_INSTALL_ERROR')
    expect(description.blockers).toEqual([])
  })
})

describe('formatBytes', () => {
  it('scales units and renders a dash for missing values', () => {
    expect(formatBytes(null)).toBe('-')
    expect(formatBytes(undefined)).toBe('-')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB')
  })
})

describe('formatTime', () => {
  it('renders a dash for missing values and localizes timestamps', () => {
    expect(formatTime(null)).toBe('-')
    expect(formatTime(undefined)).toBe('-')
    expect(formatTime('2026-08-16T01:00:00.000Z')).not.toBe('-')
  })
})
