import { resolve } from 'node:path'

export type StartupCommand =
  | { id: string; type: 'activate'; code: string }
  | { id: string; type: 'enroll'; filename: string; fingerprint?: string }

export function parseCommand(args: string[], cwd: string, id: string): StartupCommand | null {
  let activation: string | undefined, filename: string | undefined, fingerprint: string | undefined
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--activate') {
      if (activation !== undefined || !args[index + 1])
        throw new Error('Invalid activation command')
      activation = args[++index]
    } else if (argument === '--server-fingerprint') {
      if (fingerprint !== undefined || !/^sha256:[a-f0-9]{64}$/.test(args[index + 1] ?? ''))
        throw new Error('Invalid server fingerprint')
      fingerprint = args[++index]
    } else if (argument.startsWith('--')) {
      if (
        !['--no-sandbox', '--password-store=basic', '--password-store=gnome-libsecret'].includes(
          argument
        ) &&
        !argument.startsWith('--user-data-dir=') &&
        !argument.startsWith('--inspect=') &&
        !argument.startsWith('--remote-debugging-port=')
      )
        throw new Error('Unknown startup argument')
    } else {
      if (filename || !argument.toLowerCase().endsWith('.lsjoin'))
        throw new Error('Invalid enrollment file')
      filename = resolve(cwd, argument)
    }
  }
  // Activation has priority; enrollment in the same invocation is never deferred.
  if (activation !== undefined) return { id, type: 'activate', code: activation }
  if (fingerprint && !filename) throw new Error('Enrollment file required')
  return filename ? { id, type: 'enroll', filename, fingerprint } : null
}
