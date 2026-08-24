/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getMainWindow } from '../win'

let windowHandlersRegistered = false

export function registerWindowIpcHandlersOnce(): void {
  if (windowHandlersRegistered) return
  windowHandlersRegistered = true

  ipcMain.handle('window:minimize', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.minimize()
  })
  ipcMain.handle('window:maximize', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.isMaximized() ? win.unmaximize() : win.maximize()
    }
  })
  ipcMain.handle('window:close', () => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.close()
  })
  ipcMain.handle('window:isMaximized', () => {
    const win = getMainWindow()
    return win ? win.isMaximized() : false
  })
}

export function bindWindowEvents(win: BrowserWindow): void {
  win.on('maximize', () => win.webContents.send('window:maximize-change', true))
  win.on('unmaximize', () => win.webContents.send('window:maximize-change', false))
}
