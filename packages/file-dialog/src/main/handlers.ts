import { basename } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { FILE_DIALOG_CHANNELS } from '../shared/constants'
import type { ReadFileOptions, WriteFileOptions } from '../shared/types'
import { validateReadFileOptions, validateWriteFileOptions } from '../shared/validation'

let registered = false

export function registerFileDialogHandlers(): void {
  if (registered) return
  registered = true

  ipcMain.handle(FILE_DIALOG_CHANNELS.read, async (event, options?: ReadFileOptions) => {
    validateReadFileOptions(options)
    const parent = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      title: options?.title,
      filters: copyFilters(options?.filters),
      properties: ['openFile'] as const
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    return {
      name: basename(filePath),
      data: new Uint8Array(await readFile(filePath))
    }
  })

  ipcMain.handle(
    FILE_DIALOG_CHANNELS.write,
    async (event, data: Uint8Array, options?: WriteFileOptions) => {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError('File-dialog data must be a Uint8Array')
      }
      validateWriteFileOptions(options)
      const parent = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        title: options?.title,
        defaultPath: options?.defaultName,
        filters: copyFilters(options?.filters)
      }
      const result = parent
        ? await dialog.showSaveDialog(parent, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)

      if (result.canceled || !result.filePath) return false

      await writeFile(result.filePath, data)
      return true
    }
  )
}

function copyFilters(
  filters: ReadFileOptions['filters'] | WriteFileOptions['filters']
): Array<{ name: string; extensions: string[] }> | undefined {
  return filters?.map(({ name, extensions }) => ({ name, extensions: [...extensions] }))
}
