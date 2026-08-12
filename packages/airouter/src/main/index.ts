import { app, ipcMain, type WebContents } from 'electron'
import { AIROUTER_CHANNELS } from '../shared'
import type {
  AIRouterConnectionTestInput,
  AIRouterImageConnectionTestInput,
  AIRouterImageGenerationEvent,
  AIRouterImageProviderConfigInput,
  AIRouterImageRequest,
  AIRouterProviderConfigInput,
  AIRouterSpeechConnectionTestInput,
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
import { PocketTtsSynthesizer } from './pocket-tts'

export { AIRouterService } from './service'
export { AIRouterImageService } from './image-service'
export { AIRouterSpeechService } from './speech-service'
export { AIRouterSpeechModelStore } from './speech-model-store'
export { PocketTtsSynthesizer } from './pocket-tts'
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
  const speechService = new AIRouterSpeechService({
    baseDir: options.baseDir,
    appVersion: app.getVersion(),
    configStorage: options.configStorage,
    secretStorage: options.secretStorage,
    localSynthesizers: { 'pocket-tts': new PocketTtsSynthesizer() }
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
  ipcMain.handle(AIROUTER_CHANNELS.importSpeechPackage, (_event, data: Uint8Array) => {
    if (!(data instanceof Uint8Array)) throw new TypeError('模型包必须是二进制数据')
    return speechService.importModelPackage(data)
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
