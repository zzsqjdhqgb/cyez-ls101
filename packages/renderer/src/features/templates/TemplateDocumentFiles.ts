import {
  parseTemplateDocument,
  type TemplateApplication,
  type TemplateDocument
} from '@ls101/template-editor'
import { fileDialog, type FileDialog } from '@ls101/file-dialog/renderer'

const TEMPLATE_FILTER = [{ name: 'LS101 Template', extensions: ['lstemplate'] }] as const

type TemplateImportFileDialog = Pick<FileDialog, 'readText'>
type TemplateExportFileDialog = Pick<FileDialog, 'writeText'>

export async function readTemplateDocumentFile(
  dialog: TemplateImportFileDialog = fileDialog
): Promise<TemplateDocument | null> {
  const selected = await dialog.readText({
    title: '导入模板',
    filters: TEMPLATE_FILTER
  })
  if (!selected) return null

  let value: unknown
  try {
    value = JSON.parse(selected.data)
  } catch {
    throw new Error('模板文件不是有效的 JSON')
  }
  const source = parseTemplateDocument(value)
  if (!source) throw new Error('模板文件格式无效')
  return source
}

export async function exportTemplateDocumentFile(
  application: TemplateApplication,
  templateId: string,
  dialog: TemplateExportFileDialog = fileDialog
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
