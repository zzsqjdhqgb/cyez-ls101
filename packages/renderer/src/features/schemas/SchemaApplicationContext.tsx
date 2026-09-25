import { createContext, useContext } from 'react'
import type { SchemaRepository } from '@ls101/schema-editor'
import { schemaRepository } from './SchemaApplicationRuntime'

export const SchemaApplicationContext = createContext<SchemaRepository>(schemaRepository)

export function useSchemaRepository(): SchemaRepository {
  const repository = useContext(SchemaApplicationContext)
  if (!repository) throw new Error('评分单元应用上下文缺失，请在应用内打开本页。')
  return repository
}
