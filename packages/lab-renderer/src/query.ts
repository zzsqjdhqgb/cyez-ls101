import { useCallback, useEffect, useRef, useState } from 'react'
import type { OperationId } from '@ls101/lab-contracts'
import type { OperationInput } from '@ls101/lab-client'
import { describeLabError, type LabErrorDescription } from './format'

export interface LabQueryOptions<T> {
  /** Stable identity of this query; use queryKey(operationId, input). */
  queryKey: string
  queryFn(signal: AbortSignal): Promise<T>
  enabled?: boolean
  /** Repeats the query after each completed attempt. */
  pollMs?: number
}

export interface LabQueryResult<T> {
  data: T | null
  error: LabErrorDescription | null
  /** Initial load in flight: no data is available yet. */
  loading: boolean
  /** A reload is in flight while previous data remains visible. */
  refreshing: boolean
  /** The last reload failed but older data is still displayed. */
  stale: boolean
  refresh(): void
}

interface QueryState<T> {
  key: string
  data: T | null
  error: LabErrorDescription | null
  pending: boolean
  refreshing: boolean
}

export function queryKey(operationId: OperationId, input: OperationInput = {}): string {
  return `${operationId}:${JSON.stringify(input)}`
}

export function useLabQuery<T>({
  queryKey: key,
  queryFn,
  enabled = true,
  pollMs
}: LabQueryOptions<T>): LabQueryResult<T> {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<QueryState<T>>({
    key,
    data: null,
    error: null,
    pending: true,
    refreshing: false
  })
  const queryFnRef = useRef(queryFn)
  queryFnRef.current = queryFn

  useEffect(() => {
    if (!enabled) return

    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()

    setState((current) =>
      current.key === key
        ? { ...current, pending: current.data === null, refreshing: current.data !== null }
        : { key, data: null, error: null, pending: true, refreshing: false }
    )

    const load = async (): Promise<void> => {
      try {
        const data = await queryFnRef.current(abort.signal)
        if (!active) return
        setState({ key, data, error: null, pending: false, refreshing: false })
      } catch (reason) {
        if (!active || abort.signal.aborted) return
        setState((current) => ({
          ...current,
          key,
          error: describeLabError(reason),
          pending: false,
          refreshing: false
        }))
      } finally {
        if (active && pollMs !== undefined && pollMs > 0) {
          timer = setTimeout(() => void load(), pollMs)
        }
      }
    }

    void load()

    return () => {
      active = false
      abort.abort()
      clearTimeout(timer)
    }
  }, [key, enabled, pollMs, revision])

  const current = state.key === key ? state : null
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: enabled && (!current || (current.pending && current.data === null)),
    refreshing: current?.refreshing ?? false,
    stale: Boolean(current?.data !== null && current?.error),
    refresh: useCallback(() => setRevision((value) => value + 1), [])
  }
}
