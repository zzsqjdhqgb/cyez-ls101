import { ipcMain } from 'electron'
import { CONFIG_STORE_CHANNELS } from '../shared/constants'
import type { ConfigLocation, ConfigScope, JsonValue } from '../shared/types'
import { JsonConfigStorage } from './storage'

export function registerConfigStoreHandlers(baseDir: string): void {
  const storage = new JsonConfigStorage(baseDir)

  ipcMain.handle(CONFIG_STORE_CHANNELS.read, (_event, location: ConfigLocation) =>
    storage.read(location)
  )
  ipcMain.handle(
    CONFIG_STORE_CHANNELS.write,
    (_event, location: ConfigLocation, value: JsonValue) => storage.write(location, value)
  )
  ipcMain.handle(CONFIG_STORE_CHANNELS.delete, (_event, location: ConfigLocation) =>
    storage.delete(location)
  )
  ipcMain.handle(CONFIG_STORE_CHANNELS.clear, (_event, scope: ConfigScope) => storage.clear(scope))
}
