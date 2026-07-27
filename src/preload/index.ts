import { contextBridge, ipcRenderer } from 'electron'
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

contextBridge.exposeInMainWorld('fileStore', fileStoreBridge)
