import { fileDialog, type FileDialog } from '@ls101/file-dialog/renderer'
import {
  exportInterfacePackage,
  importInterfacePackage,
  inspectInterfacePackage,
  type InstanceSelection,
  type InterfaceExchangePackage,
  type InterfacePackageImportResult,
  type InterfacePackageInspection
} from './exchange'
import type { InterfaceRepository } from './repository'
import { decodeInterfaceZip, encodeInterfaceZip } from './zip'

const FILE_FILTER = [{ name: 'LS101 Interface', extensions: ['lsinterface'] }] as const

export type InterfaceFileDialog = Pick<FileDialog, 'readBinary' | 'writeBinary'>

export interface InterfaceFileReadResult {
  filename: string
  package: InterfaceExchangePackage
}

export interface InterfaceFileImportResult extends InterfacePackageImportResult {
  filename: string
}

export async function exportInterfaceFile(
  repository: InterfaceRepository,
  interfaceId: string,
  instances: InstanceSelection,
  dialog: InterfaceFileDialog = fileDialog
): Promise<boolean> {
  const value = await exportInterfacePackage(repository, interfaceId, instances)
  const bytes = await encodeInterfaceZip(value)
  return dialog.writeBinary(bytes, {
    title: '导出 Interface',
    defaultName: `${safeFilename(value.interface.name)}.lsinterface`,
    filters: FILE_FILTER
  })
}

export async function readInterfaceFile(
  dialog: InterfaceFileDialog = fileDialog
): Promise<InterfaceFileReadResult | null> {
  const selected = await dialog.readBinary({ title: '导入 Interface', filters: FILE_FILTER })
  if (!selected) return null
  return { filename: selected.name, package: await decodeInterfaceZip(selected.data) }
}

export async function inspectInterfaceFile(
  dialog: InterfaceFileDialog = fileDialog
): Promise<(InterfaceFileReadResult & { inspection: InterfacePackageInspection }) | null> {
  const selected = await readInterfaceFile(dialog)
  if (!selected) return null
  return { ...selected, inspection: await inspectInterfacePackage(selected.package) }
}

export async function importInterfaceFile(
  repository: InterfaceRepository,
  instances: InstanceSelection,
  dialog: InterfaceFileDialog = fileDialog
): Promise<InterfaceFileImportResult | null> {
  const selected = await readInterfaceFile(dialog)
  if (!selected) return null
  const result = await importInterfacePackage(repository, selected.package, { instances })
  return { filename: selected.filename, ...result }
}

function safeFilename(name: string): string {
  const safe = Array.from(name.normalize('NFC'), (character) => {
    const code = character.codePointAt(0) as number
    return code < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character
  })
    .join('')
    .trim()
    .replace(/^\.+|\.+$/g, '')
  return safe || 'interface'
}
