import { describe, expect, it, vi } from 'vitest'
import { createTemplateInterfaceReferenceManager } from '../interface-references'
import { createTemplateDocument } from '../id'
import type { TemplateDocument } from '../types'

const OLD_ID = `sha256:${'1'.repeat(64)}`
const NEW_ID = `sha256:${'2'.repeat(64)}`

describe('Template Interface reference manager', () => {
  it('counts requirements and replaces their Interface IDs', async () => {
    const first = document('First', [OLD_ID, OLD_ID])
    const second = document('Second', [NEW_ID])
    const repository = new MemoryTemplateRepository([first, second])
    const references = createTemplateInterfaceReferenceManager(repository)

    await expect(references.countInterfaceReferences(OLD_ID)).resolves.toBe(2)
    await references.replaceInterfaceReferences(OLD_ID, NEW_ID)

    expect(
      (await repository.getTemplate(first.templateId))?.content.interfaces.map(
        ({ interfaceId }) => interfaceId
      )
    ).toEqual([NEW_ID, NEW_ID])
    await expect(references.countInterfaceReferences(OLD_ID)).resolves.toBe(0)
  })

  it('rolls back earlier Template replacements when a later save fails', async () => {
    const first = document('First', [OLD_ID])
    const second = document('Second', [OLD_ID])
    const repository = new MemoryTemplateRepository([first, second])
    const originalSave = repository.saveTemplate.bind(repository)
    repository.saveTemplate = vi
      .fn(originalSave)
      .mockImplementationOnce(originalSave)
      .mockRejectedValueOnce(new Error('save failed'))
      .mockImplementation(originalSave)
    const references = createTemplateInterfaceReferenceManager(repository)

    await expect(references.replaceInterfaceReferences(OLD_ID, NEW_ID)).rejects.toThrow(
      'save failed'
    )
    expect(
      (await repository.getTemplate(first.templateId))?.content.interfaces[0].interfaceId
    ).toBe(OLD_ID)
  })
})

function document(name: string, interfaceIds: readonly string[]): TemplateDocument {
  return createTemplateDocument({
    name,
    description: '',
    interfaces: interfaceIds.map((interfaceId, index) => ({
      alias: `data${index}`,
      interfaceId,
      acceptedVars: ['title']
    })),
    root: { id: 'root', name: '根框架', type: 'frame', children: [] },
    schemaUses: []
  })
}

class MemoryTemplateRepository {
  private readonly documents = new Map<string, TemplateDocument>()

  constructor(documents: readonly TemplateDocument[]) {
    for (const document of documents) {
      this.documents.set(document.templateId, structuredClone(document))
    }
  }

  async listTemplateIds(): Promise<string[]> {
    return [...this.documents.keys()]
  }

  async getTemplate(templateId: string): Promise<TemplateDocument | null> {
    const document = this.documents.get(templateId)
    return document ? structuredClone(document) : null
  }

  async saveTemplate(document: TemplateDocument): Promise<TemplateDocument> {
    const current = this.documents.get(document.templateId)
    if (!current || current.revision !== document.revision) throw new Error('revision conflict')
    const saved = { ...structuredClone(document), revision: document.revision + 1 }
    this.documents.set(document.templateId, saved)
    return structuredClone(saved)
  }
}
