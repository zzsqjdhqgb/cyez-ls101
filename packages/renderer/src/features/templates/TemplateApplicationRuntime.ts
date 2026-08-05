import type { SchemaBlockManifest } from '@ls101/core-types'
import { createTemplateApplication } from '@ls101/template-editor'
import { FileTemplateRepository } from '@ls101/template-editor/adapters'
import { fileStore } from '@ls101/file-store/renderer'
import { interfaceApplication } from '../interfaces/InterfaceApplicationRuntime'
import { createTemplateInterfaceDependencies } from './TemplateInterfaceAdapter'

const templateRepository = new FileTemplateRepository(fileStore.scope('template-editor'))

async function getSchemaManifest(): Promise<SchemaBlockManifest | null> {
  return null
}

export const templateApplication = createTemplateApplication({
  repository: templateRepository,
  ...createTemplateInterfaceDependencies(interfaceApplication),
  getSchemaManifest
})
