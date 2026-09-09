import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { listenLocalControl } from '@ls101/lab-server/control'

function execute(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 35 * 60000, maxBuffer: 8192 }, (error) => {
      if (error) reject(new Error('LOCAL_HELPER_FAILED'))
      else resolve()
    })
  })
}
const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`

export function localServiceHost(
  runtime: string,
  launch = execute
): {
  invoke(operation: string, input: unknown): Promise<unknown>
} {
  let busy = false
  return {
    async invoke(operation, input) {
      if (
        ![
          'status',
          'initialize',
          'connection',
          'start',
          'stop',
          'autostart',
          'logs',
          'restore',
          'recover-restore',
          'install',
          'uninstall',
          'upgrade',
          'configure'
        ].includes(operation)
      )
        throw new Error('INVALID_REQUEST')
      if (busy) throw new Error('LOCAL_OPERATION_BUSY')
      busy = true
      let channel: string | undefined
      let listener: Awaited<ReturnType<typeof listenLocalControl>> | undefined
      try {
        channel = await mkdtemp(join(tmpdir(), 'ls101-manager-'))
        if (process.platform === 'win32') {
          await execute('icacls.exe', [
            channel,
            '/inheritance:r',
            '/grant:r',
            `${userInfo().username}:(OI)(CI)F`,
            '*S-1-5-18:(OI)(CI)F',
            '*S-1-5-32-544:(OI)(CI)F'
          ])
        }
        const key = randomBytes(32)
        await writeFile(join(channel, 'control.key'), key, { mode: 0o600, flag: 'wx', flush: true })
        let requested = false
        let result: { ok: boolean; value?: unknown; error?: string; detail?: string } | undefined
        listener = await listenLocalControl(channel, key, async (method, value) => {
          if (method === 'request' && !requested && value === undefined) {
            requested = true
            return { operation, input }
          }
          if (
            method === 'complete' &&
            requested &&
            !result &&
            value &&
            typeof value === 'object' &&
            typeof (value as { ok?: unknown }).ok === 'boolean'
          ) {
            result = value as { ok: boolean; value?: unknown; error?: string; detail?: string }
            return null
          }
          throw new Error('INVALID_REQUEST')
        })
        const executable = join(
          runtime,
          'runtime',
          process.platform === 'win32' ? 'node.exe' : 'node'
        )
        const args = [join(runtime, 'manager.cjs'), '--channel', channel]
        if (process.platform === 'win32') {
          // UAC receives only fixed program paths and a public channel path; secrets stay encrypted.
          const argumentsText = args.map((arg) => `"${arg}"`).join(' ')
          await launch('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$p = Start-Process -FilePath ${quote(executable)} -ArgumentList ${quote(argumentsText)} -Verb RunAs -Wait -PassThru; exit $p.ExitCode`
          ])
        } else if (process.platform === 'linux') {
          await launch(
            process.getuid?.() === 0 ? executable : 'pkexec',
            process.getuid?.() === 0 ? args : [executable, ...args]
          )
        } else throw new Error('UNSUPPORTED_PLATFORM')
        if (!result) throw new Error('LOCAL_HELPER_INCOMPLETE')
        if (!result.ok) {
          const code =
            result.error && /^[A-Z_]+$/.test(result.error) ? result.error : 'LOCAL_OPERATION_FAILED'
          const detail =
            ['install', 'upgrade'].includes(operation) && typeof result.detail === 'string'
              ? result.detail.slice(0, 8192).trim()
              : ''
          throw new Error(detail ? `${code}\n${detail}` : code)
        }
        return result.value
      } finally {
        try {
          await listener?.close()
        } finally {
          try {
            if (channel) await rm(channel, { recursive: true, force: true })
          } finally {
            busy = false
          }
        }
      }
    }
  }
}
