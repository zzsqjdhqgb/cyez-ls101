import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSelection } from '../selection'

describe('useSelection', () => {
  it('toggles, replaces and clears the selection', () => {
    const { result } = renderHook(() => useSelection())

    act(() => result.current.toggle('a'))
    expect([...result.current.selected]).toEqual(['a'])
    expect(result.current.has('a')).toBe(true)
    expect(result.current.size).toBe(1)

    act(() => result.current.toggle('a', false))
    expect(result.current.size).toBe(0)

    act(() => result.current.set(['b', 'c']))
    expect(result.current.size).toBe(2)

    act(() => result.current.clear())
    expect(result.current.size).toBe(0)
  })

  it('accepts an initial selection', () => {
    const { result } = renderHook(() => useSelection(['seed']))

    expect(result.current.has('seed')).toBe(true)
  })
})
