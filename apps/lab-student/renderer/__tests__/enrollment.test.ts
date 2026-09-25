import { describe, expect, it, vi } from 'vitest'
import type { LabHost } from '@ls101/lab-desktop-host'
import { RemoteError } from '@ls101/lab-client'
import { StudentController } from '../controller'

const serverId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const binding = {
  serverId,
  baseUrl: 'https://server.test/',
  fingerprint: 'sha256:abc',
  deviceId: 'device',
  contextId: 'context',
  generation: 1,
  maintenanceLocked: false,
  versionMismatch: false
}
const connection = {
  connectionId: 'connection',
  epoch: 3,
  info: { serverId, releaseVersion: '1', capabilities: [] }
}
const device = {
  id: '9b2f5c1e-6a34-4d0b-8f21-7c5e0d9a1b23',
  number: '0001',
  room: 'A101',
  seat: '01',
  displayName: '学生机',
  enabled: true,
  revision: 1
}
// A response the contract accepts, so `poll` reaches `binding.observe` and reports the device as
// connected instead of tearing the connection down: that is what makes it observable to the
// assertions below.
const heartbeat = {
  status: 200,
  body: {
    serverId,
    serverTime: '2026-09-22T12:00:00.000Z',
    releaseVersion: '1',
    device,
    mode: 'normal',
    modeRevision: 1,
    availability: 'ready',
    allowedOperations: ['heartbeat', 'browse-exams'],
    heartbeatIntervalSeconds: 30,
    offlineAfterSeconds: 120,
    limits: {
      maxExamArchiveBytes: 1024,
      maxSubmissionArchiveBytes: 1024,
      maxUncompressedBytes: 1024,
      maxArchiveFiles: 8
    },
    heartbeatAccepted: true,
    taskIds: []
  }
}
const ENROLLMENT_FILE = 'header.payload.signature'
const FINGERPRINT = 'sha256:abc'

/**
 * The fake answers the capabilities a ready device uses; `current` decides whether the main process
 * reports a binding.
 */
function fakeHost(current: () => typeof binding | null): {
  host: LabHost
  invoke: ReturnType<typeof vi.fn>
} {
  const invoke = vi.fn(async (capability: string, input?: unknown): Promise<unknown> => {
    switch (capability) {
      case 'startup.status':
        return { version: '1', computerName: 'Student', initializationError: null }
      case 'startup.commands':
        return []
      case 'license.status':
        return { state: 'active' }
      case 'binding.summary':
        return current()
      case 'binding.connect':
        return connection
      case 'binding.runtime':
        return { runtimeId: serverId, runtimeGeneration: 1, sequence: 1 }
      case 'binding.observe':
        return current()
      case 'records.list':
        return []
      case 'transport.request':
        if ((input as { operationId?: string }).operationId === 'getStudentExams')
          return { status: 200, body: { items: [], nextCursor: null } }
        return heartbeat
      default:
        return null
    }
  })
  return { host: { invoke, onEvent: () => () => undefined } as unknown as LabHost, invoke }
}

function callsTo(invoke: ReturnType<typeof vi.fn>, capability: string): unknown[][] {
  return invoke.mock.calls.filter(([name]) => name === capability)
}

describe('student manual enrollment', () => {
  it('enrolls an unbound device through the host and shows the new binding', async () => {
    let enrolled = false
    const { host, invoke } = fakeHost(() => (enrolled ? binding : null))
    const controller = new StudentController(host)
    await controller.start()
    try {
      expect(controller.getSnapshot().binding).toBeNull()
      const enrolling = controller.enroll(ENROLLMENT_FILE, FINGERPRINT)
      // The host lives in the main process: it accepts the enrollment and reports the new binding
      // once it is saved, which the refresh that follows must pick up.
      await vi.waitFor(() => expect(callsTo(invoke, 'binding.enroll')).toHaveLength(1))
      expect(callsTo(invoke, 'binding.enroll')[0][1]).toEqual({
        file: ENROLLMENT_FILE,
        fingerprint: FINGERPRINT
      })
      enrolled = true
      await enrolling
      expect(controller.getSnapshot().binding).toEqual(binding)
    } finally {
      await controller.stop()
    }
  })

  it('drops the previous binding connection before refreshing', async () => {
    // A device whose binding was cleared out of band still holds the connection opened for it: the
    // manual enrollment form is exactly what the operator reaches for in that state.
    let bound = true
    const { host, invoke } = fakeHost(() => (bound ? binding : null))
    const controller = new StudentController(host)
    await controller.start()
    try {
      await vi.waitFor(() => expect(controller.getSnapshot().connected).toBe(true))
      bound = false
      await vi.waitFor(() => expect(controller.getSnapshot().binding).toBeNull())
      await controller.enroll(ENROLLMENT_FILE, FINGERPRINT)
      // The re-enrolled device belongs to a new context, so the connection opened for the old one
      // must not stay open — the startup command path closes it the same way.
      expect(invoke).toHaveBeenCalledWith('connections.close', connection.connectionId)
    } finally {
      await controller.stop()
    }
  })

  it('refuses to enroll a device that already has a binding', async () => {
    const { host, invoke } = fakeHost(() => binding)
    const controller = new StudentController(host)
    await controller.start()
    try {
      await expect(controller.enroll(ENROLLMENT_FILE, FINGERPRINT)).rejects.toThrow(
        '当前状态不允许入网'
      )
      expect(callsTo(invoke, 'binding.enroll')).toEqual([])
    } finally {
      await controller.stop()
    }
  })
})

it('resumes polling after an enrollment command replaces a revoked binding', async () => {
  const { host, invoke } = fakeHost(() => binding)
  const original = invoke.getMockImplementation() as (
    capability: string,
    input?: unknown
  ) => Promise<unknown>
  let enrolled = false
  let notify!: Parameters<LabHost['onEvent']>[0]
  host.onEvent = (listener) => {
    notify = listener
    return () => undefined
  }
  invoke.mockImplementation(async (capability: string, input?: unknown) => {
    if (capability === 'startup.commands') return enrolled ? [{ type: 'enroll' }] : []
    if (capability === 'transport.request' && !enrolled) throw new RemoteError('TOKEN_REVOKED', 401)
    return original(capability, input)
  })
  const controller = new StudentController(host)
  try {
    await controller.start()
    expect(controller.getSnapshot().connected).toBe(false)
    expect(controller.getSnapshot().error).toContain('TOKEN_REVOKED')
    enrolled = true
    notify({ type: 'startup-command', value: 'reenroll' })
    await vi.waitFor(() => expect(controller.getSnapshot().connected).toBe(true))
  } finally {
    await controller.stop()
  }
})
