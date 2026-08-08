import {
  createBuiltinInterfaceApplication,
  FileBundledInterfaceRepository
} from '@ls101/interface-editor/builtin'
import { builtinFileStore } from '@ls101/file-store/renderer'
import { templateInterfaceReferences } from '../templates/TemplateApplicationRuntime'
import { BuiltinInterfaceMaintenanceCoordinator } from './BuiltinInterfaceMaintenance'
import { interfaceRepository } from './InterfaceApplicationRuntime'

const bundledRepository = new FileBundledInterfaceRepository(
  builtinFileStore.scope('interface-editor')
)

export const builtinInterfaceApplication = createBuiltinInterfaceApplication({
  repository: interfaceRepository,
  references: templateInterfaceReferences
})

export const builtinInterfaceMaintenance = new BuiltinInterfaceMaintenanceCoordinator(
  builtinInterfaceApplication,
  bundledRepository
)
