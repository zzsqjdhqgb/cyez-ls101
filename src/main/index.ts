import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerConfigStore } from '@ls101/config-store/main'
import { registerAIRouter } from '@ls101/airouter/main'
import { registerClipboard } from '@ls101/clipboard/main'
import { registerFileDialog } from '@ls101/file-dialog/main'
import { registerFileStore, registerFileStoreScheme } from '@ls101/file-store/main'
import { createMainWindow } from './window'
import { registerWindowControlHandlers } from './window-controls'

registerFileStoreScheme()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('io.github.zzsqjdhqgb.cyez-ls101')

  registerFileStore({ baseDir: app.getPath('userData') })
  registerConfigStore({ baseDir: app.getPath('userData') })
  registerAIRouter({ baseDir: app.getPath('userData') })
  registerClipboard()
  registerFileDialog()
  registerWindowControlHandlers()

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
