import { resolve } from 'node:path'
import { requestLocalControl } from './control'
import { startServiceRuntime } from './runtime'
import { recoverOfflineRestore, restoreOffline } from './restore'

declare const __LAB_VERSION__: string

async function input(): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('INPUT_TOO_LARGE')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function main(): Promise<void> {
  const [command, flag, directory, ...extra] = process.argv.slice(2)
  if (command === '--version' && flag === undefined) {
    process.stdout.write(`${__LAB_VERSION__}\n`)
    return
  }
  if (
    ![
      'serve',
      'status',
      'shutdown',
      'activate',
      'initialize',
      'restore',
      'recover-restore'
    ].includes(command) ||
    flag !== '--data-dir' ||
    !directory ||
    extra.length
  )
    throw new Error('INVALID_ARGUMENTS')
  const root = resolve(directory)
  if (command === 'serve') {
    const runtime = await startServiceRuntime(root, __LAB_VERSION__)
    process.stdout.write(`${JSON.stringify(await runtime.status())}\n`)
    let stopping = false
    const stop = (): void => {
      if (stopping) return
      stopping = true
      void runtime.close().catch(() => {
        process.exitCode = 1
      })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    return
  }
  let result: unknown
  if (command === 'restore') {
    const value = (await input()) as { archive: string; password: string }
    if (
      !value ||
      typeof value.archive !== 'string' ||
      typeof value.password !== 'string' ||
      Object.keys(value).some((key) => !['archive', 'password'].includes(key))
    )
      throw new Error('INVALID_INPUT')
    result = await restoreOffline({
      root,
      archive: resolve(value.archive),
      password: value.password,
      releaseVersion: __LAB_VERSION__
    })
  } else if (command === 'recover-restore') {
    result = { previousDirectory: await recoverOfflineRestore(root, __LAB_VERSION__) }
  } else {
    result = await requestLocalControl(
      root,
      command,
      ['status', 'shutdown'].includes(command) ? undefined : await input()
    )
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

void main().catch((error: unknown) => {
  const code = (error as { code?: string }).code
  process.stderr.write(
    `${JSON.stringify({ error: typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'SERVICE_COMMAND_FAILED' })}\n`
  )
  process.exitCode = 1
})
