import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Schema } from '@ls101/lab-contracts'
import { LabService } from '../../../packages/lab-server/src/service'
import { createLabHttpServer, closeLabHttpServer } from '../../../packages/lab-server/src/http'
import type { BindingSummary } from '../../../packages/lab-desktop-host/src/shared'
import { BindingStore, machineDataRoot } from '../../../packages/lab-desktop-host/src/binding'
import { PinnedTransport } from '../../../packages/lab-desktop-host/src/transport'
import { LabClient } from '../../../packages/lab-client/src'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
interface Fixture {
  root: string
  mother: string
  binding: BindingStore
  summary: BindingSummary
  service: LabService
  transport: PinnedTransport
  teacher: LabClient
  target: { baseUrl: string; fingerprint: string; serverId: string }
  enrollment: Schema<'EnrollmentCreated'>
  enrollmentFile: string
}
async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'lab-imaging-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const service = await LabService.initialize(
    { root: join(root, 'server'), releaseVersion: 'test', isLicenseActive: () => true },
    { name: 'Lab', baseUrl: 'https://127.0.0.1:8443/', password: 'teacher' }
  )
  cleanups.push(() => service.db.close())
  const server = createLabHttpServer(service)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => closeLabHttpServer(server))
  const baseUrl = `https://127.0.0.1:${(server.address() as { port: number }).port}/`
  service.db.transaction(() => service.saveData({ ...service.data(), baseUrl }))
  const transport = new PinnedTransport(join(root, 'transfers'), 'test')
  const target = {
    baseUrl,
    fingerprint: service.identity.fingerprint,
    serverId: service.identity.serverId
  }
  const opened = await transport.open(target, 'teacher')
  await transport.authenticate(opened.connectionId, 'teacher')
  const teacher = new LabClient(opened.connectionId, transport)
  const enrollment = await teacher.request<Schema<'EnrollmentCreated'>>('postTeacherEnrollments', {
    body: { expectedModeRevision: 1 },
    idempotencyKey: randomUUID()
  })
  const archive = await teacher.request<{ handle: string }>('getTeacherEnrollmentsIdFile', {
    path: { id: enrollment.enrollment.id }
  })
  const enrollmentFile = await readFile(transport.file(archive.handle), 'utf8')
  const mother = join(root, 'mother')
  const binding = new BindingStore(mother, transport, 'LAB-001')
  const summary = await binding.enroll(enrollmentFile, target.fingerprint)
  return {
    root,
    mother,
    binding,
    summary,
    service,
    transport,
    teacher,
    target,
    enrollment,
    enrollmentFile
  }
}

it('copies only portable server settings; distinct hostnames receive distinct devices after enrollment closes', async () => {
  const f = await fixture()
  const raw = await readFile(join(f.mother, 'server-connection.json'), 'utf8')
  const configuration = JSON.parse(raw)
  expect(Object.keys(configuration.current).sort()).toEqual([
    'baseUrl',
    'connectionSecret',
    'fingerprint',
    'serverId'
  ])
  for (const field of [
    'deviceId',
    'installationId',
    'contextId',
    'generation',
    'encrypted:',
    'restricted:'
  ])
    expect(raw).not.toContain(field)
  expect(raw).not.toContain(f.summary.deviceId)
  await f.teacher.request('deleteTeacherEnrollmentsId', {
    path: { id: f.enrollment.enrollment.id }
  })
  await f.teacher.request('putTeacherServiceMode', {
    body: { mode: 'normal', expectedRevision: f.enrollment.modeRevision }
  })
  const clone = join(f.root, 'clone')
  await mkdir(clone)
  await copyFile(join(f.mother, 'server-connection.json'), join(clone, 'server-connection.json'))
  const second = await new BindingStore(clone, f.transport, 'LAB-002').summary()
  expect(second!.deviceId).not.toBe(f.summary.deviceId)
  expect(f.service.db.all('SELECT id FROM devices')).toHaveLength(2)
  expect(await readFile(join(clone, 'server-connection.json'), 'utf8')).toBe(raw)
  expect(machineDataRoot(clone, 'LAB-001')).not.toBe(machineDataRoot(clone, 'LAB-002'))
  expect(machineDataRoot(clone, 'LAB-001')).toBe(machineDataRoot(clone, 'lab-001'))
})

it('restores hostname configuration and allocates generations on the server, preserving the credential context', async () => {
  const f = await fixture()
  await f.teacher.request('patchTeacherDevicesId', {
    path: { id: f.summary.deviceId },
    body: { expectedRevision: 1, room: 'room-a', seat: '12', number: 'A12' }
  })
  const originalRuntime = await f.binding.runtime()
  const restored = new BindingStore(f.mother, f.transport, 'lab-001')
  const recovered = await restored.summary()
  expect(recovered).toMatchObject({
    deviceId: f.summary.deviceId,
    contextId: f.summary.contextId,
    generation: originalRuntime.runtimeGeneration + 1
  })
  const connected = await restored.connect()
  const state = await f.transport.request(connected.connectionId, 'getStudentState', {})
  expect((state.body as Schema<'StudentState'>).device).toMatchObject({
    number: 'A12',
    room: 'room-a',
    seat: '12'
  })
  expect((await restored.runtime()).runtimeGeneration).toBe(recovered!.generation)
  const original = await f.binding.connect()
  const stale = await f.transport.request(original.connectionId, 'postStudentHeartbeat', {
    body: {
      ...originalRuntime,
      activationState: 'active',
      phase: 'idle',
      currentPractice: null,
      submissionSummary: { waitingFirstUpload: 0, unconfirmed: 0, failed: 0 },
      lastError: null
    }
  })
  expect((stale.body as Schema<'HeartbeatResponse'>).heartbeatAccepted).toBe(false)
})

it('reset binding requires fresh enrollment while retaining hostname and seat configuration', async () => {
  const f = await fixture()
  await f.teacher.request('patchTeacherDevicesId', {
    path: { id: f.summary.deviceId },
    body: { expectedRevision: 1, seat: 'A1' }
  })
  await f.teacher.request('postTeacherDevicesIdResetBinding', {
    path: { id: f.summary.deviceId },
    idempotencyKey: randomUUID()
  })
  const restarted = new BindingStore(f.mother, f.transport, 'LAB-001')
  await expect(restarted.summary()).rejects.toThrow('TOKEN_REVOKED')
  const rebound = await restarted.enroll(f.enrollmentFile, f.target.fingerprint)
  expect(rebound.deviceId).toBe(f.summary.deviceId)
  expect(rebound.contextId).not.toBe(f.summary.contextId)
  expect(f.service.device(rebound.deviceId).seat).toBe('A1')
})

it('serializes concurrent hostname handshakes and rejects a superseded runtime even before its first heartbeat', async () => {
  const f = await fixture()
  const configuration = JSON.parse(await readFile(join(f.mother, 'server-connection.json'), 'utf8'))
  const opened = await f.transport.open(f.target, 'public')
  const runtimeId = randomUUID()
  const body = {
    connectionSecret: configuration.current.connectionSecret,
    computerName: 'CLONED-PC',
    platform: 'linux',
    runtimeId
  }
  const replies = await Promise.all(
    Array.from({ length: 3 }, () =>
      f.transport.request(opened.connectionId, 'postStudentSessions', { body })
    )
  )
  expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200])
  const first = replies[0].body as Schema<'StudentSession'>
  expect(replies.every((reply) => JSON.stringify(reply.body) === JSON.stringify(first))).toBe(true)
  const newer = await f.transport.request(opened.connectionId, 'postStudentSessions', {
    body: { ...body, runtimeId: randomUUID() }
  })
  expect((newer.body as Schema<'StudentSession'>).runtimeGeneration).toBe(
    first.runtimeGeneration + 1
  )
  const stale = await f.transport.request(opened.connectionId, 'postStudentSessions', { body })
  expect(stale.status).toBe(401)
  expect((stale.body as Schema<'Error'>).error.code).toBe('TOKEN_REVOKED')
  const rejected = await f.transport.request(opened.connectionId, 'postStudentSessions', {
    body: { ...body, computerName: 'unknown', connectionSecret: 'a'.repeat(43) }
  })
  expect(rejected.status).toBe(401)
  expect(f.service.db.all('SELECT id FROM devices')).toHaveLength(2)
})
