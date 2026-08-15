import type { TemplateApplication, TemplateDocument } from '@ls101/template-editor'
import { fileDialog, type FileDialog } from '@ls101/file-dialog/renderer'

const TEMPLATE_FILTER = [{ name: 'LS101 Template', extensions: ['lstemplate'] }] as const

type TemplateFileDialog = Pick<FileDialog, 'writeText'>

export async function exportTemplateDocumentFile(
  application: TemplateApplication,
  templateId: string,
  dialog: TemplateFileDialog = fileDialog
): Promise<TemplateDocument | null> {
  const document = await application.templates.get(templateId)
  if (!document) throw new Error(`模板不存在：${templateId}`)

  const written = await dialog.writeText(`${JSON.stringify(document, null, 2)}\n`, {
    title: '导出模板',
    defaultName: `${safeFilename(document.content.name)}-r${document.revision}.lstemplate`,
    filters: TEMPLATE_FILTER
  })
  return written ? document : null
}

function safeFilename(name: string): string {
  const safe = Array.from(name.normalize('NFC'), (character) => {
    const code = character.codePointAt(0) as number
    return code < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character
  })
    .join('')
    .trim()
    .replace(/^\.+|\.+$/g, '')
  return safe || 'template'
}
