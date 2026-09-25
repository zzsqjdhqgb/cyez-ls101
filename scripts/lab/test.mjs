import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { prepareArchiveEngine } from './prepare-archive-engine.mjs'

const root = resolve(import.meta.dirname, '../..')

try {
  if (process.argv.length > 2) throw new Error('Use individual lab:test:* commands for filters')
  if (process.versions.node !== '24.20.0')
    throw new Error(
      `Lab acceptance requires Node 24.20.0; current version is ${process.versions.node}`
    )
  if (!['linux', 'win32'].includes(process.platform)) throw new Error('Unsupported lab platform')

  console.log('[lab:test] Checking native archive engine')
  await prepareArchiveEngine({ check: true })
  const steps = [
    'lab:test:desktop',
    'lab:test:submission',
    'lab:test:typecheck',
    'lab:typecheck',
    'lab:test:service',
    'lab:test:protocol',
    'lab:test:server',
    'lab:test:integration'
  ]
  for (const step of steps) {
    console.log(`\n[lab:test] Running ${step}`)
    // Yarn can expose a shell wrapper as npm_execpath. Invoke the command on its inherited PATH;
    // Windows requires a shell for yarn.cmd. All command arguments here are fixed script names.
    const virtualDisplay = step === 'lab:test:integration' && process.platform === 'linux'
    const executable = virtualDisplay ? 'xvfb-run' : 'yarn'
    const args = virtualDisplay ? ['-a', 'yarn', step] : [step]
    const result = spawnSync(executable, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, LS101_SETUP_MODE: 'product-docs' }
    })
    if (result.error || result.signal || result.status !== 0) {
      console.error(
        `[lab:test] ${step} failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`
      )
      process.exit(result.status || 1)
    }
  }
  console.log('\n[lab:test] All lab acceptance suites passed')
} catch (error) {
  console.error(`[lab:test] ${error.message}`)
  process.exitCode = 1
}
