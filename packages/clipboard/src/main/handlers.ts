import { clipboard, ipcMain } from 'electron'
import { CLIPBOARD_CHANNELS } from '../shared/constants'

let registered = false

export function registerClipboardHandlers(): void {
  if (registered) return
  registered = true

  ipcMain.handle(CLIPBOARD_CHANNELS.readImage, () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    return new Uint8Array(image.toPNG())
  })
  ipcMain.handle(CLIPBOARD_CHANNELS.writeText, (_event, text: string) => {
    if (typeof text !== 'string') throw new TypeError('Clipboard text must be a string')
    clipboard.writeText(text)
  })
}
