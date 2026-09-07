import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@ls101/lab-client'
import type { Schema } from '@ls101/lab-contracts'
import type { TaskJournal } from '@ls101/lab-desktop-host'
import { MaintenanceQueue, type MaintenancePorts } from '../maintenance-queue'

afterEach(() => vi.useRealTimers())
function fixture() {
  const contextId = crypto.randomUUID(),
    runtimeId = crypto.randomUUID()
  const task: Schema<'Task'> = {
    id: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    status: 'pending',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    revision: 1,
    parameters: {
      type: 'history-cleanup',
      phase: 'execute',
      planId: crypto.randomUUID(),
      submittedBefore: new Date().toISOString(),
      selectionDigest: 'a'.repeat(64)
    }
  }
  const lease: Schema<'TaskLease'> = {
    taskId: task.id,
    runtimeId,
    leaseId: crypto.randomUUID(),
    serverTime: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
    cancelRequested: false,
    parameters: task.parameters
  }
  const journals: TaskJournal[] = [],
    calls: string[] = []
  let deleted = 0
  const invoke = vi.fn(async (capability: string, input: unknown) => {
    calls.push(capability)
    if (capability === 'tasks.listJournals') return structuredClone(journals)
    if (capability === 'tasks.saveJournal') {
      journals[0] = structuredClone(input as TaskJournal)
      return
    }
    if (capability === 'cleanup.snapshot') return { selection: [{}, {}] }
    if (capability === 'cleanup.item') {
      deleted++
      return
    }
    if (capability === 'tasks.cleanupResult')
      return {
        kind: 'history-execute',
        selectedCount: 2,
        deletedCount: deleted,
        alreadyAbsentCount: 0,
        failedCount: 0,
        skippedCount: 2 - deleted,
        deletedBytes: deleted * 100,
        errors: []
      }
    throw new Error(capability)
  })
  const request = vi.fn(async (operation: string) => {
    calls.push(operation)
    if (operation === 'getStudentTasks') return { items: [task], nextCursor: null }
    if (operation === 'postStudentTasksIdClaim' || operation === 'putStudentTasksIdLease')
      return lease
    if (operation === 'putStudentTasksIdResult') {
      expect(journals[0].result).not.toBeNull()
      return {
        taskId: task.id,
        leaseId: lease.leaseId,
        late: false,
        receivedAt: new Date().toISOString()
      }
    }
    throw new Error(operation)
  })
  const ports: MaintenancePorts = {
    host: { invoke: invoke as MaintenancePorts['host']['invoke'], onEvent: () => () => undefined },
    request: request as MaintenancePorts['request'],
    admitted: () => true,
    busy: vi.fn(async () => undefined),
    changed: vi.fn()
  }
  const queue = new MaintenanceQueue(ports, Date.now)
  return { contextId, runtimeId, task, lease, journals, calls, ports, invoke, request, queue }
}

it('persists intent before claiming and result before reporting', async () => {
  const f = fixture()
  await f.queue.pump(f.contextId, f.runtimeId)
  expect(f.calls.indexOf('tasks.saveJournal')).toBeLessThan(
    f.calls.indexOf('postStudentTasksIdClaim')
  )
  expect(f.journals[0]).toMatchObject({
    reported: true,
    selectedCount: 2,
    result: { status: 'succeeded', result: { deletedCount: 2 } }
  })
  const count = f.calls.filter((value) => value === 'cleanup.item').length
  await f.queue.pump(f.contextId, f.runtimeId)
  expect(f.calls.filter((value) => value === 'cleanup.item')).toHaveLength(count)
})

it.each([
  new RemoteError(
    'RESOURCE_BUSY',
    409,
    { blockers: [{ kind: 'backup-pending', resourceId: crypto.randomUUID() }] },
    10
  ),
  new RemoteError('SERVICE_NOT_READY', 503, undefined, 10)
])('claim rejection starts no deletion and respects retry delay: %s', async (error) => {
  vi.useFakeTimers()
  const f = fixture(),
    original = f.request.getMockImplementation()!
  f.request.mockImplementation(async (operation) => {
    if (operation === 'postStudentTasksIdClaim') throw error
    return original(operation)
  })
  await f.queue.pump(f.contextId, f.runtimeId)
  await f.queue.pump(f.contextId, f.runtimeId)
  expect(f.calls).not.toContain('cleanup.item')
  expect(f.ports.busy).not.toHaveBeenCalled()
  expect(
    f.request.mock.calls.filter(([operation]) => operation === 'postStudentTasksIdClaim')
  ).toHaveLength(1)
})

it('renewal failure stops before the next deletion and never resumes that lease', async () => {
  vi.useFakeTimers()
  const f = fixture(),
    request = f.request.getMockImplementation()!,
    invoke = f.invoke.getMockImplementation()!
  let release: (() => void) | undefined
  f.invoke.mockImplementation(async (capability, input) => {
    if (capability === 'cleanup.item') {
      await invoke(capability, input)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return
    }
    return invoke(capability, input)
  })
  f.request.mockImplementation(async (operation) => {
    if (operation === 'putStudentTasksIdLease') throw new RemoteError('SERVICE_NOT_READY', 503)
    return request(operation)
  })
  const running = f.queue.pump(f.contextId, f.runtimeId)
  await vi.advanceTimersByTimeAsync(5100)
  expect(release).toBeDefined()
  release!()
  await running
  expect(f.calls.filter((value) => value === 'cleanup.item')).toHaveLength(1)
  expect(f.journals[0]).toMatchObject({
    reported: true,
    result: { status: 'cancelled', result: { deletedCount: 1, skippedCount: 1 } }
  })
  await f.queue.pump(f.contextId, f.runtimeId)
  expect(f.calls.filter((value) => value === 'cleanup.item')).toHaveLength(1)
})

it('lost report retries immutable content without rerunning deletion', async () => {
  vi.useFakeTimers()
  const f = fixture(),
    original = f.request.getMockImplementation()!
  let rejected = false
  f.request.mockImplementation(async (operation) => {
    if (operation === 'putStudentTasksIdResult' && !rejected) {
      rejected = true
      throw new RemoteError('SERVICE_NOT_READY', 503)
    }
    return original(operation)
  })
  await f.queue.pump(f.contextId, f.runtimeId)
  const result = structuredClone(f.journals[0].result)
  expect(f.journals[0].reported).toBe(false)
  await vi.advanceTimersByTimeAsync(2000)
  await f.queue.pump(f.contextId, f.runtimeId)
  expect(f.journals[0]).toMatchObject({ reported: true, result })
  expect(f.calls.filter((value) => value === 'cleanup.item')).toHaveLength(2)
})

it('restart reports interrupted work with the old lease and executes nothing', async () => {
  const f = fixture()
  f.journals.push({
    schemaVersion: 1,
    contextId: f.contextId,
    runtimeId: f.runtimeId,
    task: f.task,
    lease: f.lease,
    selectedCount: 2,
    result: null,
    reported: false
  })
  await f.queue.pump(f.contextId, crypto.randomUUID())
  expect(f.calls).not.toContain('cleanup.item')
  expect(f.calls).not.toContain('postStudentTasksIdClaim')
  expect(f.journals[0]).toMatchObject({
    reported: true,
    result: { status: 'expired', leaseId: f.lease.leaseId }
  })
})
