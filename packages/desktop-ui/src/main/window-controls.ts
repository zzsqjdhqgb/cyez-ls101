import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { WINDOW_CONTROL_CHANNELS, WINDOW_CONTROL_EVENTS } from '@ls101/core-types'

function getSenderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window && !window.isDestroyed() ? window : null
}

export function registerWindowControlHandlers(): void {
  ipcMain.handle(WINDOW_CONTROL_CHANNELS.minimize, (event) => {
    getSenderWindow(event)?.minimize()
  })

  ipcMain.handle(WINDOW_CONTROL_CHANNELS.toggleMaximize, (event) => {
    const window = getSenderWindow(event)
    if (!window) return

    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  })

  ipcMain.handle(WINDOW_CONTROL_CHANNELS.close, (event) => {
    getSenderWindow(event)?.close()
  })

  ipcMain.handle(WINDOW_CONTROL_CHANNELS.getMaximized, (event) => {
    return getSenderWindow(event)?.isMaximized() ?? false
  })
}

export function bindWindowControlEvents(window: BrowserWindow): void {
  const notifyMaximizedChanged = (maximized: boolean): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(WINDOW_CONTROL_EVENTS.maximizedChanged, maximized)
    }
  }

  window.on('maximize', () => notifyMaximizedChanged(true))
  window.on('unmaximize', () => notifyMaximizedChanged(false))
}
