import { isSchemaId, type SchemaRepository } from '@ls101/schema-editor'
import type { TemplateApplicationDependencies } from '@ls101/template-editor'

export type TemplateSchemaDependencies = Pick<TemplateApplicationDependencies, 'getSchema'>

export function createTemplateSchemaDependencies(
  repository: Pick<SchemaRepository, 'getSchema'>
): TemplateSchemaDependencies {
  return {
    getSchema(schemaId) {
      return isSchemaId(schemaId) ? repository.getSchema(schemaId) : Promise.resolve(null)
    }
  }
}
