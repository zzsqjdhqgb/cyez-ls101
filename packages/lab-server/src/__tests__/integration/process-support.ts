import { fork } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'vite'
import type { Endpoint } from './support'

const output = resolve(import.meta.dirname, '../../../../../out/lab-server-tests/worker.cjs')
let building: Promise<unknown> | undefined

export async function buildWorker(): Promise<void> {
  // Production source and dependencies, with a private test entry for deterministic crash points.
  building ??= build({
    configFile: false,
    logLevel: 'error',
    ssr: { noExternal: true, external: ['7zip-bin'] },
    build: {
      ssr: join(import.meta.dirname, 'process-worker.ts'),
      outDir: dirname(output),
      emptyOutDir: false,
      target: 'node24',
      minify: false,
      rollupOptions: {
        external: ['7zip-bin', /^node:/],
        output: { format: 'cjs', entryFileNames: 'worker.cjs', inlineDynamicImports: true }
      }
    }
  })
  await building
}

export async function processFixture() {
  await buildWorker()
  const parent = await mkdtemp(join(tmpdir(), 'ls101-crash-'))
  const root = join(parent, 'data')
  let child: ReturnType<typeof fork> | undefined
  let exited: Promise<void> = Promise.resolve()
  let logs = ''
  let serial = 0
  const messages: any[] = []
  const listeners = new Set<() => void>()
  const endpoint: Endpoint = { port: 0, certificate: '' }
  const waitFor = (predicate: (message: any) => boolean): Promise<any> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Worker IPC timed out. ${logs}`))
      }, 15000)
      const cleanup = () => {
        clearTimeout(timer)
        listeners.delete(check)
      }
      const check = () => {
        const index = messages.findIndex(predicate)
        if (index >= 0) {
          const message = messages.splice(index, 1)[0]
          cleanup()
          if (message.error) reject(new Error(message.error))
          else resolve(message)
        } else if (child && (child.exitCode !== null || child.signalCode !== null)) {
          cleanup()
          reject(new Error(`Worker exited before expected message. ${logs}`))
        }
      }
      listeners.add(check)
      check()
    })
  const command = async (
    operation: string,
    point?: string,
    input?: { archive: string; password: string }
  ) => {
    const id = ++serial
    const answer = waitFor((message) => message.id === id)
    child!.send({ id, operation, point, input })
    await answer
  }
  return {
    root,
    endpoint,
    async start(initialize: boolean | 'restore' = false) {
      logs = ''
      messages.length = 0
      child = fork(
        output,
        [root, ...(initialize ? [initialize === 'restore' ? 'restore' : 'initialize'] : [])],
        {
          cwd: tmpdir(),
          execArgv: [],
          stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        }
      )
      child.stdout!.on('data', (chunk) => {
        logs = (logs + chunk).slice(-16000)
      })
      child.stderr!.on('data', (chunk) => {
        logs = (logs + chunk).slice(-16000)
      })
      child.on('message', (message) => {
        messages.push(message)
        for (const listener of listeners) listener()
      })
      exited = new Promise<void>((resolve) =>
        child!.once('exit', () => {
          for (const listener of listeners) listener()
          resolve()
        })
      )
      const ready = await waitFor((message) => message.event === 'ready')
      if (initialize !== 'restore') {
        endpoint.port = ready.port
        endpoint.certificate = ready.certificate
      }
    },
    pause: (point: string) => command('pause', point),
    reached: (point: string) =>
      waitFor((message) => message.event === 'paused' && message.point === point),
    release: () => command('release'),
    restore: (archive: string, password: string, point: string) =>
      command('restore', point, { archive, password }),
    async kill() {
      child?.kill('SIGKILL')
      await exited
    },
    async stop() {
      await command('stop')
      await exited
    },
    async close() {
      child?.kill('SIGKILL')
      await exited
      await rm(parent, { recursive: true, force: true })
    }
  }
}
export type ProcessFixture = Awaited<ReturnType<typeof processFixture>>
