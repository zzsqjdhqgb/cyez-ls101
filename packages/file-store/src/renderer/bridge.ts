import type { FileStoreBridge } from '../shared/types'

declare global {
  interface Window {
    fileStore: FileStoreBridge
  }
}

export function getFileStoreBridge(): FileStoreBridge {
  if (!window.fileStore) throw new Error('File-store preload bridge is unavailable')
  return window.fileStore
}
