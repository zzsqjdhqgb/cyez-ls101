import type { LogEvent, SerializedError } from './types'

export const MAX_RENDERER_LOG_EVENT_BYTES = 64 * 1024
export const MAX_RENDERER_LOG_MESSAGE_LENGTH = 4 * 1024
export const MAX_RENDERER_LOG_STRING_LENGTH = 32 * 1024
export const MAX_RENDERER_LOG_DEPTH = 8
export const MAX_RENDERER_LOG_COLLECTION_SIZE = 100

export type RendererLogValidationFailure = 'malformed' | 'too-large' | 'too-deep'

export type RendererLogValidationResult =
  | { ok: true; event: LogEvent }
  | { ok: false; reason: RendererLogValidationFailure }

const invalid = Symbol('invalid-log-value')
const tooLarge = Symbol('log-value-too-large')
const tooDeep = Symbol('log-value-too-deep')
type InvalidValue = typeof invalid | typeof tooLarge | typeof tooDeep
const textEncoder = new TextEncoder()

interface ValidationBudget {
  bytes: number
  seen: WeakSet<object>
}

export function validateRendererLogEvent(value: unknown): RendererLogValidationResult {
  try {
    return validateRendererLogEventValue(value)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

function validateRendererLogEventValue(value: unknown): RendererLogValidationResult {
  if (!isRecord(value) || !isLogLevel(value.level)) return { ok: false, reason: 'malformed' }
  if (
    typeof value.message !== 'string' ||
    value.message.length === 0 ||
    value.message.length > MAX_RENDERER_LOG_MESSAGE_LENGTH
  ) {
    return { ok: false, reason: 'malformed' }
  }

  const budget: ValidationBudget = { bytes: 0, seen: new WeakSet() }
  const message = copyString(value.message, budget)
  if (isInvalid(message)) return failureFor(message)

  let context: Record<string, unknown> | undefined
  if (value.context !== undefined) {
    const copied = copyValue(value.context, 1, budget)
    if (isInvalid(copied)) return failureFor(copied)
    if (!isRecord(copied)) return { ok: false, reason: 'malformed' }
    context = copied
  }

  let error: SerializedError | undefined
  if (value.error !== undefined) {
    const copied = copyError(value.error, budget)
    if (isInvalid(copied)) return failureFor(copied)
    error = copied
  }

  const event: LogEvent = {
    level: value.level,
    message,
    ...(context ? { context } : {}),
    ...(error ? { error } : {})
  }
  if (textEncoder.encode(JSON.stringify(event)).byteLength > MAX_RENDERER_LOG_EVENT_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  return { ok: true, event }
}

function copyError(value: unknown, budget: ValidationBudget): SerializedError | InvalidValue {
  if (!isRecord(value)) return invalid
  const name = copyBoundedString(value.name, budget, 256)
  if (isInvalid(name)) return name
  const message = copyBoundedString(value.message, budget, MAX_RENDERER_LOG_STRING_LENGTH)
  if (isInvalid(message)) return message
  if (value.stack === undefined) return { name, message }
  const stack = copyBoundedString(value.stack, budget, MAX_RENDERER_LOG_STRING_LENGTH)
  if (isInvalid(stack)) return stack
  return { name, message, stack }
}

function copyValue(
  value: unknown,
  depth: number,
  budget: ValidationBudget
): unknown | InvalidValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : invalid
  if (typeof value === 'string')
    return copyBoundedString(value, budget, MAX_RENDERER_LOG_STRING_LENGTH)
  if (typeof value !== 'object') return invalid
  if (depth > MAX_RENDERER_LOG_DEPTH) return tooDeep
  if (budget.seen.has(value)) return invalid
  budget.seen.add(value)

  if (Array.isArray(value)) {
    if (value.length > MAX_RENDERER_LOG_COLLECTION_SIZE) return invalid
    const result: unknown[] = []
    for (const item of value) {
      const copied = copyValue(item, depth + 1, budget)
      if (isInvalid(copied)) return copied
      result.push(copied)
    }
    return result
  }

  if (!isRecord(value)) return invalid
  const entries = Object.entries(value)
  if (entries.length > MAX_RENDERER_LOG_COLLECTION_SIZE) return invalid
  const result: Record<string, unknown> = {}
  for (const [key, item] of entries) {
    if (item === undefined) continue
    const copiedKey = copyBoundedString(key, budget, 256)
    if (isInvalid(copiedKey)) return copiedKey
    const copied = copyValue(item, depth + 1, budget)
    if (isInvalid(copied)) return copied
    result[copiedKey] = copied
  }
  return result
}

function copyString(value: string, budget: ValidationBudget): string | typeof tooLarge {
  budget.bytes += textEncoder.encode(value).byteLength
  return budget.bytes > MAX_RENDERER_LOG_EVENT_BYTES ? tooLarge : value
}

function copyBoundedString(
  value: unknown,
  budget: ValidationBudget,
  maximumLength: number
): string | InvalidValue {
  if (typeof value !== 'string' || value.length > maximumLength) return invalid
  return copyString(value, budget)
}

function failureFor(value: InvalidValue): RendererLogValidationResult {
  if (value === tooLarge) return { ok: false, reason: 'too-large' }
  if (value === tooDeep) return { ok: false, reason: 'too-deep' }
  return { ok: false, reason: 'malformed' }
}

function isInvalid(value: unknown): value is InvalidValue {
  return value === invalid || value === tooLarge || value === tooDeep
}

function isLogLevel(value: unknown): value is LogEvent['level'] {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === null || Object.getPrototypeOf(prototype) === null
}
