import { registerBuiltinFileStoreHandlers as installBuiltinFileStoreHandlers } from './builtinHandlers'
import { registerFileStoreHandlers as installFileStoreHandlers } from './handlers'
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

export function registerFileStoreProtocol(options: {
  baseDir: string | (() => Promise<string>)
}): void {
  registerAssetProtocol(options.baseDir)
}

export function registerBuiltinFileStoreProtocol(options: {
  baseDir: string | (() => Promise<string>)
}): void {
  registerBuiltinAssetProtocol(options.baseDir)
}

export function registerFileStoreHandlers(options: { baseDir: string }): void {
  installFileStoreHandlers(options.baseDir)
}

export function registerBuiltinFileStoreHandlers(options: { baseDir: string }): void {
  installBuiltinFileStoreHandlers(options.baseDir)
}

export function registerFileStore(options: { baseDir: string }): void {
  installFileStoreHandlers(options.baseDir)
  registerAssetProtocol(options.baseDir)
}

export function registerBuiltinFileStore(options: { baseDir: string }): void {
  installBuiltinFileStoreHandlers(options.baseDir)
  registerBuiltinAssetProtocol(options.baseDir)
}
