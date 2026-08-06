import { ipcMain } from 'electron'
import { BUILTIN_FILE_STORE_CHANNELS } from '../shared/constants'
import type { FileLocation, ScopePath } from '../shared/types'
import { FileStorage } from './storage'

export function registerBuiltinFileStoreHandlers(baseDir: string): void {
  const storage = new FileStorage(baseDir)

  ipcMain.handle(BUILTIN_FILE_STORE_CHANNELS.readText, (_event, location: FileLocation) =>
    storage.readText(location)
  )
  ipcMain.handle(BUILTIN_FILE_STORE_CHANNELS.hasText, (_event, location: FileLocation) =>
    storage.hasText(location)
  )
  ipcMain.handle(BUILTIN_FILE_STORE_CHANNELS.listText, (_event, scope: ScopePath) =>
    storage.listText(scope)
  )
  ipcMain.handle(BUILTIN_FILE_STORE_CHANNELS.readAsset, (_event, location: FileLocation) =>
    storage.readAsset(location)
  )
  ipcMain.handle(BUILTIN_FILE_STORE_CHANNELS.hasAsset, (_event, location: FileLocation) =>
    storage.hasAsset(location)
  )
  ipcMain.handle(BUILTIN_FILE_STORE_CHANNELS.listAssets, (_event, scope: ScopePath) =>
    storage.listAssets(scope)
  )
  ipcMain.handle(BUILTIN_FILE_STORE_CHANNELS.listScopes, (_event, scope: ScopePath) =>
    storage.listScopes(scope)
  )
}
