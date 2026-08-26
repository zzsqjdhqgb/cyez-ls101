import type {
  AppInfoBridge,
  DataDirectoryBridge,
  LegacyDataBridge,
  LicenseBridge,
  StartupBridge,
  WindowControlsBridge
} from '@ls101/core-types'
import type { LoggerBridge } from '@ls101/logger/shared'

declare global {
  interface Window {
    startup?: StartupBridge
    appInfo?: AppInfoBridge
    dataDirectory?: DataDirectoryBridge
    legacyData?: LegacyDataBridge
    license?: LicenseBridge
    windowControls?: WindowControlsBridge
    logger?: LoggerBridge
  }
}

export {}
