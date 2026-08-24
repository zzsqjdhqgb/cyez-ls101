import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  type WebContents
} from 'electron'
import { AIROUTER_CHANNELS } from '../shared'
import type {
  AIRouterConnectionTestInput,
  AIRouterImageConnectionTestInput,
  AIRouterImageGenerationEvent,
  AIRouterImageProviderConfigInput,
  AIRouterImageRequest,
  AIRouterPronunciationAssessmentEvent,
  AIRouterPronunciationAssessmentRequest,
  AIRouterProviderConfigInput,
  AIRouterSpeechConnectionTestInput,
  AIRouterSpeechRecognitionEvent,
  AIRouterSpeechRecognitionProviderConfigInput,
  AIRouterSpeechRecognitionRequest,
  AIRouterSpeechProviderConfigInput,
  AIRouterSpeechSynthesisEvent,
  AIRouterSpeechSynthesisRequest,
  AIRouterSpeechVoiceListInput,
  AIRouterStreamEvent,
  AIRouterTextRequest
} from '../shared'
import { AIRouterService, type AIRouterServiceOptions } from './service'
import { AIRouterImageService } from './image-service'
import { AIRouterSpeechService } from './speech-service'
import { AIRouterSpeechRecognitionService } from './speech-recognition-service'
import { AIRouterPronunciationAssessmentService } from './pronunciation-assessment-service'
import { PocketTtsSynthesizer } from './pocket-tts'
import { QwenTtsSynthesizer } from './qwen-tts'

export { AIRouterService } from './service'
export { AIRouterImageService } from './image-service'
export { AIRouterSpeechService } from './speech-service'
export { AIRouterSpeechRecognitionService } from './speech-recognition-service'
export { AIRouterPronunciationAssessmentService } from './pronunciation-assessment-service'
export { AIRouterSpeechModelStore, AIRouterSpeechRecognitionModelStore } from './speech-model-store'
export { AIRouterExtensionStore } from './extension-store'
export { PocketTtsSynthesizer } from './pocket-tts'
export { QwenTtsSynthesizer } from './qwen-tts'
export type { AIRouterServiceOptions } from './service'
export type {
  AIRouterLocalSpeechRequest,
  AIRouterLocalSpeechSynthesizer,
  AIRouterSpeechServiceOptions
} from './speech-service'

interface ActiveGeneration {
  sender: WebContents
  controller: AbortController
}

export function registerAIRouter(options: AIRouterServiceOptions): void {
  const service = new AIRouterService(options)
  const imageService = new AIRouterImageService(options)
  const qwenTtsSynthesizer = new QwenTtsSynthesizer()
  const speechService = new AIRouterSpeechService({
    baseDir: options.baseDir,
    appVersion: app.getVersion(),
    configStorage: options.configStorage,
    secretStorage: options.secretStorage,
    localSynthesizers: {
      'pocket-tts': new PocketTtsSynthesizer(),
      'qwen-tts': qwenTtsSynthesizer
    }
  })
  app.once('will-quit', () => qwenTtsSynthesizer.dispose())
  const recognitionService = new AIRouterSpeechRecognitionService({
    baseDir: options.baseDir,
    appVersion: app.getVersion(),
    configStorage: options.configStorage,
    secretStorage: options.secretStorage
  })
  app.once('will-quit', () => recognitionService.dispose())
  const pronunciationService = new AIRouterPronunciationAssessmentService({
    baseDir: options.baseDir
  })
  const active = new Map<string, ActiveGeneration>()

  ipcMain.handle(AIROUTER_CHANNELS.listConfigs, () => service.listProviderConfigs())
  ipcMain.handle(AIROUTER_CHANNELS.saveConfig, (_event, input: AIRouterProviderConfigInput) =>
    service.saveProviderConfig(input)
  )
  ipcMain.handle(AIROUTER_CHANNELS.deleteConfig, (_event, id: string) =>
    service.deleteProviderConfig(id)
  )
  ipcMain.handle(AIROUTER_CHANNELS.readApiKey, (_event, id: string) =>
    service.readProviderApiKey(id)
  )
  ipcMain.handle(AIROUTER_CHANNELS.listModels, (_event, input: AIRouterProviderConfigInput) =>
    service.listModels(input)
  )
  ipcMain.handle(AIROUTER_CHANNELS.testConnection, (_event, request: AIRouterConnectionTestInput) =>
    service.testConnection(request)
  )
  ipcMain.handle(AIROUTER_CHANNELS.listImageConfigs, () => imageService.listProviderConfigs())
  ipcMain.handle(
    AIROUTER_CHANNELS.saveImageConfig,
    (_event, input: AIRouterImageProviderConfigInput) => imageService.saveProviderConfig(input)
  )
  ipcMain.handle(AIROUTER_CHANNELS.deleteImageConfig, (_event, id: string) =>
    imageService.deleteProviderConfig(id)
  )
  ipcMain.handle(AIROUTER_CHANNELS.readImageApiKey, (_event, id: string) =>
    imageService.readProviderApiKey(id)
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.listImageModels,
    (_event, input: AIRouterImageProviderConfigInput) => imageService.listModels(input)
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.testImageConnection,
    (_event, request: AIRouterImageConnectionTestInput) => imageService.testConnection(request)
  )
  ipcMain.handle(AIROUTER_CHANNELS.listSpeechConfigs, () => speechService.listProviderConfigs())
  ipcMain.handle(
    AIROUTER_CHANNELS.saveSpeechConfig,
    (_event, input: AIRouterSpeechProviderConfigInput) => speechService.saveProviderConfig(input)
  )
  ipcMain.handle(AIROUTER_CHANNELS.deleteSpeechConfig, (_event, id: string) =>
    speechService.deleteProviderConfig(id)
  )
  ipcMain.handle(AIROUTER_CHANNELS.readSpeechApiKey, (_event, id: string) =>
    speechService.readProviderApiKey(id)
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.listSpeechPackages,
    (_event, providerType?: AIRouterSpeechProviderConfigInput['type']) =>
      speechService.listModelPackages(providerType)
  )
  ipcMain.handle(AIROUTER_CHANNELS.importSpeechPackage, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: '导入 TTS 模型包',
          filters: [{ name: 'TTS 模型包', extensions: ['zip'] }],
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({
          title: '导入 TTS 模型包',
          filters: [{ name: 'TTS 模型包', extensions: ['zip'] }],
          properties: ['openFile']
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return speechService.importModelPackage(result.filePaths[0])
  })
  ipcMain.handle(AIROUTER_CHANNELS.deleteSpeechPackage, (_event, id: string, version: string) =>
    speechService.deleteModelPackage(id, version)
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.listSpeechModels,
    (_event, input: AIRouterSpeechProviderConfigInput) => speechService.listModels(input)
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.listSpeechVoices,
    (_event, request: AIRouterSpeechVoiceListInput) => speechService.listVoices(request)
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.testSpeechConnection,
    (_event, request: AIRouterSpeechConnectionTestInput) => speechService.testConnection(request)
  )
  ipcMain.handle(AIROUTER_CHANNELS.probeQwenTtsCuda, () => qwenTtsSynthesizer.probeCuda())
  ipcMain.handle(AIROUTER_CHANNELS.listRecognitionConfigs, () =>
    recognitionService.listProviderConfigs()
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.saveRecognitionConfig,
    (_event, input: AIRouterSpeechRecognitionProviderConfigInput) =>
      recognitionService.saveProviderConfig(input)
  )
  ipcMain.handle(AIROUTER_CHANNELS.deleteRecognitionConfig, (_event, id: string) =>
    recognitionService.deleteProviderConfig(id)
  )
  ipcMain.handle(AIROUTER_CHANNELS.readRecognitionApiKey, (_event, id: string) =>
    recognitionService.readProviderApiKey(id)
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.listRecognitionPackages,
    (_event, providerType?: AIRouterSpeechRecognitionProviderConfigInput['type']) =>
      recognitionService.listModelPackages(providerType)
  )
  ipcMain.handle(AIROUTER_CHANNELS.importRecognitionPackage, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: OpenDialogOptions = {
      title: '导入 ASR 模型包',
      filters: [{ name: 'ASR 模型包', extensions: ['zip'] }],
      properties: ['openFile']
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return null
    return recognitionService.importModelPackage(result.filePaths[0])
  })
  ipcMain.handle(
    AIROUTER_CHANNELS.deleteRecognitionPackage,
    (_event, id: string, version: string) => recognitionService.deleteModelPackage(id, version)
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.listRecognitionProviderModels,
    (_event, input: AIRouterSpeechRecognitionProviderConfigInput) =>
      recognitionService.listProviderModels(input)
  )
  ipcMain.handle(AIROUTER_CHANNELS.listRecognitionModels, () => recognitionService.listModels())
  ipcMain.handle(AIROUTER_CHANNELS.listPronunciationModels, () => pronunciationService.listModels())
  ipcMain.handle(AIROUTER_CHANNELS.pronunciationExtensionStatus, () =>
    pronunciationService.getExtensionStatus()
  )
  ipcMain.handle(AIROUTER_CHANNELS.importPronunciationExtension, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '导入 AI 语音评测扩展包',
      filters: [{ name: 'AI 语音评测扩展包', extensions: ['zip'] }],
      properties: ['openFile'] as const
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return pronunciationService.importExtension(result.filePaths[0])
  })
  ipcMain.on(
    AIROUTER_CHANNELS.generateStart,
    (event, requestId: string, request: AIRouterTextRequest) => {
      const key = `${event.sender.id}:${requestId}`
      active.get(key)?.controller.abort()
      const controller = new AbortController()
      active.set(key, { sender: event.sender, controller })
      void streamToRenderer(service, event.sender, requestId, request, controller.signal).finally(
        () => {
          active.delete(key)
        }
      )
    }
  )
  ipcMain.on(AIROUTER_CHANNELS.generateAbort, (event, requestId: string) => {
    active.get(`${event.sender.id}:${requestId}`)?.controller.abort()
  })
  ipcMain.on(
    AIROUTER_CHANNELS.imageGenerateStart,
    (event, requestId: string, request: AIRouterImageRequest) => {
      const key = `${event.sender.id}:${requestId}`
      active.get(key)?.controller.abort()
      const controller = new AbortController()
      active.set(key, { sender: event.sender, controller })
      void imageToRenderer(
        imageService,
        event.sender,
        requestId,
        request,
        controller.signal
      ).finally(() => active.delete(key))
    }
  )
  ipcMain.on(AIROUTER_CHANNELS.imageGenerateAbort, (event, requestId: string) => {
    active.get(`${event.sender.id}:${requestId}`)?.controller.abort()
  })
  ipcMain.on(
    AIROUTER_CHANNELS.speechSynthesisStart,
    (event, requestId: string, request: AIRouterSpeechSynthesisRequest) => {
      const key = `${event.sender.id}:${requestId}`
      active.get(key)?.controller.abort()
      const controller = new AbortController()
      active.set(key, { sender: event.sender, controller })
      void speechToRenderer(
        speechService,
        event.sender,
        requestId,
        request,
        controller.signal
      ).finally(() => active.delete(key))
    }
  )
  ipcMain.on(AIROUTER_CHANNELS.speechSynthesisAbort, (event, requestId: string) => {
    active.get(`${event.sender.id}:${requestId}`)?.controller.abort()
  })
  ipcMain.on(
    AIROUTER_CHANNELS.speechRecognitionStart,
    (event, requestId: string, request: AIRouterSpeechRecognitionRequest) => {
      const key = `${event.sender.id}:${requestId}`
      active.get(key)?.controller.abort()
      const controller = new AbortController()
      active.set(key, { sender: event.sender, controller })
      void recognitionToRenderer(
        recognitionService,
        event.sender,
        requestId,
        request,
        controller.signal
      ).finally(() => active.delete(key))
    }
  )
  ipcMain.on(AIROUTER_CHANNELS.speechRecognitionAbort, (event, requestId: string) => {
    active.get(`${event.sender.id}:${requestId}`)?.controller.abort()
  })
  ipcMain.on(
    AIROUTER_CHANNELS.pronunciationAssessmentStart,
    (event, requestId: string, request: AIRouterPronunciationAssessmentRequest) => {
      const key = `${event.sender.id}:${requestId}`
      active.get(key)?.controller.abort()
      const controller = new AbortController()
      active.set(key, { sender: event.sender, controller })
      void pronunciationToRenderer(
        pronunciationService,
        event.sender,
        requestId,
        request,
        controller.signal
      ).finally(() => active.delete(key))
    }
  )
  ipcMain.on(AIROUTER_CHANNELS.pronunciationAssessmentAbort, (event, requestId: string) => {
    active.get(`${event.sender.id}:${requestId}`)?.controller.abort()
  })
}

async function pronunciationToRenderer(
  service: AIRouterPronunciationAssessmentService,
  sender: WebContents,
  requestId: string,
  request: AIRouterPronunciationAssessmentRequest,
  signal: AbortSignal
): Promise<void> {
  const send = (event: AIRouterPronunciationAssessmentEvent): void => {
    if (!sender.isDestroyed()) {
      sender.send(AIROUTER_CHANNELS.pronunciationAssessmentEvent, requestId, event)
    }
  }
  try {
    const result = await service.assess(request, { signal })
    if (!signal.aborted) send({ type: 'result', result })
  } catch (error) {
    if (!signal.aborted) send({ type: 'error', message: errorMessage(error) })
  }
}

async function recognitionToRenderer(
  service: AIRouterSpeechRecognitionService,
  sender: WebContents,
  requestId: string,
  request: AIRouterSpeechRecognitionRequest,
  signal: AbortSignal
): Promise<void> {
  const send = (event: AIRouterSpeechRecognitionEvent): void => {
    if (!sender.isDestroyed()) {
      sender.send(AIROUTER_CHANNELS.speechRecognitionEvent, requestId, event)
    }
  }
  try {
    const result = await service.recognize(request, { signal })
    if (!signal.aborted) send({ type: 'result', result })
  } catch (error) {
    if (!signal.aborted) send({ type: 'error', message: errorMessage(error) })
  }
}

async function imageToRenderer(
  service: AIRouterImageService,
  sender: WebContents,
  requestId: string,
  request: AIRouterImageRequest,
  signal: AbortSignal
): Promise<void> {
  const send = (event: AIRouterImageGenerationEvent): void => {
    if (!sender.isDestroyed()) sender.send(AIROUTER_CHANNELS.imageGenerateEvent, requestId, event)
  }
  try {
    const image = await service.generateImage(request, { signal })
    if (!signal.aborted) send({ type: 'result', image })
  } catch (error) {
    if (!signal.aborted) send({ type: 'error', message: errorMessage(error) })
  }
}

async function streamToRenderer(
  service: AIRouterService,
  sender: WebContents,
  requestId: string,
  request: AIRouterTextRequest,
  signal: AbortSignal
): Promise<void> {
  const send = (event: AIRouterStreamEvent): void => {
    if (!sender.isDestroyed()) sender.send(AIROUTER_CHANNELS.generateEvent, requestId, event)
  }
  try {
    for await (const chunk of service.generateText(request, { signal }))
      send({ type: 'chunk', chunk })
    send({ type: 'done' })
  } catch (error) {
    if (!signal.aborted) send({ type: 'error', message: errorMessage(error) })
    else send({ type: 'done' })
  }
}

async function speechToRenderer(
  service: AIRouterSpeechService,
  sender: WebContents,
  requestId: string,
  request: AIRouterSpeechSynthesisRequest,
  signal: AbortSignal
): Promise<void> {
  const startedAt = Date.now()
  const summary = summarizeSpeechRequest(request)
  console.info(`[AIRouter Speech ${requestId}] request received: ${summary}`)
  const send = (event: AIRouterSpeechSynthesisEvent): void => {
    if (sender.isDestroyed()) {
      console.warn(`[AIRouter Speech ${requestId}] renderer destroyed before ${event.type} event`)
      return
    }
    sender.send(AIROUTER_CHANNELS.speechSynthesisEvent, requestId, event)
    console.info(`[AIRouter Speech ${requestId}] ${event.type} event sent to renderer`)
  }
  try {
    const audio = await service.synthesizeSpeech(request, { signal })
    if (!signal.aborted) {
      console.info(
        `[AIRouter Speech ${requestId}] completed in ${Date.now() - startedAt}ms, bytes=${audio.data.byteLength}`
      )
      send({ type: 'result', audio })
    } else {
      console.warn(`[AIRouter Speech ${requestId}] completed after abort`)
    }
  } catch (error) {
    if (!signal.aborted) {
      console.error(
        `[AIRouter Speech ${requestId}] failed after ${Date.now() - startedAt}ms: ${errorMessage(error)}`
      )
      send({ type: 'error', message: errorMessage(error) })
    } else {
      console.warn(`[AIRouter Speech ${requestId}] aborted after ${Date.now() - startedAt}ms`)
    }
  }
}

function summarizeSpeechRequest(request: AIRouterSpeechSynthesisRequest): string {
  const text = request.text.replace(/\s+/g, ' ').trim()
  const summary = text.length > 80 ? `${text.slice(0, 77)}...` : text
  const roles = ['default', 'man', 'woman'].filter(
    (role) => request.routing?.[role as keyof typeof request.routing]
  )
  return `chars=${request.text.length}, roles=${roles.join(',')}, text="${summary}"`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'AI 引擎请求失败'
}
