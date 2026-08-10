import type { AppInfoBridge, WindowControlsBridge } from '@ls101/core-types'

declare global {
  interface Window {
    appInfo?: AppInfoBridge
    windowControls?: WindowControlsBridge
  }
}

export {}
