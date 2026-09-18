export const LOGGER_CHANNELS = {
  write: 'ls101:logger:write'
} as const

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface SerializedError {
  name: string
  message: string
  stack?: string
}

export interface LogEvent {
  level: LogLevel
  message: string
  timestamp?: string
  context?: Record<string, unknown>
  error?: SerializedError
}

export interface LoggerBridge {
  write(event: LogEvent): void
}
