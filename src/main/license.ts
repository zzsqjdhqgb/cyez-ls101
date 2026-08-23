import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LICENSE_CHANNELS } from '@ls101/core-types'
import { LicenseService, type LicenseServiceOptions } from './license-service'

let activationGuideWindow: BrowserWindow | null = null

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
  ipcMain.handle(LICENSE_CHANNELS.openActivationGuide, (event) => openActivationGuide(event))
}

async function openActivationGuide(event: IpcMainInvokeEvent): Promise<void> {
  if (activationGuideWindow && !activationGuideWindow.isDestroyed()) {
    activationGuideWindow.focus()
    return
  }

  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
  const guidePath = app.isPackaged
    ? join(process.resourcesPath, 'docs', 'license-activation.html')
    : join(app.getAppPath(), 'docs', 'license-activation.html')
  const guideUrl = pathToFileURL(guidePath)
  const guideWindow = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    show: false,
    parent,
    autoHideMenuBar: true,
    title: '软件激活方式意见征集',
    backgroundColor: '#f3f6f4',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: 'license-activation-guide'
    }
  })
  activationGuideWindow = guideWindow

  guideWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  guideWindow.webContents.on('will-navigate', (navigationEvent, url) => {
    if (!isSameGuideDocument(url, guideUrl)) navigationEvent.preventDefault()
  })
  guideWindow.once('ready-to-show', () => {
    if (!guideWindow.isDestroyed()) guideWindow.show()
  })
  guideWindow.on('closed', () => {
    if (activationGuideWindow === guideWindow) activationGuideWindow = null
  })

  try {
    await guideWindow.loadFile(guidePath)
  } catch (error) {
    if (activationGuideWindow === guideWindow) activationGuideWindow = null
    if (!guideWindow.isDestroyed()) guideWindow.destroy()
    throw error
  }
}

function isSameGuideDocument(rawUrl: string, guideUrl: URL): boolean {
  try {
    const target = new URL(rawUrl)
    target.hash = ''
    return target.href === guideUrl.href
  } catch {
    return false
  }
}

function relaunchAfterReply(): void {
  setTimeout(() => {
    if (process.env['LS101_DISABLE_AUTO_RELAUNCH'] !== '1') app.relaunch()
    app.exit(0)
  }, 100)
}
