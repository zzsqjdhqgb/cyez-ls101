import { app } from 'electron'
import { registerFileStore, registerFileStoreScheme } from '@ls101/file-store/main'

registerFileStoreScheme()

app.whenReady().then(() => {
  registerFileStore({ baseDir: app.getPath('userData') })
})
