/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// NOTE: registerPrivilegedSchemes() must be called before createWindow().
// It is defined and invoked in ../index.ts prior to app.whenReady().

import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'node:path'
import process from 'node:process'
import { setMainWindow } from '../win'
import { isDevToolsEnabled } from '../ipc/dev'
import { bindWindowEvents } from '../ipc/window'

const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

const ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, 'resources', 'icon.png')
  : join(app.getAppPath(), 'resources', 'icon.png')

export function createWindow(): void {
  Menu.setApplicationMenu(null)
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    title: '曹二听说101',
    frame: false,
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  setMainWindow(win)

  bindWindowEvents(win)

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && isDevToolsEnabled()) {
      win.webContents.toggleDevTools()
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    setMainWindow(null)
  })
}
