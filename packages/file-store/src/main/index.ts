import { registerFileStoreHandlers } from './handlers'
import { registerAssetProtocol, registerAssetScheme } from './protocol'

export function registerFileStoreScheme(): void {
  registerAssetScheme()
}

export function registerFileStore(options: { baseDir: string }): void {
  registerFileStoreHandlers(options.baseDir)
  registerAssetProtocol(options.baseDir)
}
