import type { AppInfoBridge, DataDirectoryBridge, WindowControlsBridge } from '@ls101/core-types'
import type { LoggerBridge } from '@ls101/logger/shared'

declare global {
  interface Window {
    appInfo?: AppInfoBridge
    dataDirectory?: DataDirectoryBridge
    windowControls?: WindowControlsBridge
    logger?: LoggerBridge
  }
}

export {}
