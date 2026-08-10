import type { InterfaceApplication } from '@ls101/interface-editor'
import type { TemplateApplicationDependencies } from '@ls101/template-editor'

export type TemplateInterfaceDependencies = Pick<
  TemplateApplicationDependencies,
  'listInterfaceManifests' | 'getInterfaceManifest' | 'locateInterfaceInstance'
>

export function createTemplateInterfaceDependencies(
  application: InterfaceApplication
): TemplateInterfaceDependencies {
  return {
    async listInterfaceManifests() {
      const interfaces = await application.browser.listPublished()
      return Promise.all(
        interfaces.map(({ interfaceId }) => application.published.getVarManifest(interfaceId))
      )
    },
    async getInterfaceManifest(interfaceId) {
      const details = await application.published.get(interfaceId)
      if (!details) return null
      return application.published.getVarManifest(interfaceId)
    },
    async locateInterfaceInstance(instanceId) {
      const located = await application.instances.locate(instanceId)
      return located
        ? {
            interfaceId: located.interfaceId,
            instance: located.instance,
            assetUrls: located.assetUrls
          }
        : null
    }
  }
}
