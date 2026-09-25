import type { ClipboardBridge } from '../shared/types'

declare global {
  interface Window {
    imageClipboard: ClipboardBridge
  }
}

export function getClipboardBridge(): ClipboardBridge {
  if (!window.imageClipboard) throw new Error('剪贴板预加载桥接不可用')
  return window.imageClipboard
}
