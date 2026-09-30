import type { IpcRenderer, IpcRendererEvent } from 'electron'
import {
  WINDOW_CONTROL_CHANNELS,
  WINDOW_CONTROL_EVENTS,
  type WindowControlsBridge
} from '@ls101/core-types'

export function createWindowControlsBridge(ipcRenderer: IpcRenderer): WindowControlsBridge {
  return {
    minimize() {
      return ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.minimize)
    },
    toggleMaximize() {
      return ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.toggleMaximize)
    },
    close() {
      return ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.close)
    },
    getMaximized() {
      return ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.getMaximized)
    },
    onMaximizedChange(listener) {
      const handler = (_event: IpcRendererEvent, maximized: boolean): void => {
        listener(maximized)
      }

      ipcRenderer.on(WINDOW_CONTROL_EVENTS.maximizedChanged, handler)
      return () => {
        ipcRenderer.removeListener(WINDOW_CONTROL_EVENTS.maximizedChanged, handler)
      }
    }
  }
}
