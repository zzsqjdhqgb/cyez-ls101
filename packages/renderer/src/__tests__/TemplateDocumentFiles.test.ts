import { describe, expect, it, vi } from 'vitest'
import type { TemplateApplication, TemplateDocument } from '@ls101/template-editor'
import {
  exportTemplateDocumentFile,
  readTemplateDocumentFile
} from '../features/templates/TemplateDocumentFiles'

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

  it('reads and validates a selected Template document', async () => {
    const source = template('导入模板', 8)
    const readText = vi.fn().mockResolvedValue({
      name: 'import.lstemplate',
      data: JSON.stringify(source)
    })

    await expect(readTemplateDocumentFile({ readText })).resolves.toEqual(source)
    expect(readText).toHaveBeenCalledWith({
      title: '导入模板',
      filters: [{ name: 'LS101 Template', extensions: ['lstemplate'] }]
    })
  })

  it('handles import cancellation and rejects malformed files', async () => {
    const readText = vi.fn().mockResolvedValue(null)
    await expect(readTemplateDocumentFile({ readText })).resolves.toBeNull()

    readText.mockResolvedValue({ name: 'broken.lstemplate', data: '{' })
    await expect(readTemplateDocumentFile({ readText })).rejects.toThrow('模板文件不是有效的 JSON')

    readText.mockResolvedValue({ name: 'invalid.lstemplate', data: '{}' })
    await expect(readTemplateDocumentFile({ readText })).rejects.toThrow('模板文件格式无效')
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
