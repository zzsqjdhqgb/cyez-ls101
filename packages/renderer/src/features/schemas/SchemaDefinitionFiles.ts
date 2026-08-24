import type { SchemaDefinition } from '@ls101/schema-editor'
import { fileDialog, type FileDialog } from '@ls101/file-dialog/renderer'

const SCHEMA_FILTER = [{ name: 'LS101 Schema', extensions: ['lsschema'] }] as const

export type SchemaFileDialog = Pick<FileDialog, 'writeText'>

export async function exportSchemaDefinitionFile(
  definition: SchemaDefinition,
  dialog: SchemaFileDialog = fileDialog
): Promise<boolean> {
  return dialog.writeText(`${JSON.stringify(definition, null, 2)}\n`, {
    title: '导出 Schema',
    defaultName: `${safeFilename(definition.data.name)}-r${definition.revision}.lsschema`,
    filters: SCHEMA_FILTER
  })
}

function safeFilename(name: string): string {
  const safe = Array.from(name.normalize('NFC'), (character) => {
    const code = character.codePointAt(0) as number
    return code < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character
  })
    .join('')
    .trim()
    .replace(/^\.+|\.+$/g, '')
  return safe || 'schema'
}
