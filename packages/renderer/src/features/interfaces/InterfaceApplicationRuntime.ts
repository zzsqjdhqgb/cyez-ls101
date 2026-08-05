import { createInterfaceApplication } from '@ls101/interface-editor'
import { FileInterfaceRepository } from '@ls101/interface-editor/adapters'
import { fileDialog } from '@ls101/file-dialog/renderer'
import { fileStore } from '@ls101/file-store/renderer'
import { configuredImageGenerator } from '../airouter/ConfiguredImageGenerator'
import { createInterfaceAIRouterTextGenerator } from './InterfaceAIRouterAdapter'

const interfaceRepository = new FileInterfaceRepository(fileStore.scope('interfaces'))

export const interfaceApplication = createInterfaceApplication({
  repository: interfaceRepository,
  fileDialog,
  textGenerator: createInterfaceAIRouterTextGenerator(),
  imageGenerator: configuredImageGenerator
})
