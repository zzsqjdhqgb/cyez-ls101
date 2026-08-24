import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import type { Logger } from '@ls101/logger/main'
import { bindWindowControlEvents } from './window-controls'

const DEVELOPMENT_RENDERER_URL = process.env['ELECTRON_RENDERER_URL']

export function createMainWindow(logger?: Logger): BrowserWindow {
  Menu.setApplicationMenu(null)

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: '曹二听说101',
    backgroundColor: '#ffffff',
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  bindWindowControlEvents(window)

  window.once('ready-to-show', () => {
    window.show()
    logger?.info('Main window ready to show')
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger?.error('Renderer failed to load', undefined, {
      errorCode,
      errorDescription,
      validatedURL
    })
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    logger?.error('Renderer process exited', undefined, {
      reason: details.reason,
      exitCode: details.exitCode
    })
  })

  window.on('unresponsive', () => logger?.warn('Main window became unresponsive'))
  window.on('responsive', () => logger?.info('Main window became responsive'))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (currentUrl && url !== currentUrl) {
      event.preventDefault()
    }
  })

  if (DEVELOPMENT_RENDERER_URL) {
    void window.loadURL(DEVELOPMENT_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
