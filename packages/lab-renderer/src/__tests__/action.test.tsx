import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@ls101/lab-client'
import { useLabAction } from '../action'

afterEach(cleanup)

describe('useLabAction', () => {
  it('runs an action and returns its result', async () => {
    const { result } = renderHook(() => useLabAction())
    let value: string | null = null

    await act(async () => {
      value = await result.current.run(async () => 'done')
    })

    expect(value).toBe('done')
    expect(result.current.error).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  it('describes a remote failure and returns null', async () => {
    const { result } = renderHook(() => useLabAction())

    await act(async () => {
      await result.current.run(async () => {
        throw new RemoteError('RESOURCE_BUSY', 503)
      })
    })

    expect(result.current.error?.code).toBe('RESOURCE_BUSY')
    expect(result.current.error?.message).toContain('RESOURCE_BUSY')
    expect(result.current.busy).toBe(false)
  })

  it('ignores a concurrent call while an action is running', async () => {
    const { result } = renderHook(() => useLabAction())
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const second = vi.fn(async () => 'second')

    let firstValue: string | null = null
    let secondValue: string | null = null
    await act(async () => {
      const first = result.current.run(async () => {
        await blocked
        return 'first'
      })
      secondValue = await result.current.run(second)
      release?.()
      firstValue = await first
    })

    expect(secondValue).toBeNull()
    expect(second).not.toHaveBeenCalled()
    expect(firstValue).toBe('first')
  })

  it('clears the recorded error on reset', async () => {
    const { result } = renderHook(() => useLabAction())

    await act(async () => {
      await result.current.run(async () => {
        throw new Error('failed')
      })
    })
    await waitFor(() => expect(result.current.error).not.toBeNull())

    act(() => result.current.reset())
    expect(result.current.error).toBeNull()
  })
})
