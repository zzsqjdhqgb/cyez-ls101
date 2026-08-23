import { app, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { LICENSE_CHANNELS } from '@ls101/core-types'
import { LicenseService, type LicenseServiceOptions } from './license-service'

export function registerLicenseHandlers(options: LicenseServiceOptions): void {
  const service = new LicenseService(options)
  ipcMain.handle(LICENSE_CHANNELS.getStatus, () => service.getStatus())
  ipcMain.handle(LICENSE_CHANNELS.activate, (_event, invitationCode: unknown) =>
    service.activate(invitationCode)
  )
  ipcMain.handle(LICENSE_CHANNELS.deactivate, async () => {
    await service.deactivate()
    relaunchAfterReply()
  })
  ipcMain.handle(LICENSE_CHANNELS.openActivationGuide, async () => {
    const guidePath = app.isPackaged
      ? join(process.resourcesPath, 'docs', 'license-activation.html')
      : join(app.getAppPath(), 'docs', 'license-activation.html')
    const error = await shell.openPath(guidePath)
    if (error) throw new Error(`无法打开激活方式说明：${error}`)
  })
}

function relaunchAfterReply(): void {
  setTimeout(() => {
    if (process.env['LS101_DISABLE_AUTO_RELAUNCH'] !== '1') app.relaunch()
    app.exit(0)
  }, 100)
}
