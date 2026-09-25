import { vi } from 'vitest'
import type { LabHost } from '@ls101/lab-desktop-host'

export const serverId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
export const binding = {
  serverId,
  baseUrl: 'https://server.test/',
  fingerprint: 'sha256:abc',
  deviceId: 'device',
  contextId: 'context',
  generation: 1,
  maintenanceLocked: false,
  versionMismatch: false
}
export const connection = {
  connectionId: 'connection',
  epoch: 3,
  info: { serverId, releaseVersion: '1', capabilities: [] }
}
export const device = {
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
export const heartbeat = {
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

/**
 * The fake answers the capabilities a ready device uses; `current` decides whether the main process
 * reports a binding.
 */
export function fakeHost(current: () => typeof binding | null) {
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
