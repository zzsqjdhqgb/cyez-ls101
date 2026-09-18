import { ipcMain } from 'electron'
import { LOGGER_CHANNELS } from '../shared'
import {
  ConsoleLogger,
  DEFAULT_MAX_LOG_FILE_BYTES,
  DEFAULT_MAX_LOG_FILES,
  createConsoleLogger,
  createMainLogger,
  MainLogger,
  type Logger,
  serializeError
} from './logger'
import { RendererLogGate } from './renderer-log-gate'

export {
  ConsoleLogger,
  DEFAULT_MAX_LOG_FILE_BYTES,
  DEFAULT_MAX_LOG_FILES,
  createConsoleLogger,
  createMainLogger,
  MainLogger,
  RendererLogGate,
  serializeError
}
export type { Logger, MainLoggerOptions } from './logger'
export {
  MAX_RENDERER_LOG_COLLECTION_SIZE,
  MAX_RENDERER_LOG_DEPTH,
  MAX_RENDERER_LOG_EVENT_BYTES,
  MAX_RENDERER_LOG_MESSAGE_LENGTH,
  MAX_RENDERER_LOG_STRING_LENGTH,
  validateRendererLogEvent
} from '../shared'
export type { LogEvent, LogLevel, SerializedError } from '../shared'

export function registerRendererLogger(logger: Logger): void {
  const gate = new RendererLogGate()
  const trackedSenders = new Set<number>()
  ipcMain.on(LOGGER_CHANNELS.write, (ipcEvent, event: unknown) => {
    const webContentsId = ipcEvent.sender.id
    if (!trackedSenders.has(webContentsId)) {
      trackedSenders.add(webContentsId)
      ipcEvent.sender.once('destroyed', () => {
        trackedSenders.delete(webContentsId)
        gate.delete(webContentsId)
      })
    }

    const result = gate.accept(webContentsId, event)
    if (!result.accepted) {
      if (result.report) {
        logger.warn('Rejected renderer log event', {
          process: 'renderer',
          webContentsId,
          reason: result.reason
        })
      }
      return
    }
    logger.write({
      ...result.event,
      context: {
        ...result.event.context,
        process: 'renderer',
        webContentsId
      }
    })
  })
}
