import { createRequire } from 'node:module'

const ENABLE_SOURCE_MAPS_OPTION = '--enable-source-maps'

interface SourceMapSupport {
  install(options: { handleUncaughtExceptions: boolean }): void
}

const require = createRequire(import.meta.url)

export function installSourceMapSupport(): void {
  // Node's built-in external source-map loader cannot read maps from an ASAR archive.
  const sourceMapSupport = require('source-map-support') as SourceMapSupport
  sourceMapSupport.install({ handleUncaughtExceptions: false })
}

export function sourceMapExecArgv(execArgv: readonly string[] = process.execArgv): string[] {
  return execArgv.includes(ENABLE_SOURCE_MAPS_OPTION)
    ? [...execArgv]
    : [...execArgv, ENABLE_SOURCE_MAPS_OPTION]
}
