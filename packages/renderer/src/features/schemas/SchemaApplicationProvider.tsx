import type { SchemaRepository } from '@ls101/schema-editor'
import type { JSX, ReactNode } from 'react'
import { SchemaApplicationContext } from './SchemaApplicationContext'

interface SchemaApplicationProviderProps {
  children: ReactNode
  repository?: SchemaRepository
}

export function SchemaApplicationProvider({
  children,
  repository
}: SchemaApplicationProviderProps): JSX.Element {
  if (!repository) return <>{children}</>
  return (
    <SchemaApplicationContext.Provider value={repository}>
      {children}
    </SchemaApplicationContext.Provider>
  )
}
