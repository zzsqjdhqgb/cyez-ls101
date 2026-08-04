import type { ImageClipboard } from '../shared/types'
import { getClipboardBridge } from './bridge'

export type { ImageClipboard } from '../shared/types'

export const imageClipboard: ImageClipboard = {
  async readImage() {
    const value = await getClipboardBridge().readImage()
    return value === null ? null : new Uint8Array(value as ArrayLike<number>)
  },
  writeText(text) {
    if (typeof text !== 'string') throw new TypeError('Clipboard text must be a string')
    return getClipboardBridge().writeText(text)
  }
}
