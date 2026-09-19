import { describe, expect, it } from 'vitest'
import {
  matchOperation,
  operationDefinitions,
  validateParameters,
  validateRequest,
  validateResponse,
  validateSchema
} from '../index'

describe('generated lab contract', () => {
  it('matches every documented operation and validates its required path', () => {
    expect(Object.keys(operationDefinitions)).toHaveLength(61)
    for (const [id, operation] of Object.entries(operationDefinitions)) {
      const url = `/api/v1${operation.route.replace(/\{[^}]+\}/g, '11111111-1111-4111-8111-111111111111')}`
      const match = matchOperation(operation.method, url)
      expect(match?.id).toBe(id)
      expect(() => validateParameters(match!.id, 'path', match!.path)).not.toThrow()
    }
    expect(matchOperation('GET', '/api/v1/unknown')).toBeNull()
  })

  it('rejects malformed bodies, secret extensions, and wrong error classes', () => {
    expect(() =>
      validateRequest('putTeacherServiceMode', { mode: 'normal', expectedRevision: 1 })
    ).not.toThrow()
    expect(() =>
      validateRequest('putTeacherServiceMode', { mode: 'normal', expectedRevision: '1' })
    ).toThrow()
    expect(() =>
      validateRequest('putTeacherServiceMode', {
        mode: 'normal',
        expectedRevision: 1,
        script: 'anything'
      })
    ).toThrow()
    expect(() =>
      validateResponse('postTeacherBackups', 409, {
        error: { code: 'SERVICE_NOT_READY', message: 'wait', requestId: 'trace' }
      })
    ).toThrow()
    expect(() =>
      validateResponse('postTeacherBackups', 503, {
        error: { code: 'SERVICE_NOT_READY', message: 'wait', requestId: 'trace' }
      })
    ).not.toThrow()
  })

  it('coerces transport query values without permitting unknown query fields', () => {
    expect(validateParameters('getTeacherDevices', 'query', { limit: '20' })).toEqual({ limit: 20 })
    expect(() => validateParameters('getTeacherDevices', 'query', { limit: '201' })).toThrow()
    expect(() => validateParameters('getTeacherDevices', 'query', { password: 'secret' })).toThrow()
    expect(() => validateSchema('PositiveInteger', Number.MAX_SAFE_INTEGER + 1)).toThrow()
    expect(() => validateSchema('Blocker', { kind: 'backup-ready', resourceId: 'bad' })).toThrow()
  })
})
