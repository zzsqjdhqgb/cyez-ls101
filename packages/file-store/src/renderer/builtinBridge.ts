import type { BuiltinFileStoreBridge } from '../shared/types'

declare global {
  interface Window {
    builtinFileStore: BuiltinFileStoreBridge
  }
}

export function getBuiltinFileStoreBridge(): BuiltinFileStoreBridge {
  if (!window.builtinFileStore) {
    throw new Error('内置文件存储预加载桥接不可用')
  }
  return window.builtinFileStore
}
