import type { BuiltinFileStoreBridge } from '../shared/types'

declare global {
  interface Window {
    builtinFileStore: BuiltinFileStoreBridge
  }
}

export function getBuiltinFileStoreBridge(): BuiltinFileStoreBridge {
  if (!window.builtinFileStore) {
    throw new Error('Builtin file-store preload bridge is unavailable')
  }
  return window.builtinFileStore
}
