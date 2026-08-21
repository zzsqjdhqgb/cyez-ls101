import type { AppInfoBridge, DataDirectoryBridge, WindowControlsBridge } from '@ls101/core-types'

declare global {
  interface Window {
    appInfo?: AppInfoBridge
    dataDirectory?: DataDirectoryBridge
    windowControls?: WindowControlsBridge
  }
}

export {}
