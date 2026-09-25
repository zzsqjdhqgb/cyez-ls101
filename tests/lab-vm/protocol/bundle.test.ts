/*
 * The other specs import the driver's sources; this one runs the bundle the disposable VM actually
 * receives, as a separate process. That is the only place that proves the settings in
 * `scripts/lab/build-test-driver.mjs` produce a working artifact: everything is inlined, the TLS
 * double's certificate travels with the file, `7zip-bin` is stubbed out, and nothing needs
 * `node_modules` at run time.
 *
 * Two failures were only ever visible here, and neither reproduces against the sources: Vite empties
 * the output directory per build, so only the last of the three bundles survived; and the lazy
 * `import()` in the command registry landed after the entry point's top-level `await`, which threw
 * "Cannot access '<command>$1' before initialization". So this spec calls the real bundler rather than
 * building its own copy — a test that assembles a slightly different artifact proves nothing about the
 * one the VM runs.
 *
 * Bundling needs a writable `out/`. When the checkout cannot provide one the check reports itself as
 * skipped rather than pretending the bundle was verified — `yarn vm:lab` builds it there anyway.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'

const run = promisify(execFile)
const root = resolve(__dirname, '../../..')
const outDir = resolve(root, 'out/lab-vm')
const bundle = resolve(outDir, 'protocol-driver.mjs')

// `access(W_OK)` only reads permission bits, which say nothing about a read-only mount: the probe has to
// attempt a real write, which is exactly what bundling will do.
async function bundleIsBuildable(): Promise<boolean> {
  const probe = resolve(outDir, '.write-probe')
  try {
    await mkdir(outDir, { recursive: true })
    await writeFile(probe, 'probe')
    await rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

const buildable = await bundleIsBuildable()

describe.skipIf(!buildable)('bundled protocol driver', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness()
    await run(process.execPath, [resolve(root, 'scripts/lab/build-test-driver.mjs')], { cwd: root })
  }, 180000)

  it('reports an unknown command instead of printing nothing', async () => {
    await expect(run(process.execPath, [bundle, 'nonsense'])).rejects.toThrow(/Unknown command/)
  })

  it('reaches the service and the TLS double from the bundle', async () => {
    const { stdout } = await run(process.execPath, [
      bundle,
      'pin',
      '--url',
      harness.baseUrl,
      '--fingerprint',
      harness.fingerprint,
      '--version',
      harness.version
    ])
    const observed = JSON.parse(stdout)
    expect(observed.real.opened).toBe(true)
    expect(observed.real.serverId).toBe(harness.serverId)
    // The double is bundled, not generated at run time: its certificate has to be inside the file.
    expect(observed.double.wrongPin.refused).toBe(true)
    expect(observed.double.requests).toBe(0)
  }, 120000)

  it('runs a registered command end to end from the bundle', async () => {
    // A command that only existed as a source import would fail here rather than in the VM: the entry
    // point has to reach every one of them through the bundled registry.
    const source = harness.path('bundle-source.bin')
    const copy = harness.path('bundle-copy.bin')
    await writeFile(source, 'bundle round trip')
    const { stdout } = await run(process.execPath, [
      bundle,
      'file-edit',
      'copy',
      '--in',
      source,
      '--out',
      copy
    ])
    const observed = JSON.parse(stdout)
    expect(observed.kind).toBe('copy')
    expect(observed.bytes).toBe('bundle round trip'.length)
    expect(observed.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(await readFile(copy, 'utf8')).toBe('bundle round trip')
  }, 60000)
})
