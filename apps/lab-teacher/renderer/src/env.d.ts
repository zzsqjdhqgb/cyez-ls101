import type { WindowControlsBridge } from '@ls101/core-types'
import type { LabHost } from '@ls101/lab-desktop-host'

declare global {
  interface Window {
    lab: LabHost
    windowControls?: WindowControlsBridge
  }
}

export {}
