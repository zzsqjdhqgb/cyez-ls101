import { registerConfigStoreHandlers } from './handlers'

export function registerConfigStore(options: { baseDir: string }): void {
  registerConfigStoreHandlers(options.baseDir)
}
