import { describe, expect, it, vi } from 'vitest'
import type { LabHost } from '@ls101/lab-desktop-host'
import { RemoteError } from '@ls101/lab-client'
import { StudentController } from '../controller'

import { binding, connection, fakeHost } from './practice-fixture'

const ENROLLMENT_FILE = 'header.payload.signature'
const FINGERPRINT = 'sha256:abc'

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
