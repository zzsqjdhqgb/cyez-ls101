import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  APP_INFO_CHANNELS,
  DATA_DIRECTORY_CHANNELS,
  LEGACY_DATA_CHANNELS,
  LICENSE_CHANNELS,
  WINDOW_CONTROL_CHANNELS,
  WINDOW_CONTROL_EVENTS,
  type AppInfoBridge,
  type DataDirectoryBridge,
  type LegacyDataBridge,
  type LicenseBridge,
  type WindowControlsBridge
} from '@ls101/core-types'
import {
  FILE_DIALOG_CHANNELS,
  type FileDialogBridge,
  type ReadFileOptions,
  type WriteFileOptions
} from '@ls101/file-dialog/shared'
import {
  BUILTIN_FILE_STORE_CHANNELS,
  FILE_STORE_CHANNELS,
  type BuiltinFileStoreBridge,
  type BuiltinFileStoreChannel,
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
  type AIRouterPronunciationAssessmentEvent,
  type AIRouterPronunciationAssessmentExtensionImportResult,
  type AIRouterPronunciationAssessmentRequest,
  type AIRouterSpeechConnectionTestInput,
  type AIRouterSpeechModelPackageImportResult,
  type AIRouterSpeechProviderConfigInput,
  type AIRouterSpeechProviderType,
  type AIRouterSpeechRecognitionEvent,
  type AIRouterSpeechRecognitionModelPackageImportResult,
  type AIRouterSpeechRecognitionProviderConfigInput,
  type AIRouterSpeechRecognitionProviderType,
  type AIRouterSpeechRecognitionRequest,
  type AIRouterSpeechSynthesisEvent,
  type AIRouterSpeechSynthesisRequest,
  type AIRouterSpeechVoiceListInput,
  type AIRouterProviderConfigInput,
  type AIRouterStreamEvent,
  type AIRouterTextRequest
} from '@ls101/airouter/shared'
import { CLIPBOARD_CHANNELS, type ClipboardBridge } from '@ls101/clipboard/shared'
import {
  LOGGER_CHANNELS,
  validateRendererLogEvent,
  type LogEvent,
  type LoggerBridge
} from '@ls101/logger/shared'

const allowedChannels = new Set<FileStoreChannel>(Object.values(FILE_STORE_CHANNELS))
const allowedBuiltinChannels = new Set<BuiltinFileStoreChannel>(
  Object.values(BUILTIN_FILE_STORE_CHANNELS)
)
const allowedConfigChannels = new Set<ConfigStoreChannel>(Object.values(CONFIG_STORE_CHANNELS))

const fileStoreBridge: FileStoreBridge = {
  invoke(channel, ...args) {
    if (!allowedChannels.has(channel as FileStoreChannel)) {
      return Promise.reject(new Error(`Unsupported file-store channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  }
}

const builtinFileStoreBridge: BuiltinFileStoreBridge = {
  invoke(channel, ...args) {
    if (!allowedBuiltinChannels.has(channel as BuiltinFileStoreChannel)) {
      return Promise.reject(new Error(`Unsupported builtin file-store channel: ${channel}`))
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
  testImageConnection(request) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.testImageConnection, request)
  },
  listSpeechProviderConfigs() {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listSpeechConfigs)
  },
  saveSpeechProviderConfig(config: AIRouterSpeechProviderConfigInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.saveSpeechConfig, config)
  },
  deleteSpeechProviderConfig(id: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.deleteSpeechConfig, id)
  },
  readSpeechProviderApiKey(id: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.readSpeechApiKey, id)
  },
  listSpeechModelPackages(providerType?: AIRouterSpeechProviderType) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listSpeechPackages, providerType)
  },
  importSpeechModelPackage(): Promise<AIRouterSpeechModelPackageImportResult | null> {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.importSpeechPackage)
  },
  deleteSpeechModelPackage(id: string, version: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.deleteSpeechPackage, id, version)
  },
  listSpeechModels(config: AIRouterSpeechProviderConfigInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listSpeechModels, config)
  },
  listSpeechVoices(request: AIRouterSpeechVoiceListInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listSpeechVoices, request)
  },
  testSpeechConnection(request: AIRouterSpeechConnectionTestInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.testSpeechConnection, request)
  },
  probeQwenTtsCuda() {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.probeQwenTtsCuda)
  },
  listSpeechRecognitionProviderConfigs() {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listRecognitionConfigs)
  },
  saveSpeechRecognitionProviderConfig(config: AIRouterSpeechRecognitionProviderConfigInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.saveRecognitionConfig, config)
  },
  deleteSpeechRecognitionProviderConfig(id: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.deleteRecognitionConfig, id)
  },
  readSpeechRecognitionProviderApiKey(id: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.readRecognitionApiKey, id)
  },
  listSpeechRecognitionModelPackages(providerType?: AIRouterSpeechRecognitionProviderType) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listRecognitionPackages, providerType)
  },
  importSpeechRecognitionModelPackage(): Promise<AIRouterSpeechRecognitionModelPackageImportResult | null> {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.importRecognitionPackage)
  },
  deleteSpeechRecognitionModelPackage(id: string, version: string) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.deleteRecognitionPackage, id, version)
  },
  listSpeechRecognitionProviderModels(config: AIRouterSpeechRecognitionProviderConfigInput) {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listRecognitionProviderModels, config)
  },
  listSpeechRecognitionModels() {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listRecognitionModels)
  },
  listPronunciationAssessmentModels() {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.listPronunciationModels)
  },
  getPronunciationAssessmentExtensionStatus() {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.pronunciationExtensionStatus)
  },
  importPronunciationAssessmentExtension(): Promise<AIRouterPronunciationAssessmentExtensionImportResult | null> {
    return ipcRenderer.invoke(AIROUTER_CHANNELS.importPronunciationExtension)
  },
  startSpeechRecognition(
    request: AIRouterSpeechRecognitionRequest,
    listener: (event: AIRouterSpeechRecognitionEvent) => void
  ) {
    const requestId = crypto.randomUUID()
    let completed = false
    const handler = (
      _event: IpcRendererEvent,
      id: string,
      event: AIRouterSpeechRecognitionEvent
    ): void => {
      if (id !== requestId) return
      if (event.type === 'result' || event.type === 'error') {
        completed = true
        ipcRenderer.removeListener(AIROUTER_CHANNELS.speechRecognitionEvent, handler)
      }
      listener(event)
    }
    ipcRenderer.on(AIROUTER_CHANNELS.speechRecognitionEvent, handler)
    ipcRenderer.send(AIROUTER_CHANNELS.speechRecognitionStart, requestId, request)
    return () => {
      ipcRenderer.removeListener(AIROUTER_CHANNELS.speechRecognitionEvent, handler)
      if (!completed) ipcRenderer.send(AIROUTER_CHANNELS.speechRecognitionAbort, requestId)
    }
  },
  startPronunciationAssessment(
    request: AIRouterPronunciationAssessmentRequest,
    listener: (event: AIRouterPronunciationAssessmentEvent) => void
  ) {
    const requestId = crypto.randomUUID()
    let completed = false
    const handler = (
      _event: IpcRendererEvent,
      id: string,
      event: AIRouterPronunciationAssessmentEvent
    ): void => {
      if (id !== requestId) return
      if (event.type === 'result' || event.type === 'error') {
        completed = true
        ipcRenderer.removeListener(AIROUTER_CHANNELS.pronunciationAssessmentEvent, handler)
      }
      listener(event)
    }
    ipcRenderer.on(AIROUTER_CHANNELS.pronunciationAssessmentEvent, handler)
    ipcRenderer.send(AIROUTER_CHANNELS.pronunciationAssessmentStart, requestId, request)
    return () => {
      ipcRenderer.removeListener(AIROUTER_CHANNELS.pronunciationAssessmentEvent, handler)
      if (!completed) ipcRenderer.send(AIROUTER_CHANNELS.pronunciationAssessmentAbort, requestId)
    }
  },
  startSpeechSynthesis(
    request: AIRouterSpeechSynthesisRequest,
    listener: (event: AIRouterSpeechSynthesisEvent) => void
  ) {
    const requestId = crypto.randomUUID()
    let completed = false
    const handler = (
      _event: IpcRendererEvent,
      id: string,
      event: AIRouterSpeechSynthesisEvent
    ): void => {
      if (id !== requestId) return
      if (event.type === 'result' || event.type === 'error') {
        completed = true
        ipcRenderer.removeListener(AIROUTER_CHANNELS.speechSynthesisEvent, handler)
      }
      console.info(`[AIRouter Speech ${requestId}] preload received ${event.type} event`)
      listener(event)
    }
    ipcRenderer.on(AIROUTER_CHANNELS.speechSynthesisEvent, handler)
    console.info(`[AIRouter Speech ${requestId}] preload sending synthesis request`)
    ipcRenderer.send(AIROUTER_CHANNELS.speechSynthesisStart, requestId, request)
    return () => {
      ipcRenderer.removeListener(AIROUTER_CHANNELS.speechSynthesisEvent, handler)
      if (!completed) {
        console.info(`[AIRouter Speech ${requestId}] preload sending abort`)
        ipcRenderer.send(AIROUTER_CHANNELS.speechSynthesisAbort, requestId)
      }
    }
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

const appInfoBridge: AppInfoBridge = {
  getVersion() {
    return ipcRenderer.invoke(APP_INFO_CHANNELS.getVersion)
  }
}

const licenseBridge: LicenseBridge = {
  getStatus() {
    return ipcRenderer.invoke(LICENSE_CHANNELS.getStatus)
  },
  activate(invitationCode: string) {
    return ipcRenderer.invoke(LICENSE_CHANNELS.activate, invitationCode)
  },
  deactivate() {
    return ipcRenderer.invoke(LICENSE_CHANNELS.deactivate)
  },
  openActivationGuide() {
    return ipcRenderer.invoke(LICENSE_CHANNELS.openActivationGuide)
  }
}

const dataDirectoryBridge: DataDirectoryBridge = {
  getInfo() {
    return ipcRenderer.invoke(DATA_DIRECTORY_CHANNELS.getInfo)
  },
  choose() {
    return ipcRenderer.invoke(DATA_DIRECTORY_CHANNELS.choose)
  },
  chooseDefault() {
    return ipcRenderer.invoke(DATA_DIRECTORY_CHANNELS.chooseDefault)
  },
  resetDefault() {
    return ipcRenderer.invoke(DATA_DIRECTORY_CHANNELS.resetDefault)
  },
  migrate(path: string) {
    return ipcRenderer.invoke(DATA_DIRECTORY_CHANNELS.migrate, path)
  },
  useExisting(path: string) {
    return ipcRenderer.invoke(DATA_DIRECTORY_CHANNELS.useExisting, path)
  },
  deleteOld() {
    return ipcRenderer.invoke(DATA_DIRECTORY_CHANNELS.deleteOld)
  }
}

const legacyDataBridge: LegacyDataBridge = {
  getInfo() {
    return ipcRenderer.invoke(LEGACY_DATA_CHANNELS.getInfo)
  },
  exportArchive() {
    return ipcRenderer.invoke(LEGACY_DATA_CHANNELS.exportArchive)
  },
  cleanup() {
    return ipcRenderer.invoke(LEGACY_DATA_CHANNELS.cleanup)
  },
  retry() {
    return ipcRenderer.invoke(LEGACY_DATA_CHANNELS.retry)
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

const loggerBridge: LoggerBridge = {
  write(event: LogEvent) {
    try {
      const result = validateRendererLogEvent(event)
      if (result.ok) ipcRenderer.send(LOGGER_CHANNELS.write, result.event)
    } catch (error) {
      console.error('[logger] failed to forward renderer log event', error)
    }
  }
}

contextBridge.exposeInMainWorld('fileStore', fileStoreBridge)
contextBridge.exposeInMainWorld('builtinFileStore', builtinFileStoreBridge)
contextBridge.exposeInMainWorld('configStore', configStoreBridge)
contextBridge.exposeInMainWorld('airouter', airouterBridge)
contextBridge.exposeInMainWorld('fileDialog', fileDialogBridge)
contextBridge.exposeInMainWorld('imageClipboard', clipboardBridge)
contextBridge.exposeInMainWorld('appInfo', appInfoBridge)
contextBridge.exposeInMainWorld('license', licenseBridge)
contextBridge.exposeInMainWorld('dataDirectory', dataDirectoryBridge)
contextBridge.exposeInMainWorld('legacyData', legacyDataBridge)
contextBridge.exposeInMainWorld('windowControls', windowControlsBridge)
contextBridge.exposeInMainWorld('logger', loggerBridge)
