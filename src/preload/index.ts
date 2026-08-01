import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  WINDOW_CONTROL_CHANNELS,
  WINDOW_CONTROL_EVENTS,
  type WindowControlsBridge
} from '@ls101/core-types'
import {
  FILE_DIALOG_CHANNELS,
  type FileDialogBridge,
  type ReadFileOptions,
  type WriteFileOptions
} from '@ls101/file-dialog/shared'
import {
  FILE_STORE_CHANNELS,
  type FileStoreBridge,
  type FileStoreChannel
} from '@ls101/file-store/shared'
import {
  CONFIG_STORE_CHANNELS,
  type ConfigStoreBridge,
  type ConfigStoreChannel
} from '@ls101/config-store/shared'

const allowedChannels = new Set<FileStoreChannel>(Object.values(FILE_STORE_CHANNELS))
const allowedConfigChannels = new Set<ConfigStoreChannel>(Object.values(CONFIG_STORE_CHANNELS))

const fileStoreBridge: FileStoreBridge = {
  invoke(channel, ...args) {
    if (!allowedChannels.has(channel as FileStoreChannel)) {
      return Promise.reject(new Error(`Unsupported file-store channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  }
}

const configStoreBridge: ConfigStoreBridge = {
  invoke(channel, ...args) {
    if (!allowedConfigChannels.has(channel as ConfigStoreChannel)) {
      return Promise.reject(new Error(`Unsupported config-store channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  }
}

const fileDialogBridge: FileDialogBridge = {
  read(options?: ReadFileOptions) {
    return ipcRenderer.invoke(FILE_DIALOG_CHANNELS.read, options)
  },
  write(data: Uint8Array, options?: WriteFileOptions) {
    return ipcRenderer.invoke(FILE_DIALOG_CHANNELS.write, data, options)
  }
}

const windowControlsBridge: WindowControlsBridge = {
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

contextBridge.exposeInMainWorld('fileStore', fileStoreBridge)
contextBridge.exposeInMainWorld('configStore', configStoreBridge)
contextBridge.exposeInMainWorld('fileDialog', fileDialogBridge)
contextBridge.exposeInMainWorld('windowControls', windowControlsBridge)
