import type { SchemaBlockManifest } from '@ls101/core-types'
import { createTemplateApplication } from '@ls101/template-editor'
import {
  createTemplateInterfaceReferenceManager,
  FileTemplateRepository
} from '@ls101/template-editor/adapters'
import { builtinFileStore, fileStore } from '@ls101/file-store/renderer'
import { interfaceApplication } from '../interfaces/InterfaceApplicationRuntime'
import { createTemplateInterfaceDependencies } from './TemplateInterfaceAdapter'

const templateRepository = new FileTemplateRepository(fileStore.scope('template-editor'))
const builtinTemplateStore = builtinFileStore.scope('template-editor')

export const templateInterfaceReferences =
  createTemplateInterfaceReferenceManager(templateRepository)

async function getSchemaManifest(): Promise<SchemaBlockManifest | null> {
  return null
}

export const templateApplication = createTemplateApplication({
  repository: templateRepository,
  getBuiltinFunctionLibraryManifest: () =>
    builtinTemplateStore.readText('builtin-function-libraries.json'),
  ...createTemplateInterfaceDependencies(interfaceApplication),
  getSchemaManifest
})
