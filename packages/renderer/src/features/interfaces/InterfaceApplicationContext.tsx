import { createContext, useContext } from 'react'
import { createInterfaceApplication, type InterfaceApplication } from '@ls101/interface-editor'
import { FileInterfaceRepository } from '@ls101/interface-editor/adapters'
import { fileDialog } from '@ls101/file-dialog/renderer'
import { fileStore } from '@ls101/file-store/renderer'
import { createInterfaceAIRouterTextGenerator } from './InterfaceAIRouterAdapter'
import { configuredImageGenerator } from '../airouter/ConfiguredImageGenerator'

const interfaceApplication = createInterfaceApplication({
  repository: new FileInterfaceRepository(fileStore.scope('interfaces')),
  fileDialog,
  textGenerator: createInterfaceAIRouterTextGenerator(),
  imageGenerator: configuredImageGenerator
})

export const InterfaceApplicationContext = createContext<InterfaceApplication>(interfaceApplication)

export function useInterfaceApplication(): InterfaceApplication {
  const application = useContext(InterfaceApplicationContext)
  if (!application) throw new Error('InterfaceApplicationProvider is missing')
  return application
}
