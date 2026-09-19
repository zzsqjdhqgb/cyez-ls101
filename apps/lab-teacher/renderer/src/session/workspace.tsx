import { createContext, useContext, useState } from 'react'
import type { OperationId } from '@ls101/lab-contracts'
import type { OperationInput } from '@ls101/lab-client'
import { useLabQuery } from '@ls101/lab-renderer'
import type { TeacherSession, TeacherView } from './session'

export const WorkspaceContext = createContext<{
  session: TeacherSession
  view: TeacherView
} | null>(null)
export function useWorkspace(): { session: TeacherSession; view: TeacherView } {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('服务未连接')
  return context
}
export function useServiceQuery<T>(
  operation: OperationId,
  input: OperationInput = {},
  pollMs?: number
): ReturnType<typeof useLabQuery<T>> {
  const { session, view } = useWorkspace()
  return useLabQuery<T>({
    queryKey: JSON.stringify([view.connection?.connectionId, operation, input]),
    queryFn: (signal) => session.request<T>(operation, input, signal),
    pollMs
  })
}
export interface ServiceList<T> {
  items: T[]
  nextCursor: string | null
}
export type ServiceListQuery<T> = ReturnType<typeof useServiceQuery<ServiceList<T>>> & {
  page: number
  next(): void
  previous(): void
  first(): void
}
export function useServiceList<T>(
  operation: OperationId,
  filters: NonNullable<OperationInput['query']> = {},
  pollMs?: number
): ServiceListQuery<T> {
  const signature = JSON.stringify(filters)
  const [position, setPosition] = useState<{
    signature: string
    cursors: Array<string | undefined>
  }>({ signature, cursors: [undefined] })
  const cursors = position.signature === signature ? position.cursors : [undefined]
  const query = useServiceQuery<ServiceList<T>>(
    operation,
    { query: { ...filters, limit: 50, cursor: cursors.at(-1) } },
    pollMs
  )
  return {
    ...query,
    page: cursors.length,
    next: () => {
      if (query.data?.nextCursor)
        setPosition({ signature, cursors: [...cursors, query.data.nextCursor] })
    },
    previous: () => setPosition({ signature, cursors: cursors.slice(0, -1) }),
    first: () => {
      setPosition({ signature, cursors: [undefined] })
      query.refresh()
    }
  }
}
