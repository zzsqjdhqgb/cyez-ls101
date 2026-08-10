import { FileSchemaRepository } from '@ls101/schema-editor'
import { fileStore } from '@ls101/file-store/renderer'

export const schemaRepository = new FileSchemaRepository(fileStore.scope('schema-editor'))
