import { ipcMain } from 'electron'
import { LICENSE_CHANNELS } from '@ls101/core-types'
import { LicenseService, type LicenseServiceOptions } from './license-service'

export function registerLicenseHandlers(options: LicenseServiceOptions): void {
  const service = new LicenseService(options)
  ipcMain.handle(LICENSE_CHANNELS.getStatus, () => service.getStatus())
  ipcMain.handle(LICENSE_CHANNELS.activate, (_event, invitationCode: unknown) =>
    service.activate(invitationCode)
  )
}
