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
import {
  AIROUTER_CHANNELS,
  type AIRouterBridge,
  type AIRouterImageGenerationEvent,
  type AIRouterImageProviderConfigInput,
  type AIRouterImageRequest,
  type AIRouterProviderConfigInput,
  type AIRouterStreamEvent,
  type AIRouterTextRequest
} from '@ls101/airouter/shared'
import { CLIPBOARD_CHANNELS, type ClipboardBridge } from '@ls101/clipboard/shared'

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

const airouterBridge: AIRouterBridge = {
  listProviderConfigs() {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listConfigs)
  },
  saveProviderConfig(config: AIRouterProviderConfigInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.saveConfig, config)
  },
  deleteProviderConfig(id: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.deleteConfig, id)
  },
  readProviderApiKey(id: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.readApiKey, id)
  },
  listModels(config: AIRouterProviderConfigInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listModels, config)
  },
  testConnection(request) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.testConnection, request)
  },
  listImageProviderConfigs() {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listImageConfigs)
  },
  saveImageProviderConfig(config: AIRouterImageProviderConfigInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.saveImageConfig, config)
  },
  deleteImageProviderConfig(id: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.deleteImageConfig, id)
  },
  readImageProviderApiKey(id: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.readImageApiKey, id)
  },
  listImageModels(config: AIRouterImageProviderConfigInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listImageModels, config)
  },
  getImageGenerationSettings() {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.getImageSettings)
  },
  saveImageGenerationSettings(settings) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.saveImageSettings, settings)
  },
  testImageConnection(request) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.testImageConnection, request)
  },
  startTextGeneration(
    request: AIRouterTextRequest,
    listener: (event: AIRouterStreamEvent) => void
  ) {
    const requestId = crypto.randomUUID()
    const handler = (_event: IpcRendererEvent, id: string, event: AIRouterStreamEvent): void => {
      if (id !== requestId) return
      listener(event)
      if (event.type === 'done' || event.type === 'error') {
        ipcRenderer.removeListener(AIROUTER_CHANNELS.generateEvent, handler)
      }
    }
    ipcRenderer.on(AIROUTER_CHANNELS.generateEvent, handler)
    ipcRenderer.send(AIROUTER_CHANNELS.generateStart, requestId, request)
    return () => {
      ipcRenderer.removeListener(AIROUTER_CHANNELS.generateEvent, handler)
      ipcRenderer.send(AIROUTER_CHANNELS.generateAbort, requestId)
    }
  },
  startImageGeneration(
    request: AIRouterImageRequest,
    listener: (event: AIRouterImageGenerationEvent) => void
  ) {
    const requestId = crypto.randomUUID()
    const handler = (
      _event: IpcRendererEvent,
      id: string,
      event: AIRouterImageGenerationEvent
    ): void => {
      if (id !== requestId) return
      listener(event)
      ipcRenderer.removeListener(AIROUTER_CHANNELS.imageGenerateEvent, handler)
    }
    ipcRenderer.on(AIROUTER_CHANNELS.imageGenerateEvent, handler)
    ipcRenderer.send(AIROUTER_CHANNELS.imageGenerateStart, requestId, request)
    return () => {
      ipcRenderer.removeListener(AIROUTER_CHANNELS.imageGenerateEvent, handler)
      ipcRenderer.send(AIROUTER_CHANNELS.imageGenerateAbort, requestId)
    }
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

const clipboardBridge: ClipboardBridge = {
  readImage() {
    return ipcRenderer.invoke(CLIPBOARD_CHANNELS.readImage)
  },
  writeText(text: string) {
    return ipcRenderer.invoke(CLIPBOARD_CHANNELS.writeText, text)
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
contextBridge.exposeInMainWorld('airouter', airouterBridge)
contextBridge.exposeInMainWorld('fileDialog', fileDialogBridge)
contextBridge.exposeInMainWorld('imageClipboard', clipboardBridge)
contextBridge.exposeInMainWorld('windowControls', windowControlsBridge)
