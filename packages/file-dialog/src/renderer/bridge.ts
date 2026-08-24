import type { FileDialogBridge } from '../shared/types'

declare global {
  interface Window {
    fileDialog: FileDialogBridge
  }
}

export function getFileDialogBridge(): FileDialogBridge {
  if (!window.fileDialog) throw new Error('File-dialog preload bridge is unavailable')
  return window.fileDialog
}
