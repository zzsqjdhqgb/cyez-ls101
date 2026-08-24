import { registerBuiltinFileStoreHandlers } from './builtinHandlers'
import { registerFileStoreHandlers } from './handlers'
import {
  registerAssetProtocol,
  registerAssetScheme,
  registerBuiltinAssetProtocol,
  registerBuiltinAssetScheme
} from './protocol'

export function registerFileStoreScheme(): void {
  registerAssetScheme()
}

export function registerBuiltinFileStoreScheme(): void {
  registerBuiltinAssetScheme()
}

export function registerFileStore(options: { baseDir: string }): void {
  registerFileStoreHandlers(options.baseDir)
  registerAssetProtocol(options.baseDir)
}

export function registerBuiltinFileStore(options: { baseDir: string }): void {
  registerBuiltinFileStoreHandlers(options.baseDir)
  registerBuiltinAssetProtocol(options.baseDir)
}
