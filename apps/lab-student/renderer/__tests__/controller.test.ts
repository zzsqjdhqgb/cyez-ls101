import { describe, expect, it, vi } from 'vitest'
import type { LabHost } from '@ls101/lab-desktop-host'
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
