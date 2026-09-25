import type { FileDialogBridge } from '../shared/types'

declare global {
  interface Window {
    fileDialog: FileDialogBridge
  }
}

export function getFileDialogBridge(): FileDialogBridge {
  if (!window.fileDialog) throw new Error('文件对话框预加载桥接不可用')
  return window.fileDialog
}
