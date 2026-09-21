import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { LocalRecovery } from '../local-recovery'

it('requires a host-selected verified export and rejects renderer-supplied purge targets', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ls101-recovery-host-'))
  onTestFinished(() => rm(parent, { recursive: true, force: true }))
  const choose = vi.fn().mockResolvedValue(parent)
  const invoke = vi.fn(async (operation, input) => {
    if (operation === 'export-data') {
      expect((await stat(input.directory)).isDirectory()).toBe(true)
      return { directory: input.directory, manifestSha256: 'a'.repeat(64), files: 3, bytes: 99 }
    }
    return { state: 'not-installed' }
  })
  const recovery = new LocalRecovery(choose, invoke)
  await expect(recovery.run('purge', undefined)).rejects.toThrow('LOCAL_RECOVERY_EXPORT_REQUIRED')
  await expect(recovery.run('export-data', { directory: 'arbitrary' })).rejects.toThrow(
    'INVALID_REQUEST'
  )
  const receipt = await recovery.run('export-data', undefined)
  await expect(recovery.run('purge', { directory: 'arbitrary' })).rejects.toThrow('INVALID_REQUEST')
  await expect(recovery.run('purge', undefined)).resolves.toEqual({ state: 'not-installed' })
  expect(invoke).toHaveBeenLastCalledWith('purge', receipt)
  await expect(recovery.run('purge', undefined)).rejects.toThrow('LOCAL_RECOVERY_EXPORT_REQUIRED')
})

it('cancellation or failed export never grants permission to purge', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ls101-recovery-cancel-'))
  onTestFinished(() => rm(parent, { recursive: true, force: true }))
  const choose = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(parent)
  const invoke = vi.fn().mockRejectedValue(new Error('ENOSPC'))
  const recovery = new LocalRecovery(choose, invoke)
  expect(await recovery.run('export-data', undefined)).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
  await expect(recovery.run('purge', undefined)).rejects.toThrow('LOCAL_RECOVERY_EXPORT_REQUIRED')
  await expect(recovery.run('export-data', undefined)).rejects.toThrow('ENOSPC')
  await expect(recovery.run('purge', undefined)).rejects.toThrow('LOCAL_RECOVERY_EXPORT_REQUIRED')
})
