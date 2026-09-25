import type { Schema } from '@ls101/lab-contracts'

export type ErrorCode = Schema<'ErrorBody'>['code']

const statuses: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  AUTH_REQUIRED: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_REVOKED: 401,
  DEVICE_DISABLED: 403,
  LICENSE_INACTIVE: 403,
  ENROLLMENT_REJECTED: 403,
  NOT_FOUND: 404,
  SERVICE_MAINTENANCE: 409,
  VERSION_MISMATCH: 409,
  REVISION_CONFLICT: 409,
  CONTENT_CONFLICT: 409,
  RESOURCE_BUSY: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INVALID_EXAM: 422,
  INVALID_SUBMISSION: 422,
  RATE_LIMITED: 429,
  SERVICE_NOT_READY: 503,
  STORAGE_UNAVAILABLE: 503
}

export class LabError extends Error {
  readonly status: number
  constructor(
    readonly code: ErrorCode,
    readonly details?: Schema<'ErrorDetails'>,
    readonly retryAfter?: number
  ) {
    super(code)
    this.name = 'LabError'
    this.status = statuses[code]
  }
}

export function requireCondition(
  condition: unknown,
  code: ErrorCode,
  details?: Schema<'ErrorDetails'>
): asserts condition {
  if (!condition) throw new LabError(code, details)
}
