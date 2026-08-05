import type { InterfaceApplication } from '@ls101/interface-editor'
import type { TemplateApplicationDependencies } from '@ls101/template-editor'

export type TemplateInterfaceDependencies = Pick<
  TemplateApplicationDependencies,
  'getInterfaceManifest' | 'locateInterfaceInstance'
>

export function createTemplateInterfaceDependencies(
  application: InterfaceApplication
): TemplateInterfaceDependencies {
  return {
    async getInterfaceManifest(interfaceId) {
      const details = await application.published.get(interfaceId)
      if (!details) return null
      return application.published.getVarManifest(interfaceId)
    },
    async locateInterfaceInstance(instanceId) {
      const located = await application.instances.locate(instanceId)
      return located ? { interfaceId: located.interfaceId, instance: located.instance } : null
    }
  }
}
