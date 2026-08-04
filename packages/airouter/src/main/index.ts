import { ipcMain, type WebContents } from 'electron'
import { AIROUTER_CHANNELS } from '../shared'
import type {
  AIRouterConnectionTestInput,
  AIRouterImageConnectionTestInput,
  AIRouterImageGenerationEvent,
  AIRouterImageGenerationSettings,
  AIRouterImageProviderConfigInput,
  AIRouterImageRequest,
  AIRouterProviderConfigInput,
  AIRouterStreamEvent,
  AIRouterTextRequest
} from '../shared'
import { AIRouterService, type AIRouterServiceOptions } from './service'
import { AIRouterImageService } from './image-service'

export { AIRouterService } from './service'
export { AIRouterImageService } from './image-service'
export type { AIRouterServiceOptions } from './service'

interface ActiveGeneration {
  sender: WebContents
  controller: AbortController
}

export function registerAIRouter(options: AIRouterServiceOptions): void {
  const service = new AIRouterService(options)
  const imageService = new AIRouterImageService(options)
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
  ipcMain.handle(AIROUTER_CHANNELS.getImageSettings, () => imageService.getGenerationSettings())
  ipcMain.handle(
    AIROUTER_CHANNELS.saveImageSettings,
    (_event, settings: AIRouterImageGenerationSettings) =>
      imageService.saveGenerationSettings(settings)
  )
  ipcMain.handle(
    AIROUTER_CHANNELS.testImageConnection,
    (_event, request: AIRouterImageConnectionTestInput) => imageService.testConnection(request)
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'AI 引擎请求失败'
}
