import type { FileStoreBridge } from '../shared/types'

declare global {
  interface Window {
    fileStore: FileStoreBridge
  }
}

export function getFileStoreBridge(): FileStoreBridge {
  if (!window.fileStore) throw new Error('文件存储预加载桥接不可用')
  return window.fileStore
}
