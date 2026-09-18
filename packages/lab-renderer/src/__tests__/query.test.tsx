import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKey, useLabQuery } from '../query'

afterEach(cleanup)

describe('queryKey', () => {
  it('builds a stable identity from the operation and its input', () => {
    expect(queryKey('getTeacherExams', { query: { limit: 50 } })).toBe(
      'getTeacherExams:{"query":{"limit":50}}'
    )
  })
})

describe('useLabQuery', () => {
  it('loads data and reports the initial loading state', async () => {
    const queryFn = vi.fn(async () => 'value')
    const { result } = renderHook(() => useLabQuery({ queryKey: 'k', queryFn }))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toBe('value'))
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('keeps previous data and marks it stale when a refresh fails', async () => {
    let fail = false
    const queryFn = vi.fn(async () => {
      if (fail) throw new Error('offline')
      return 'value'
    })
    const { result } = renderHook(() => useLabQuery({ queryKey: 'k', queryFn }))

    await waitFor(() => expect(result.current.data).toBe('value'))
    fail = true
    result.current.refresh()

    await waitFor(() => expect(result.current.stale).toBe(true))
    expect(result.current.data).toBe('value')
    expect(result.current.error?.message).toBe('offline')
    expect(result.current.refreshing).toBe(false)
  })

  it('polls after each completed attempt', async () => {
    const queryFn = vi.fn(async () => 'value')
    renderHook(() => useLabQuery({ queryKey: 'k', queryFn, pollMs: 10 }))

    await waitFor(() => expect(queryFn.mock.calls.length).toBeGreaterThan(1))
  })

  it('stays idle while disabled', async () => {
    const queryFn = vi.fn(async () => 'value')
    const { result } = renderHook(() =>
      useLabQuery({ queryKey: 'k', queryFn, enabled: false })
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(queryFn).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
  })

  it('drops the previous key result while the new key loads', async () => {
    const queryFn = vi.fn(async (signal: AbortSignal) => {
      void signal
      return 'value'
    })
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useLabQuery({ queryKey: key, queryFn }),
      { initialProps: { key: 'a' } }
    )

    await waitFor(() => expect(result.current.data).toBe('value'))
    rerender({ key: 'b' })
    expect(result.current.data).toBeNull()
    await waitFor(() => expect(result.current.data).toBe('value'))
  })
})
