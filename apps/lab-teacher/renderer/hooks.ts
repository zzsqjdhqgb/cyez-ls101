import { useEffect, useRef, useState } from 'react'
import type { OperationId } from '@ls101/lab-contracts'
import { RemoteError, type OperationInput } from '@ls101/lab-client'
import type { TeacherController } from './controller'

export function errorMessage(error: unknown): string {
  if (error instanceof RemoteError) {
    if (error.code === 'REVISION_CONFLICT')
      return '数据已被其他操作更新。请重新载入最新数据，核对后再次保存。'
    const details = error.details?.blockers
      ?.map((item) => `${item.kind} (${item.resourceId})`)
      .join(', ')
    return `${error.code}${details ? `: ${details}` : ''}`
  }
  return error instanceof Error ? error.message : String(error)
}
export function useRead<T>(
  controller: TeacherController,
  operation: OperationId,
  input: OperationInput = {},
  poll = false
): {
  data: T | null
  loading: boolean
  error: string | null
  refresh(): void
} {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const serialized = JSON.stringify(input)
  const query = `${operation}:${serialized}`
  const [resolved, setResolved] = useState<{ query: string; revision: number } | null>(null)
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined
    const read = async (): Promise<void> => {
      try {
        const next = await controller.request<T>(operation, JSON.parse(serialized))
        if (active) {
          setData(next)
          setError(null)
        }
      } catch (reason) {
        if (active) setError(errorMessage(reason))
      } finally {
        if (active) {
          setLoading(false)
          setResolved({ query, revision })
          if (poll)
            timer = setTimeout(() => {
              void read()
            }, 5000)
        }
      }
    }
    void read()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [controller, operation, serialized, query, revision, poll])
  return {
    data: resolved?.query === query ? data : null,
    loading: loading || resolved?.query !== query || resolved?.revision !== revision,
    error: resolved?.query === query && resolved.revision === revision ? error : null,
    refresh: () => setRevision((value) => value + 1)
  }
}
export function useAction(refresh?: () => void): {
  busy: boolean
  error: string | null
  run(action: () => Promise<unknown>): void
} {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  return {
    busy,
    error,
    run(action) {
      if (running.current) return
      running.current = true
      setBusy(true)
      setError(null)
      void Promise.resolve()
        .then(action)
        .then(() => refresh?.())
        .catch((reason) => setError(errorMessage(reason)))
        .finally(() => {
          running.current = false
          setBusy(false)
        })
    }
  }
}
export function usePagedRead<T>(
  controller: TeacherController,
  operation: OperationId,
  input: OperationInput = {},
  poll = false
): ReturnType<typeof useRead<T>> & {
  cursor: string | null
  setCursor(value: string | null): void
} {
  const [cursor, setCursor] = useState<string | null>(null)
  const read = useRead<T>(
    controller,
    operation,
    { ...input, query: { ...input.query, cursor: cursor ?? undefined } },
    poll
  )
  return { ...read, cursor, setCursor }
}
export function time(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '-'
}
export function bytes(value: number | null): string {
  return value === null ? '-' : `${(value / 1024 ** 2).toFixed(1)} MB`
}
