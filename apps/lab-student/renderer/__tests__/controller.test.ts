import { describe, expect, it, vi } from 'vitest'
import type { LabHost } from '@ls101/lab-desktop-host'
import { admission, canViewRecords } from '../admission'
import { StudentController } from '../controller'

describe('student startup command scheduling', () => {
  it('drains commands arriving during a pending rebind', async () => {
    let notify!: (event: { type: string; value: unknown }) => void
    let complete!: (value: unknown[]) => void
    const pending = new Promise<unknown[]>((resolve) => {
      complete = resolve
    })
    let drains = 0
    const invoke = vi.fn(async (capability: string) => {
      if (capability === 'startup.status')
        return { version: '1', computerName: 'Student', initializationError: null }
      if (capability === 'startup.commands') {
        drains++
        return drains === 1 ? pending : []
      }
      if (capability === 'license.status') return { state: 'inactive' }
      if (capability === 'records.list') return []
      return null
    })
    const controller = new StudentController({
      invoke,
      onEvent: (listener) => {
        notify = listener
        return () => undefined
      }
    } as LabHost)
    try {
      const started = controller.start()
      await vi.waitFor(() => expect(drains).toBe(1))
      notify({ type: 'startup-command', value: null })
      complete([])
      await started
      expect(drains).toBe(2)
    } finally {
      await controller.stop()
    }
  })
})

it('shows a configured but unreachable server as offline before obtaining a device identity', async () => {
  const controller = new StudentController({
    invoke: vi.fn(async (capability: string) => {
      if (capability === 'startup.status')
        return { version: '1', computerName: 'LAB-001', initializationError: null }
      if (capability === 'startup.commands') return []
      if (capability === 'license.status') return { state: 'active' }
      if (capability === 'binding.configured') return true
      if (capability === 'binding.summary') throw new Error('Service unreachable')
      return null
    }),
    onEvent: () => () => undefined
  } as LabHost)
  try {
    await controller.start()
    expect(admission(controller.getSnapshot())).toBe('offline')
    expect(canViewRecords(controller.getSnapshot())).toBe(false)
  } finally {
    await controller.stop()
  }
})
