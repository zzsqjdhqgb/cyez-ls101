import type {
  AppInfoBridge,
  DataDirectoryBridge,
  LicenseBridge,
  WindowControlsBridge
} from '@ls101/core-types'

declare global {
  interface Window {
    appInfo?: AppInfoBridge
    dataDirectory?: DataDirectoryBridge
    license?: LicenseBridge
    windowControls?: WindowControlsBridge
  }
}

export {}
