import type { TemplateRepository } from './repository'
import type { TemplateDocument } from './types'

export interface TemplateInterfaceReferenceManager {
  countInterfaceReferences(interfaceId: string): Promise<number>
  replaceInterfaceReferences(fromInterfaceId: string, toInterfaceId: string): Promise<void>
}

export function createTemplateInterfaceReferenceManager(
  repository: Pick<TemplateRepository, 'listTemplateIds' | 'getTemplate' | 'saveTemplate'>
): TemplateInterfaceReferenceManager {
  return {
    async countInterfaceReferences(interfaceId) {
      let count = 0
      for (const templateId of await repository.listTemplateIds()) {
        const document = await repository.getTemplate(templateId)
        if (!document) continue
        count += document.content.interfaces.filter(
          (requirement) => requirement.interfaceId === interfaceId
        ).length
      }
      return count
    },

    async replaceInterfaceReferences(fromInterfaceId, toInterfaceId) {
      if (fromInterfaceId === toInterfaceId) return
      const replacements: Array<{ previous: TemplateDocument; saved: TemplateDocument }> = []
      try {
        for (const templateId of await repository.listTemplateIds()) {
          const previous = await repository.getTemplate(templateId)
          if (!previous) continue
          if (
            !previous.content.interfaces.some(
              (requirement) => requirement.interfaceId === fromInterfaceId
            )
          ) {
            continue
          }
          const saved = await repository.saveTemplate({
            ...previous,
            content: {
              ...previous.content,
              interfaces: previous.content.interfaces.map((requirement) =>
                requirement.interfaceId === fromInterfaceId
                  ? { ...requirement, interfaceId: toInterfaceId }
                  : requirement
              )
            }
          })
          replacements.push({ previous, saved })
        }
      } catch (error) {
        await rollbackReplacements(repository, replacements)
        throw error
      }
    }
  }
}

async function rollbackReplacements(
  repository: Pick<TemplateRepository, 'saveTemplate'>,
  replacements: readonly { previous: TemplateDocument; saved: TemplateDocument }[]
): Promise<void> {
  for (const { previous, saved } of [...replacements].reverse()) {
    await repository.saveTemplate({ ...previous, revision: saved.revision })
  }
}
