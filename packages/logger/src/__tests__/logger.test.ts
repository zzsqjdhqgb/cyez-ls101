import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConsoleLogger, createMainLogger, serializeError } from '../main'

describe('MainLogger', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'ls101-logger-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('writes structured log events to a JSONL file', async () => {
    const logger = await createMainLogger({ directory })
    logger.info('test event', { operation: 'unit-test' })
    logger.error('test failure', new Error('boom'))

    await logger.flush()
    const lines = (await readFile(path.join(directory, 'application.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ level: 'info', message: 'test event' })
    expect(lines[1]).toMatchObject({
      level: 'error',
      message: 'test failure',
      error: { name: 'Error', message: 'boom' }
    })
  })

  it('serializes non-Error rejection reasons', () => {
    expect(serializeError('failed')).toEqual({ name: 'UnknownError', message: 'failed' })
    expect(serializeError(undefined)).toBeUndefined()
  })

  it('synchronously persists fatal errors', async () => {
    const logger = await createMainLogger({ directory })
    logger.errorSync('fatal failure', new Error('fatal'))

    const record = JSON.parse(
      (await readFile(path.join(directory, 'application.log'), 'utf8')).trim()
    ) as Record<string, unknown>
    expect(record).toMatchObject({
      level: 'error',
      message: 'fatal failure',
      error: { name: 'Error', message: 'fatal' }
    })
  })

  it('rotates log files and retains only the configured number', async () => {
    const logger = await createMainLogger({ directory, maxFileBytes: 220, maxFiles: 2 })
    for (let index = 0; index < 8; index += 1) {
      logger.info(`rotation event ${index}`, { value: 'x'.repeat(80) })
    }
    await logger.flush()

    expect((await readdir(directory)).sort()).toEqual(['application.log', 'application.log.1'])
    expect(await readFile(path.join(directory, 'application.log.1'), 'utf8')).toContain(
      'rotation event'
    )
  })

  it('supports console-only logging when persistent initialization fails', async () => {
    const blockingFile = path.join(directory, 'not-a-directory')
    await writeFile(blockingFile, 'blocked')
    await expect(createMainLogger({ directory: path.join(blockingFile, 'logs') })).rejects.toThrow()

    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fallback = createConsoleLogger()
    expect(() => fallback.errorSync('fallback active', new Error('disk unavailable'))).not.toThrow()
    expect(output).toHaveBeenCalledOnce()
    output.mockRestore()
  })
})
