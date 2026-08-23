import { app, ipcMain } from 'electron'
import { APP_INFO_CHANNELS } from '@ls101/core-types'
import { ensureInstallationMarker } from './installation-marker'

export function registerAppInfoHandlers(): void {
  ipcMain.handle(APP_INFO_CHANNELS.getVersion, () => app.getVersion())
  ipcMain.handle(APP_INFO_CHANNELS.ensureInstallationMarker, async () => {
    await ensureInstallationMarker(app.getPath('userData'), app.getVersion())
  })
}
