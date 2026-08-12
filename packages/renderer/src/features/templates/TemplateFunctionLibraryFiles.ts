import {
  createFunctionLibraryRelease,
  deriveFunctionLibraryContentHash,
  parseFunctionLibraryRelease,
  type FunctionLibraryRelease,
  type TemplateApplication
} from '@ls101/template-editor'
import { fileDialog, type FileDialog } from '@ls101/file-dialog/renderer'

const FUNCTION_LIBRARY_FILTER = [
  { name: 'LS101 Function Library', extensions: ['lsfunclib'] }
] as const

type FunctionLibraryFileDialog = Pick<FileDialog, 'readText' | 'writeText'>

export async function importFunctionLibraryFile(
  application: TemplateApplication,
  dialog: FunctionLibraryFileDialog = fileDialog
): Promise<FunctionLibraryRelease | null> {
  const selected = await dialog.readText({
    title: '导入函数库',
    filters: FUNCTION_LIBRARY_FILTER
  })
  if (!selected) return null

  let value: unknown
  try {
    value = JSON.parse(selected.data)
  } catch {
    throw new Error('函数库文件不是有效的 JSON')
  }
  const release = parseFunctionLibraryRelease(value)
  if (!release) throw new Error('函数库文件格式无效')
  return application.functionLibraries.imported.register(release)
}

export async function exportLocalFunctionLibraryFile(
  application: TemplateApplication,
  libraryId: string,
  dialog: FunctionLibraryFileDialog = fileDialog
): Promise<FunctionLibraryRelease | null> {
  const library = await application.functionLibraries.local.get(libraryId)
  if (!library) throw new Error(`本地函数库不存在：${libraryId}`)

  const contentHash = await deriveFunctionLibraryContentHash(library.content)
  const unchanged = library.exportState?.contentHash === contentHash
  const version = unchanged ? library.revision : library.revision + 1
  const release = await createFunctionLibraryRelease(library.libraryId, version, library.content)
  const written = await dialog.writeText(`${JSON.stringify(release, null, 2)}\n`, {
    title: '导出函数库',
    defaultName: `${safeFilename(library.content.name)}-v${version}.lsfunclib`,
    filters: FUNCTION_LIBRARY_FILTER
  })
  if (!written) return null

  if (!unchanged) {
    await application.functionLibraries.local.save({
      ...library,
      revision: release.version,
      exportState: { contentHash: release.contentHash }
    })
  }
  return release
}

function safeFilename(name: string): string {
  const safe = Array.from(name.normalize('NFC'), (character) => {
    const code = character.codePointAt(0) as number
    return code < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character
  })
    .join('')
    .trim()
    .replace(/^\.+|\.+$/g, '')
  return safe || 'function-library'
}
