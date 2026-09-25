import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { operationDefinitions } from '@ls101/lab-contracts'
import { enroll, error, fixture, login, type Fixture } from './support'

// The contract enumerates routes, but does not supply the expected authorization result. The
// product rule is independent: /teacher/* is teacher-only except login, /student/* student-only.
const publicOperations = [
  'getInfo',
  'postTeacherSessions',
  'postEnrollmentConnections',
  'postStudentSessions'
]
const protectedRoutes = Object.entries(operationDefinitions).filter(
  ([id]) => !publicOperations.includes(id)
)
let f: Fixture, teacher: string, student: string
beforeAll(async () => {
  f = await fixture()
  teacher = await login(f.endpoint)
  student = (await enroll(f.endpoint, teacher, 1))[0].token
})
afterAll(async () => {
  await f?.close()
})

describe('AUTH-ALL: every protected HTTP operation enforces its role', () => {
  it.each(protectedRoutes)(
    '%s rejects anonymous and opposite-role callers',
    async (_id, operation) => {
      const teacherOnly = operation.route.startsWith('/teacher/')
      expect(teacherOnly || operation.route.startsWith('/student/')).toBe(true)
      expect(operation.role).toBe(teacherOnly ? 'teacher' : 'student')
      const path = operation.route.replace(/\{[^}]+\}/g, () => randomUUID())
      const headers = {
        'idempotency-key': randomUUID(),
        'x-ls101-archive-sha256': '0'.repeat(64),
        'x-ls101-task-lease': randomUUID()
      }
      error(await f.api(operation.method, path, { headers }), 401, 'AUTH_REQUIRED')
      error(
        await f.api(operation.method, path, { headers, token: teacherOnly ? student : teacher }),
        401,
        'AUTH_REQUIRED'
      )
    }
  )
})
