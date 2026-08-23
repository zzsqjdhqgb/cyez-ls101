import { appendFileSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { LogEvent, LogLevel } from '../shared/types'

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

export interface MainLoggerOptions {
  directory: string
  filename?: string
  minimumLevel?: LogLevel
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, error?: unknown, context?: Record<string, unknown>): void
  write(event: LogEvent): void
}

export class MainLogger implements Logger {
  private readonly filePath: string
  private readonly minimumLevel: LogLevel
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: MainLoggerOptions) {
    this.filePath = path.join(options.directory, options.filename ?? 'application.log')
    this.minimumLevel = options.minimumLevel ?? 'info'
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write({ level: 'debug', message, context })
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write({ level: 'info', message, context })
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write({ level: 'warn', message, context })
  }

  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.write({ level: 'error', message, error: serializeError(error), context })
  }

  errorSync(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const record = withTimestamp({
      level: 'error',
      message,
      error: serializeError(error),
      context
    })
    writeToConsole(record)
    try {
      appendFileSync(this.filePath, `${safeStringify(record)}\n`, 'utf8')
    } catch (writeError) {
      console.error('[logger] failed to synchronously write log file', writeError)
    }
  }

  write(event: LogEvent): void {
    if (LOG_LEVEL_WEIGHT[event.level] < LOG_LEVEL_WEIGHT[this.minimumLevel]) return

    const record = withTimestamp(event)
    const line = `${safeStringify(record)}\n`
    writeToConsole(record)
    this.writeQueue = this.writeQueue
      .then(() => appendFile(this.filePath, line, 'utf8'))
      .catch((writeError: unknown) => {
        // Logging must never become an unhandled rejection or take down the app.
        console.error('[logger] failed to write log file', writeError)
      })
  }
}

function withTimestamp(event: LogEvent): LogEvent {
  return { ...event, timestamp: event.timestamp ?? new Date().toISOString() }
}

export async function createMainLogger(options: MainLoggerOptions): Promise<MainLogger> {
  const logger = new MainLogger(options)
  await logger.initialize()
  return logger
}

export function serializeError(error: unknown): LogEvent['error'] | undefined {
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

function writeToConsole(event: LogEvent): void {
  const prefix = `[${event.level}] ${event.message}`
  const args = [
    prefix,
    ...(event.context ? [event.context] : []),
    ...(event.error ? [event.error] : [])
  ]
  if (event.level === 'debug') console.debug(...args)
  else if (event.level === 'info') console.info(...args)
  else if (event.level === 'warn') console.warn(...args)
  else console.error(...args)
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (typeof nestedValue !== 'object' || nestedValue === null) return nestedValue
      if (seen.has(nestedValue)) return '[Circular]'
      seen.add(nestedValue)
      return nestedValue
    })
  } catch (error) {
    return JSON.stringify({
      level: 'error',
      message: 'Logger could not serialize a log event',
      timestamp: new Date().toISOString(),
      error: serializeError(error)
    })
  }
}
