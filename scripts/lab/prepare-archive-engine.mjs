/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../../packages/lab-server/package.json', import.meta.url))
const execute = promisify(execFile)

export async function prepareArchiveEngine({
  engine = require('7zip-bin').path7za,
  check = false
} = {}) {
  try {
    if (!isAbsolute(engine))
      throw new Error('Use the bundled 7zip-bin executable, not USE_SYSTEM_7ZA')
    if (process.platform !== 'win32' && engine.endsWith('.exe'))
      throw new Error('Required native archive tool is Windows-only')
    const info = await stat(engine)
    if (!info.isFile()) throw new Error('Archive engine is not a regular file')
    // 7zip-bin 5.2.0 ships its Linux executable with mode 0644. Prepare it at installation time;
    // production runtime and builds only consume the installed binary, never repair dependencies.
    if (!check && process.platform !== 'win32' && (info.mode & 0o111) !== 0o111)
      await chmod(engine, (info.mode & 0o777) | 0o111)
    await access(engine, constants.X_OK)
    await execute(engine, ['i'], { timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 })
  } catch (cause) {
    throw new Error(
      `Lab archive engine is unavailable: ${engine} (${cause.code ?? cause.message}). Run node scripts/lab/prepare-archive-engine.mjs in a writable installation.`,
      { cause }
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.some((arg) => arg !== '--check')) throw new Error('Only --check is supported')
    await prepareArchiveEngine({ check: args.includes('--check') })
    console.log('[lab] Native archive engine is executable and starts successfully')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
