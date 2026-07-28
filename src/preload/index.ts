import { contextBridge, ipcRenderer } from 'electron'
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

const allowedChannels = new Set<FileStoreChannel>(Object.values(FILE_STORE_CHANNELS))

const fileStoreBridge: FileStoreBridge = {
  invoke(channel, ...args) {
    if (!allowedChannels.has(channel as FileStoreChannel)) {
      return Promise.reject(new Error(`Unsupported file-store channel: ${channel}`))
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

contextBridge.exposeInMainWorld('fileStore', fileStoreBridge)
contextBridge.exposeInMainWorld('fileDialog', fileDialogBridge)
