import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The lab desktop bundles bake the root package.json version in as `__LAB_VERSION__` (see
 * electron.vite.lab-*.config.ts), so every real-host fixture must read that same source.
 * A hardcoded literal here made the student specs fail with VERSION_MISMATCH as soon as the
 * application version moved past the literal.
 */
const metadata: unknown = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
if (
  typeof metadata !== 'object' ||
  metadata === null ||
  typeof (metadata as { version?: unknown }).version !== 'string' ||
  !(metadata as { version: string }).version
)
  throw new Error('package.json does not declare an application version')

export const LAB_VERSION = (metadata as { version: string }).version
