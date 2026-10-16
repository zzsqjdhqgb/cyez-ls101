import { app, ipcMain } from 'electron'
import { APP_INFO_CHANNELS } from '@ls101/core-types'
import { claimReleaseNotesVersion, ensureInstallationMarker } from './installation-marker'

/** 注册应用版本、安装标记与更新说明展示状态的 IPC 接口。 */
export function registerAppInfoHandlers(): void {
  ipcMain.handle(APP_INFO_CHANNELS.getVersion, () => app.getVersion())
  // 安装标记保存在 Electron 用户目录，独立于可迁移的业务数据目录。
  ipcMain.handle(APP_INFO_CHANNELS.ensureInstallationMarker, async () => {
    await ensureInstallationMarker(app.getPath('userData'), app.getVersion())
  })
  // 由主进程统一领取版本展示资格，避免同一版本重复弹出更新说明。
  ipcMain.handle(APP_INFO_CHANNELS.claimReleaseNotesVersion, (_event, version: string) => {
    return claimReleaseNotesVersion(app.getPath('userData'), version)
  })
}
