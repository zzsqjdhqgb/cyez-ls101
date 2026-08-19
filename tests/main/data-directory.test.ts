import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_DIRECTORY_CHANNELS } from '@ls101/core-types'

type IpcHandler = (event: { sender: object }, ...args: never[]) => unknown

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  class BrowserWindowMock {
    static fromWebContents(): null {
      return null
    }

    destroy = vi.fn()
    isDestroyed = vi.fn(() => false)
    loadURL = vi.fn().mockResolvedValue(undefined)
    once = vi.fn()
    removeMenu = vi.fn()
  }
  return {
    app: { exit: vi.fn(), relaunch: vi.fn() },
    BrowserWindow: BrowserWindowMock,
    dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler))
    }
  }
})

vi.mock('electron', () => ({
  app: electronMocks.app,
  BrowserWindow: electronMocks.BrowserWindow,
  dialog: electronMocks.dialog,
  ipcMain: electronMocks.ipcMain
}))

import {
  initializeDataDirectory,
  registerDataDirectoryHandlers
} from '../../src/main/data-directory'

let roots: string[]

beforeEach(() => {
  roots = []
  electronMocks.handlers.clear()
  vi.useFakeTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })))
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(directory)
  return directory
}

describe('data directory initialization', () => {
  it('creates a managed default directory for a fresh profile', async () => {
    const userData = await temporaryDirectory('ls101-data-fresh-')
    const result = await initializeDataDirectory(userData)

    expect(result).toBe(path.join(userData, 'data'))
    await expect(readJson(path.join(result, '.ls101-data.json'))).resolves.toMatchObject({
      formatVersion: 1,
      kind: 'ls101-data-directory'
    })
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: result
    })
  })

  it('copies only known legacy business data into the managed directory', async () => {
    const userData = await temporaryDirectory('ls101-data-legacy-')
    await mkdir(path.join(userData, 'template-editor'), { recursive: true })
    await writeFile(path.join(userData, 'template-editor', 'draft.json'), '{"draft":true}')
    await mkdir(path.join(userData, 'models', 'tts'), { recursive: true })
    await writeFile(path.join(userData, 'models', 'tts', 'model.bin'), 'model')
    await mkdir(path.join(userData, 'Cache'))
    await writeFile(path.join(userData, 'Cache', 'cache.bin'), 'cache')
    await mkdir(path.join(userData, 'qwen-tts-runtime'))
    await writeFile(path.join(userData, 'qwen-tts-runtime', 'runtime.bin'), 'runtime')

    const result = await initializeDataDirectory(userData)

    await expect(
      readFile(path.join(result, 'template-editor', 'draft.json'), 'utf8')
    ).resolves.toBe('{"draft":true}')
    await expect(readFile(path.join(result, 'models', 'tts', 'model.bin'), 'utf8')).resolves.toBe(
      'model'
    )
    await expect(readFile(path.join(result, 'Cache', 'cache.bin'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(
      readFile(path.join(result, 'qwen-tts-runtime', 'runtime.bin'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('finishes a scheduled copy on the next initialization and retains the source', async () => {
    const userData = await temporaryDirectory('ls101-data-copy-')
    const targetParent = await temporaryDirectory('ls101-data-target-')
    const target = path.join(targetParent, 'selected')
    await mkdir(target)
    const source = await initializeDataDirectory(userData)
    await writeFile(path.join(source, 'document.json'), '{"value":1}')
    registerDataDirectoryHandlers(userData, source)
    const migrate = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.migrate)
    expect(migrate).toBeDefined()
    await expect(migrate!({ sender: {} }, target as never)).resolves.toBeUndefined()

    const result = await initializeDataDirectory(userData)
    expect(result).toBe(target)
    await expect(readFile(path.join(target, 'document.json'), 'utf8')).resolves.toBe('{"value":1}')
    await expect(readFile(path.join(source, 'document.json'), 'utf8')).resolves.toBe('{"value":1}')
    await expect(readJson(path.join(userData, 'data-location.json'))).resolves.toMatchObject({
      state: 'ready',
      activeDataDirectory: target
    })
  })

  it('rejects ordinary non-empty migration targets', async () => {
    const userData = await temporaryDirectory('ls101-data-reject-')
    const target = await temporaryDirectory('ls101-data-nonempty-')
    await writeFile(path.join(target, 'unrelated.txt'), 'keep')
    const source = await initializeDataDirectory(userData)
    registerDataDirectoryHandlers(userData, source)
    const migrate = electronMocks.handlers.get(DATA_DIRECTORY_CHANNELS.migrate)
    expect(migrate).toBeDefined()

    await expect(migrate!({ sender: {} }, target as never)).rejects.toThrow(
      '请选择空目录，或选择一个已有的 LS101 数据目录'
    )
    await expect(readFile(path.join(target, 'unrelated.txt'), 'utf8')).resolves.toBe('keep')
  })
})

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, 'utf8')) as unknown
}
