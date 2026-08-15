import { describe, expect, it, vi } from 'vitest'
import type { TemplateApplication, TemplateDocument } from '@ls101/template-editor'
import { exportTemplateDocumentFile } from '../features/templates/TemplateDocumentFiles'

const TEMPLATE_ID = '10000000-0000-4000-8000-000000000001'

describe('Template document files', () => {
  it('exports the complete persisted document as formatted JSON', async () => {
    const document = template('口语/听力模板', 3)
    const writeText = vi.fn().mockResolvedValue(true)
    const application = templateApplication(document)

    await expect(
      exportTemplateDocumentFile(application, TEMPLATE_ID, { writeText })
    ).resolves.toEqual(document)

    expect(application.templates.get).toHaveBeenCalledWith(TEMPLATE_ID)
    expect(writeText).toHaveBeenCalledWith(`${JSON.stringify(document, null, 2)}\n`, {
      title: '导出模板',
      defaultName: '口语_听力模板-r3.lstemplate',
      filters: [{ name: 'LS101 Template', extensions: ['lstemplate'] }]
    })
  })

  it('returns null when the save dialog is cancelled', async () => {
    const writeText = vi.fn().mockResolvedValue(false)

    await expect(
      exportTemplateDocumentFile(templateApplication(template()), TEMPLATE_ID, { writeText })
    ).resolves.toBeNull()
  })

  it('rejects a missing template before opening the save dialog', async () => {
    const writeText = vi.fn()
    const application = templateApplication(null)

    await expect(
      exportTemplateDocumentFile(application, TEMPLATE_ID, { writeText })
    ).rejects.toThrow(`模板不存在：${TEMPLATE_ID}`)
    expect(writeText).not.toHaveBeenCalled()
  })
})

function template(name = '听力模板', revision = 1): TemplateDocument {
  return {
    templateId: TEMPLATE_ID,
    revision,
    content: {
      name,
      description: '模板描述',
      interfaces: [],
      root: { id: 'root', type: 'frame', children: [] },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: { selected: 'root' }
  }
}

function templateApplication(document: TemplateDocument | null): TemplateApplication {
  return {
    templates: { get: vi.fn().mockResolvedValue(document) }
  } as unknown as TemplateApplication
}
