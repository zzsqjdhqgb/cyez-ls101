import { app, ipcMain } from 'electron'
import { APP_INFO_CHANNELS } from '@ls101/core-types'
import { claimReleaseNotesVersion, ensureInstallationMarker } from './installation-marker'

export function registerAppInfoHandlers(): void {
  ipcMain.handle(APP_INFO_CHANNELS.getVersion, () => app.getVersion())
  ipcMain.handle(APP_INFO_CHANNELS.ensureInstallationMarker, async () => {
    await ensureInstallationMarker(app.getPath('userData'), app.getVersion())
  })
  ipcMain.handle(APP_INFO_CHANNELS.claimReleaseNotesVersion, (_event, version: string) => {
    return claimReleaseNotesVersion(app.getPath('userData'), version)
  })
}
