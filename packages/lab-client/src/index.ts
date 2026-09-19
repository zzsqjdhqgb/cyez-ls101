import {
  operationDefinitions,
  validateParameters,
  validateRequest,
  validateResponse,
  type OperationId,
  type Schema
} from '@ls101/lab-contracts'

export interface OperationInput {
  path?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  idempotencyKey?: string
  taskLease?: string
  archive?: { handle: string; sha256: string; bytes: number }
}
export interface TransportResponse {
  status: number
  body?: unknown
  retryAfter?: number
  archive?: { handle: string; sha256: string; bytes: number }
}
export interface LabTransport {
  request(
    connectionId: string,
    id: OperationId,
    input: OperationInput,
    signal?: AbortSignal
  ): Promise<TransportResponse>
}

export class RemoteError extends Error {
  constructor(
    readonly code: Schema<'ErrorBody'>['code'],
    readonly status: number,
    readonly details?: Schema<'ErrorDetails'>,
    readonly retryAfter?: number
  ) {
    super(code)
    this.name = 'RemoteError'
  }
}

export class LabClient {
  constructor(
    readonly connectionId: string,
    private readonly transport: LabTransport
  ) {}

  async request<T = unknown>(
    id: OperationId,
    input: OperationInput = {},
    signal?: AbortSignal
  ): Promise<T> {
    if (!Object.hasOwn(operationDefinitions, id)) throw new Error('Unknown lab operation')
    validateParameters(id, 'path', input.path ?? {})
    const query = Object.fromEntries(
      Object.entries(input.query ?? {}).filter(([, value]) => value !== undefined)
    )
    validateParameters(id, 'query', query)
    if (!input.archive) validateRequest(id, input.body)
    const response = await this.transport.request(
      this.connectionId,
      id,
      { ...input, query },
      signal
    )
    if (response.status >= 400) {
      validateResponse(id, response.status, response.body)
      const error = (response.body as Schema<'Error'>).error
      throw new RemoteError(error.code, response.status, error.details, response.retryAfter)
    }
    if (response.archive) return response.archive as T
    validateResponse(id, response.status, response.body)
    return response.body as T
  }
}
