import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@ls101/lab-client'
import { StudentController } from '../controller'
import { binding, fakeHost, heartbeat } from './practice-fixture'

const exam = {
  examId: '9b2f5c1e-6a34-4d0b-8f21-7c5e0d9a1b23',
  packageId: 'package',
  title: '练习',
  archiveSha256: 'a'.repeat(64),
  archiveBytes: 100,
  pageCount: 1,
  resourceCount: 0
}
const candidate = { displayName: '学生', candidateId: '001' }
const controllers: StudentController[] = []
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()))
})

async function setup() {
  const { host, invoke } = fakeHost(() => binding)
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation(async (capability, input) => {
    if (capability === 'cache.prepare') return 'ls101-exam://practice/'
    if (capability === 'transport.request') {
      const request = input as { operationId: string; input: { path?: { submissionId: string } } }
      if (request.operationId === 'getStudentExamsExamIdArchive')
        return {
          status: 200,
          archive: { handle: 'archive', sha256: exam.archiveSha256, bytes: 100 }
        }
      if (request.operationId === 'putStudentPracticesSubmissionId')
        return {
          status: 200,
          body: {
            submissionId: request.input.path!.submissionId,
            modeRevision: 1,
            grantedAt: new Date().toISOString(),
            startBefore: new Date(Date.now() + 30000).toISOString()
          }
        }
    }
    return original(capability, input)
  })
  const controller = new StudentController(host)
  controllers.push(controller)
  await controller.start()
  expect(controller.getSnapshot().connected).toBe(true)
  return { controller, invoke }
}

it('releases a downloaded cache when maintenance begins before preparation completes', async () => {
  const { controller, invoke } = await setup()
  const original = invoke.getMockImplementation()!
  let complete!: (url: string) => void
  const cache = new Promise<string>((resolve) => {
    complete = resolve
  })
  invoke.mockImplementation(async (capability, input) => {
    if (capability === 'cache.prepare') return cache
    if (
      capability === 'transport.request' &&
      (input as { operationId: string }).operationId === 'postStudentHeartbeat'
    )
      return { ...heartbeat, body: { ...heartbeat.body, mode: 'maintenance', modeRevision: 2 } }
    return original(capability, input)
  })
  const preparing = controller.prepare(exam)
  const rejected = expect(preparing).rejects.toThrow('准入状态已变化')
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('cache.prepare', expect.anything()))
  await controller.refresh()
  complete('ls101-exam://practice/')
  await rejected
  expect(controller.getSnapshot()).toMatchObject({ player: null, phase: 'idle' })
  expect(invoke).toHaveBeenCalledWith('cache.release', 'ls101-exam://practice/')
})

it.each(['expired', 'mode-changed', 'revoked'] as const)(
  'rejects a %s practice grant without saving a submission',
  async (scenario) => {
    const { controller, invoke } = await setup()
    await controller.prepare(exam)
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation(async (capability, input) => {
      if (
        capability === 'transport.request' &&
        (input as { operationId: string }).operationId === 'putStudentPracticesSubmissionId'
      ) {
        if (scenario === 'revoked') throw new RemoteError('TOKEN_REVOKED', 401)
        const result = (await original(capability, input)) as {
          status: number
          body: Record<string, unknown>
        }
        return {
          ...result,
          body: {
            ...result.body,
            ...(scenario === 'expired'
              ? { startBefore: result.body.grantedAt }
              : { modeRevision: 2 })
          }
        }
      }
      return original(capability, input)
    })
    await expect(
      controller.beforeStart({ candidate, signal: new AbortController().signal })
    ).rejects.toThrow(scenario === 'revoked' ? 'TOKEN_REVOKED' : '练习许可已失效')
    expect(
      invoke.mock.calls.filter(([name]) => name.startsWith('records.') && name !== 'records.list')
    ).toEqual([])
    expect(controller.getSnapshot().phase).not.toBe('practicing')
  }
)

it.each(['records.chunk', 'records.finish'])(
  'retries the same archive and identity after %s fails without uploading partial data',
  async (failure) => {
    const { controller, invoke } = await setup()
    await controller.prepare(exam)
    const grant = await controller.beforeStart({ candidate, signal: new AbortController().signal })
    const original = invoke.getMockImplementation()!
    let failed = false
    invoke.mockImplementation(async (capability, input) => {
      if (capability === failure && !failed) {
        failed = true
        throw new Error('ENOSPC')
      }
      if (capability === 'records.begin') return 'write-handle'
      return original(capability, input)
    })
    const blob = new Blob([new Uint8Array(1024 * 1024 + 7).fill(42)])
    await expect(controller.finish(blob)).rejects.toThrow('ENOSPC')
    expect(controller.getSnapshot().phase).toBe('saving')
    expect(invoke.mock.calls.some(([name]) => name === 'records.uploadHandle')).toBe(false)
    if (failure === 'records.chunk')
      expect(invoke.mock.calls.some(([name]) => name === 'records.finish')).toBe(false)
    await controller.exitPractice()
    expect(controller.getSnapshot().player).not.toBeNull()
    await controller.finish(blob)
    const begins = invoke.mock.calls
      .filter(([name]) => name === 'records.begin')
      .map(([, input]) => input)
    expect(begins).toHaveLength(2)
    expect(begins[1]).toEqual(begins[0])
    expect(begins[1]).toMatchObject({
      intent: { submissionId: grant!.submissionId, candidate },
      bytes: blob.size
    })
    const chunks = invoke.mock.calls
      .filter(([name]) => name === 'records.chunk')
      .slice(-2)
      .map(([, input]) => input as { sequence: number; bytes: Uint8Array })
    expect(chunks.map((chunk) => chunk.sequence)).toEqual([0, 1])
    expect(new Blob(chunks.map((chunk) => new Uint8Array(chunk.bytes))).size).toBe(blob.size)
    expect(chunks.every((chunk) => chunk.bytes.every((value) => value === 42))).toBe(true)
  }
)

it('rejects a late grant after the player cancels without generating a submission', async () => {
  const { controller, invoke } = await setup()
  await controller.prepare(exam)
  const original = invoke.getMockImplementation()!
  let complete!: () => void
  const pending = new Promise<void>((resolve) => {
    complete = resolve
  })
  invoke.mockImplementation(async (capability, input) => {
    if (
      capability === 'transport.request' &&
      (input as { operationId: string }).operationId === 'putStudentPracticesSubmissionId'
    ) {
      await pending
    }
    return original(capability, input)
  })
  const abort = new AbortController()
  const starting = controller.beforeStart({ candidate, signal: abort.signal })
  const rejected = expect(starting).rejects.toThrow('cancelled by player')
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      'transport.request',
      expect.objectContaining({ operationId: 'putStudentPracticesSubmissionId' })
    )
  )
  abort.abort(new Error('cancelled by player'))
  complete()
  await rejected
  expect(invoke).toHaveBeenCalledWith('transport.cancel', expect.any(String))
  expect(invoke.mock.calls.some(([name]) => name === 'records.begin')).toBe(false)
})

it('releases a cache returned after shutdown and never mounts its player', async () => {
  const { controller, invoke } = await setup()
  const original = invoke.getMockImplementation()!
  let complete!: (url: string) => void
  const cache = new Promise<string>((resolve) => {
    complete = resolve
  })
  invoke.mockImplementation(async (capability, input) =>
    capability === 'cache.prepare' ? cache : original(capability, input)
  )
  const preparing = controller.prepare(exam)
  const rejected = expect(preparing).rejects.toThrow('准入状态已变化')
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('cache.prepare', expect.anything()))
  await controller.stop()
  complete('ls101-exam://late/')
  await rejected
  expect(controller.getSnapshot().player).toBeNull()
  expect(invoke).toHaveBeenCalledWith('cache.release', 'ls101-exam://late/')
})
