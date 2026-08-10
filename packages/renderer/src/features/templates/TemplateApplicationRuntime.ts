import type { SchemaDefinition } from '@ls101/core-types'
import { FileSchemaRepository } from '@ls101/schema-editor'
import { createTemplateApplication } from '@ls101/template-editor'
import { FileTemplateRepository } from '@ls101/template-editor/adapters'
import { builtinFileStore, fileStore } from '@ls101/file-store/renderer'
import { interfaceApplication } from '../interfaces/InterfaceApplicationRuntime'
import { createTemplateInterfaceDependencies } from './TemplateInterfaceAdapter'

const templateRepository = new FileTemplateRepository(fileStore.scope('template-editor'))
const builtinTemplateStore = builtinFileStore.scope('template-editor')
const schemaRepository = new FileSchemaRepository(fileStore.scope('schema-editor'))

async function getSchema(schemaId: string): Promise<SchemaDefinition | null> {
  return schemaRepository.getSchema(schemaId)
}

export const templateApplication = createTemplateApplication({
  repository: templateRepository,
  getBuiltinFunctionLibraryManifest: () =>
    builtinTemplateStore.readText('builtin-function-libraries.json'),
  ...createTemplateInterfaceDependencies(interfaceApplication),
  getSchema
})
