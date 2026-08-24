import { type LogEvent, type LoggerBridge, type LogLevel } from '../shared'

export interface RendererLogger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, error?: unknown, context?: Record<string, unknown>): void
}

export const logger: RendererLogger = {
  debug: (message, context) => write('debug', message, context),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, error, context) => write('error', message, context, serializeError(error))
}

function write(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  error?: LogEvent['error']
): void {
  const event: LogEvent = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? { context } : {}),
    ...(error ? { error } : {})
  }
  const bridge = (window as Window & { logger?: LoggerBridge }).logger
  try {
    if (bridge) bridge.write(event)
    else if (level === 'error') console.error(`[${level}] ${message}`, error)
  } catch (bridgeError) {
    // Error reporting must not create another unhandled renderer exception.
    console.error('[logger] renderer bridge unavailable', bridgeError)
  }
}

function serializeError(error: unknown): LogEvent['error'] | undefined {
  if (error === undefined || error === null) return undefined
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    }
  }
  return { name: 'UnknownError', message: String(error) }
}

export type { LoggerBridge, LogEvent, LogLevel }
