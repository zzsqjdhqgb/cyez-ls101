import type { ValidateFunction } from 'ajv'
import contract from './contract.generated.json'
import generatedValidators from './validators.generated'
import validatorNames from './validator-names.generated.json'
import type { components, operations } from './api.generated'

export type { components, operations, paths } from './api.generated'
export type Schema<Name extends keyof components['schemas']> = components['schemas'][Name]
export type OperationId = keyof operations
export type RequestBody<Id extends OperationId> = operations[Id] extends {
  requestBody: { content: { 'application/json': infer Body } }
}
  ? Body
  : never

export interface Parameter {
  name: string
  in: 'path' | 'query' | 'header'
  required?: boolean
  schema: Record<string, unknown>
}

interface Media {
  schema: Record<string, unknown>
}

export interface Operation {
  method: string
  route: string
  role: 'public' | 'teacher' | 'student'
  parameters: Parameter[]
  requestBody: { required?: boolean; content: Record<string, Media> } | null
  responses: Record<string, { content?: Record<string, Media>; headers?: Record<string, unknown> }>
}

export const operationDefinitions = contract.operations as unknown as Record<OperationId, Operation>
export const API_PREFIX = '/api/v1'
export const CONTROL_BYTES = 1024 * 1024
export const ENROLLMENT_BYTES = 64 * 1024
export const DEFAULT_LIMITS: Schema<'Limits'> = {
  maxExamArchiveBytes: 256 * 1024 * 1024,
  maxSubmissionArchiveBytes: 256 * 1024 * 1024,
  maxUncompressedBytes: 512 * 1024 * 1024,
  maxArchiveFiles: 10000
}

export class ContractError extends Error {
  constructor(readonly location: string) {
    super(`Invalid contract value: ${location}`)
    this.name = 'ContractError'
  }
}

function check(key: string, value: unknown): void {
  const name = (validatorNames as Record<string, string>)[key]
  const validate = (generatedValidators as Record<string, ValidateFunction>)[name]
  if (!validate || !validate(value)) throw new ContractError(key)
}

export function validateSchema<Name extends keyof components['schemas']>(
  name: Name,
  value: unknown
): asserts value is Schema<Name> {
  check(`schema:${name}`, value)
}

export function matchOperation(
  method: string,
  pathname: string
): {
  id: OperationId
  operation: Operation
  path: Record<string, string>
} | null {
  for (const [id, operation] of Object.entries(operationDefinitions)) {
    if (operation.method !== method) continue
    const template = `${API_PREFIX}${operation.route}`.split('/')
    const parts = pathname.split('/')
    if (parts.length !== template.length) continue
    const path: Record<string, string> = {}
    let matches = true
    for (let index = 0; index < parts.length; index++) {
      const segment = template[index]
      if (segment.startsWith('{')) {
        try {
          path[segment.slice(1, -1)] = decodeURIComponent(parts[index])
        } catch {
          throw new ContractError('path')
        }
      } else if (parts[index] !== segment) {
        matches = false
        break
      }
    }
    if (matches) return { id: id as OperationId, operation, path }
  }
  return null
}

export function validateParameters(
  id: OperationId,
  location: Parameter['in'],
  values: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...values }
  check(`${id}:${location}`, result)
  return result
}

export function validateRequest(
  id: OperationId,
  value: unknown,
  contentType = 'application/json'
): void {
  const body = operationDefinitions[id].requestBody
  if (!body) {
    if (value !== undefined) throw new ContractError(`${id}:unexpected-body`)
    return
  }
  const media = body.content[contentType]
  if (!media) throw new ContractError(`${id}:content-type`)
  if (media.schema.format === 'binary') return
  check(`${id}:request:${contentType}`, value)
}

export function validateResponse(id: OperationId, status: number, value: unknown): void {
  const responses = operationDefinitions[id].responses
  const response = responses[String(status)] ?? (status >= 400 ? responses.default : undefined)
  if (!response) throw new ContractError(`${id}:status`)
  const schema = response.content?.['application/json']?.schema
  if (schema) check(`${id}:response:${responses[String(status)] ? status : 'default'}`, value)
  else if (value !== undefined && !response.content)
    throw new ContractError(`${id}:unexpected-response`)
}
