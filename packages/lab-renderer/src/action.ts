import { useCallback, useEffect, useRef, useState } from 'react'
import { describeLabError, type LabErrorDescription } from './format'

export interface LabAction {
  busy: boolean
  error: LabErrorDescription | null
  /** Runs one action at a time; a concurrent call resolves null without starting work. */
  run<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T | null>
  reset(): void
}

export function useLabAction(): LabAction {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LabErrorDescription | null>(null)
  const active = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      active.current?.abort()
    }
  }, [])

  const run = useCallback(async <T>(action: (signal: AbortSignal) => Promise<T>) => {
    if (active.current) return null

    const abort = new AbortController()
    active.current = abort
    setBusy(true)
    setError(null)

    try {
      return await action(abort.signal)
    } catch (reason) {
      if (!abort.signal.aborted && mounted.current) setError(describeLabError(reason))
      return null
    } finally {
      active.current = null
      if (mounted.current) setBusy(false)
    }
  }, [])

  const reset = useCallback(() => setError(null), [])

  return { busy, error, run, reset }
}
