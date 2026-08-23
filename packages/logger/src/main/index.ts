import { ipcMain } from 'electron'
import { LOGGER_CHANNELS, type LogEvent } from '../shared'
import { createMainLogger, type Logger, type MainLogger, serializeError } from './logger'

export { createMainLogger, MainLogger, serializeError }
export type { Logger, MainLoggerOptions } from './logger'
export type { LogEvent, LogLevel, SerializedError } from '../shared'

export function registerRendererLogger(logger: Logger): void {
  ipcMain.on(LOGGER_CHANNELS.write, (ipcEvent, event: LogEvent) => {
    if (!isLogEvent(event)) {
      logger.warn('Rejected malformed renderer log event')
      return
    }
    logger.write({
      ...event,
      context: {
        ...event.context,
        process: 'renderer',
        webContentsId: ipcEvent.sender.id
      }
    })
  })
}

function isLogEvent(value: unknown): value is LogEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<LogEvent>
  return (
    (event.level === 'debug' ||
      event.level === 'info' ||
      event.level === 'warn' ||
      event.level === 'error') &&
    typeof event.message === 'string'
  )
}
