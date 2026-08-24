import { createContext, useContext } from 'react'
import type { SchemaRepository } from '@ls101/schema-editor'
import { schemaRepository } from './SchemaApplicationRuntime'

export const SchemaApplicationContext = createContext<SchemaRepository>(schemaRepository)

export function useSchemaRepository(): SchemaRepository {
  const repository = useContext(SchemaApplicationContext)
  if (!repository) throw new Error('SchemaApplicationProvider is missing')
  return repository
}
