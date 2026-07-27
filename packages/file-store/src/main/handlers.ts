import { ipcMain } from 'electron'
import { FILE_STORE_CHANNELS } from '../shared/constants'
import type { FileLocation, ScopePath } from '../shared/types'
import { FileStorage } from './storage'

export function registerFileStoreHandlers(baseDir: string): void {
  const storage = new FileStorage(baseDir)

  ipcMain.handle(FILE_STORE_CHANNELS.readText, (_event, location: FileLocation) =>
    storage.readText(location)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.writeText, (_event, location: FileLocation, data: string) =>
    storage.writeText(location, data)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.deleteText, (_event, location: FileLocation) =>
    storage.deleteText(location)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.hasText, (_event, location: FileLocation) =>
    storage.hasText(location)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.listText, (_event, scope: ScopePath) =>
    storage.listText(scope)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.readAsset, (_event, location: FileLocation) =>
    storage.readAsset(location)
  )
  ipcMain.handle(
    FILE_STORE_CHANNELS.writeAsset,
    (_event, location: FileLocation, data: Uint8Array) => storage.writeAsset(location, data)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.deleteAsset, (_event, location: FileLocation) =>
    storage.deleteAsset(location)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.hasAsset, (_event, location: FileLocation) =>
    storage.hasAsset(location)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.listAssets, (_event, scope: ScopePath) =>
    storage.listAssets(scope)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.listScopes, (_event, scope: ScopePath) =>
    storage.listScopes(scope)
  )
  ipcMain.handle(FILE_STORE_CHANNELS.clearScope, (_event, scope: ScopePath) =>
    storage.clearScope(scope)
  )
}
