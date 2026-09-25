import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { request } from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'
import { expect } from 'vitest'
import { encodeExamPackage, encodeSubmissionPackage } from '@ls101/exam-package'
import type { ExamPackage, SubmissionPackage } from '@ls101/core-types'
import { LabService } from '../../service'
import { createLabHttpServer, closeLabHttpServer } from '../../http'

export const VERSION = 'integration-test'
export const PASSWORD = 'integration-teacher-password'
export async function recordFailure(root: string, name: string): Promise<void> {
  // Persist only paths and sizes. Never export the DB, credentials, license receipt or plaintext
  // archive/password buffers as CI diagnostics.
  const files: Array<{ path: string; bytes?: number; error?: string }> = []
  const parent = dirname(root)
  const visit = async (relative: string): Promise<void> => {
    try {
      for (const entry of await readdir(join(parent, relative), { withFileTypes: true })) {
        const path = join(relative, entry.name)
        if (entry.isDirectory()) await visit(path)
        else if (entry.isFile()) files.push({ path, bytes: (await stat(join(parent, path))).size })
      }
    } catch (error) {
      files.push({ path: relative, error: (error as NodeJS.ErrnoException).code })
    }
  }
  await visit('')
  const output = resolve(import.meta.dirname, '../../../../../test-results/lab-server')
  try {
    await mkdir(output, { recursive: true })
    await writeFile(
      join(output, `${randomUUID()}.json`),
      JSON.stringify({ name, node: process.version, platform: process.platform, files }, null, 2)
    )
  } catch (error) {
    // Diagnostics must never mask the assertion failure or prevent fixture cleanup.
    console.warn('Could not write lab test diagnostics:', (error as NodeJS.ErrnoException).code)
  }
}
export const digest = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')
export interface Endpoint {
  port: number
  certificate: string
}
export interface Reply {
  status: number
  body: any
  bytes: Buffer
  headers: IncomingHttpHeaders
}
export interface Input {
  token?: string
  body?: unknown
  bytes?: Uint8Array
  headers?: Record<string, string>
}

// Raw HTTPS deliberately avoids the product client's validation and retries. Malformed requests
// must reach the service, and an incorrect server answer must not be hidden by a shared client.
export function beginRequest(endpoint: Endpoint, method: string, path: string, input: Input = {}) {
  const bytes =
    input.bytes ?? (input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body)))
  let call!: ReturnType<typeof request>
  const response = new Promise<Reply>((resolve, reject) => {
    call = request(
      {
        host: '127.0.0.1',
        port: endpoint.port,
        path: `/api/v1${path}`,
        method,
        ca: endpoint.certificate,
        checkServerIdentity: () => undefined,
        agent: false,
        headers: {
          'x-ls101-client-version': VERSION,
          ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
          ...(bytes ? { 'content-length': String(bytes.length) } : {}),
          ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...input.headers
        }
      },
      (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('error', reject)
        incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        incoming.on('end', () => {
          const bytes = Buffer.concat(chunks)
          let body: unknown = bytes.toString('utf8')
          if (incoming.headers['content-type']?.includes('application/json')) {
            try {
              body = JSON.parse(String(body))
            } catch (error) {
              reject(error)
              return
            }
          }
          resolve({ status: incoming.statusCode!, body, bytes, headers: incoming.headers })
        })
      }
    )
    call.setTimeout(12000, () => call.destroy(new Error(`HTTPS timeout: ${method} ${path}`)))
    call.on('error', reject)
  })
  return { call, response, bytes }
}

export function api(
  endpoint: Endpoint,
  method: string,
  path: string,
  input: Input = {}
): Promise<Reply> {
  const pending = beginRequest(endpoint, method, path, input)
  pending.call.end(pending.bytes)
  return pending.response
}

export function error(reply: Reply, status: number, code: string): void {
  expect(reply.status, JSON.stringify(reply.body)).toBe(status)
  expect(reply.body).toMatchObject({ error: { code, requestId: expect.any(String) } })
}

export function archiveInput(token: string, bytes: Uint8Array, kind = 'submission'): Input {
  return {
    token,
    bytes,
    headers: {
      'content-type': `application/x-ls101-${kind}`,
      'x-ls101-archive-sha256': digest(bytes)
    }
  }
}

export function barrier() {
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const continued = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    entered,
    release,
    wait: async () => {
      enter()
      await continued
    }
  }
}

export async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'ls101-integration-'))
  const root = join(parent, 'data')
  let now = Date.now(),
    licensed = true
  const options = { root, releaseVersion: VERSION, isLicenseActive: () => licensed, now: () => now }
  let service = await LabService.initialize(options, {
    name: 'Integration lab',
    baseUrl: 'https://127.0.0.1:8443/',
    password: PASSWORD
  })
  let server = createLabHttpServer(service)
  const endpoint = { port: 0, certificate: service.identity.certificate }
  const listen = async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    endpoint.port = (server.address() as { port: number }).port
  }
  await listen()
  const releases: Array<() => void> = []
  return {
    root,
    endpoint,
    get service() {
      return service
    },
    get now() {
      return now
    },
    advance(ms: number) {
      now += ms
    },
    license(active: boolean) {
      licensed = active
    },
    api: (method: string, path: string, input?: Input) => api(endpoint, method, path, input),
    pause(point: string) {
      const gate = barrier()
      releases.push(gate.release)
      service.options.fault = async (at) => {
        if (at === point) {
          service.options.fault = undefined
          await gate.wait()
        }
      }
      return gate
    },
    async restart() {
      for (const release of releases) release()
      await closeLabHttpServer(server)
      await service.backups.wait()
      service.db.close()
      service = await LabService.open(options)
      server = createLabHttpServer(service)
      await listen()
    },
    async close() {
      for (const release of releases) release()
      await closeLabHttpServer(server)
      await service.backups.wait()
      service.db.close()
      await rm(parent, { recursive: true, force: true })
    }
  }
}
export type Fixture = Awaited<ReturnType<typeof fixture>>

export async function login(endpoint: Endpoint, password = PASSWORD): Promise<string> {
  const result = await api(endpoint, 'POST', '/teacher/sessions', { body: { password } })
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return result.body.token
}

export async function mode(endpoint: Endpoint, token: string, value: 'normal' | 'maintenance') {
  const current = await api(endpoint, 'GET', '/teacher/service', { token })
  expect(current.status).toBe(200)
  const reply = await api(endpoint, 'PUT', '/teacher/service/mode', {
    token,
    body: { mode: value, expectedRevision: current.body.modeRevision }
  })
  expect(reply.status, JSON.stringify(reply.body)).toBe(200)
  return reply.body
}

export async function enroll(endpoint: Endpoint, teacher: string, count = 2) {
  const current = await api(endpoint, 'GET', '/teacher/service', { token: teacher })
  const batch = await api(endpoint, 'POST', '/teacher/enrollments', {
    token: teacher,
    body: { expectedModeRevision: current.body.modeRevision },
    headers: { 'idempotency-key': randomUUID() }
  })
  expect(batch.status, JSON.stringify(batch.body)).toBe(201)
  const file = await api(endpoint, 'GET', `/teacher/enrollments/${batch.body.enrollment.id}/file`, {
    token: teacher
  })
  const devices: Array<{
    id: string
    token: string
    runtimeId: string
    connectionSecret: string
    computerName: string
  }> = []
  const connection = await api(endpoint, 'POST', '/enrollment/connections', {
    body: { enrollmentFile: file.body, computerName: 'mother-pc', releaseVersion: VERSION }
  })
  expect(connection.status).toBe(200)
  for (let i = 0; i < count; i++) {
    const runtimeId = randomUUID(),
      computerName = `pc-${randomUUID()}`
    const reply = await api(endpoint, 'POST', '/student/sessions', {
      body: {
        connectionSecret: connection.body.connectionSecret,
        computerName,
        platform: 'linux',
        runtimeId
      }
    })
    expect(reply.status, JSON.stringify(reply.body)).toBe(200)
    devices.push({
      id: reply.body.deviceId,
      token: `d.${reply.body.deviceId}.${reply.body.deviceSecret}`,
      runtimeId,
      computerName,
      connectionSecret: connection.body.connectionSecret
    })
  }
  expect(
    (
      await api(endpoint, 'DELETE', `/teacher/enrollments/${batch.body.enrollment.id}`, {
        token: teacher
      })
    ).status
  ).toBe(204)
  return devices
}

export async function examArchive(packageId = randomUUID(), title = 'Integration exam') {
  const exam: ExamPackage = {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId,
    examData: {
      title,
      player: {
        pages: [{ id: 'one', content: [], timeline: [{ type: 'countdown', seconds: 1 }] }],
        recordingIndices: []
      },
      resources: {}
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: packageId, examTitle: title },
      schemaUses: [],
      resources: {}
    }
  }
  return { exam, bytes: await encodeExamPackage(exam, {}) }
}

export async function practice(endpoint: Endpoint, teacher: string, student: string) {
  const archive = await examArchive()
  const imported = await api(
    endpoint,
    'POST',
    '/teacher/exams',
    archiveInput(teacher, archive.bytes, 'exam')
  )
  expect(imported.status, JSON.stringify(imported.body)).toBe(201)
  await mode(endpoint, teacher, 'normal')
  const id = randomUUID(),
    candidate = { candidateId: '001', displayName: 'Student' }
  const body = { examId: imported.body.examId, archiveSha256: digest(archive.bytes), candidate }
  const grant = await api(endpoint, 'PUT', `/student/practices/${id}`, { token: student, body })
  expect(grant.status, JSON.stringify(grant.body)).toBe(201)
  const submission: SubmissionPackage = {
    ...archive.exam.submissionTemplate,
    meta: {
      ...archive.exam.submissionTemplate.meta,
      submissionId: id,
      candidate,
      startedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString()
    },
    answers: { strings: [], audios: [] }
  }
  const bytes = await encodeSubmissionPackage(submission, {})
  return {
    id,
    bytes,
    submission,
    exam: imported.body,
    examBytes: archive.bytes,
    grant: grant.body,
    grantInput: body,
    upload: () => api(endpoint, 'PUT', `/student/submissions/${id}`, archiveInput(student, bytes)),
    receipt: () => api(endpoint, 'GET', `/student/submissions/${id}/receipt`, { token: student })
  }
}

export const heartbeat = (runtimeId: string = randomUUID(), generation = 1, sequence = 1) => ({
  runtimeId,
  runtimeGeneration: generation,
  sequence,
  activationState: 'active',
  phase: 'maintenance-idle',
  currentPractice: null,
  submissionSummary: { waitingFirstUpload: 0, unconfirmed: 0, failed: 0 },
  lastError: null
})
