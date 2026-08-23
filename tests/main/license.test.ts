import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LICENSE_CHANNELS } from '@ls101/core-types'

type IpcHandler = (...args: unknown[]) => unknown

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  return {
    app: { exit: vi.fn(), relaunch: vi.fn() },
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler))
    }
  }
})

vi.mock('electron', () => ({
  app: electronMocks.app,
  ipcMain: electronMocks.ipcMain
}))

import { registerLicenseHandlers } from '../../src/main/license'

let directories: string[]

beforeEach(() => {
  directories = []
  electronMocks.handlers.clear()
  electronMocks.app.exit.mockClear()
  electronMocks.app.relaunch.mockClear()
  vi.useFakeTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('license IPC', () => {
  it('deletes the receipt and relaunches after replying', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ls101-license-ipc-'))
    directories.push(directory)
    const storagePath = path.join(directory, 'license.json')
    await writeFile(storagePath, '{}', 'utf8')
    registerLicenseHandlers({ storagePath })

    const deactivate = electronMocks.handlers.get(LICENSE_CHANNELS.deactivate)
    expect(deactivate).toBeDefined()

    await expect(deactivate!()).resolves.toBeUndefined()
    await expect(readFile(storagePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(electronMocks.app.relaunch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)

    expect(electronMocks.app.relaunch).toHaveBeenCalledTimes(1)
    expect(electronMocks.app.exit).toHaveBeenCalledWith(0)
  })
})
