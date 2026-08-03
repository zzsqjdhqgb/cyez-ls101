import type { ClipboardBridge } from '../shared/types'

declare global {
  interface Window {
    imageClipboard: ClipboardBridge
  }
}

export function getClipboardBridge(): ClipboardBridge {
  if (!window.imageClipboard) throw new Error('Clipboard preload bridge is unavailable')
  return window.imageClipboard
}
