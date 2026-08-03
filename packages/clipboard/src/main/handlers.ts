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
}
