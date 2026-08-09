import { app, ipcMain } from 'electron'
import { APP_INFO_CHANNELS } from '@ls101/core-types'

export function registerAppInfoHandlers(): void {
  ipcMain.handle(APP_INFO_CHANNELS.getVersion, () => app.getVersion())
}
