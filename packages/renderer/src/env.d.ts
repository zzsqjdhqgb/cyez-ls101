import type { WindowControlsBridge } from '@ls101/core-types'

declare global {
  interface Window {
    windowControls?: WindowControlsBridge
  }
}

export {}
