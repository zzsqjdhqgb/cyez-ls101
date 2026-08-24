import { registerConfigStoreHandlers } from './handlers'

export { JsonConfigStorage, resolveConfigPath } from './storage'

export function registerConfigStore(options: { baseDir: string }): void {
  registerConfigStoreHandlers(options.baseDir)
}
