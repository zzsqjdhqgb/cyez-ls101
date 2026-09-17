const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const { createHash, randomUUID } = require('node:crypto')
const path = require('node:path')
const { tmpdir } = require('node:os')

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const scripts = path.resolve(__dirname, '../lab')

async function installerFixture(t, prepare, mode = '--install', retained = null) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'ls101-install-preflight-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'bundle'),
    data = path.join(root, 'data')
  await fs.mkdir(path.join(source, 'runtime'), { recursive: true })
  await fs.mkdir(data)
  await fs.writeFile(path.join(data, 'service.sqlite'), 'existing database')
  const manifest = {
    format: 'ls101-service-runtime',
    platform: 'linux',
    arch: process.arch,
    nodeVersion: '24.20.0',
    releaseVersion: 'next-release',
    files: []
  }
  for (const name of ['server.cjs', 'manager.cjs', 'runtime/node', 'ls101-lab.service']) {
    const bytes = Buffer.from(`fixture ${name}`)
    await fs.writeFile(path.join(source, name), bytes, { mode: 0o755 })
    manifest.files.push({
      path: name,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  }
  await fs.writeFile(path.join(source, 'runtime-manifest.json'), JSON.stringify(manifest))
  const retainedManifest = path.join(root, 'retained-manifest.json')
  if (retained)
    await fs.writeFile(
      retainedManifest,
      JSON.stringify(retained === 'same' ? manifest : { ...manifest, releaseVersion: 'old' })
    )
  const script = await fs.readFile(path.join(scripts, 'install-server-linux.mjs'), 'utf8')
  // Run production verification and preparation with isolated paths and a fake OS helper.
  // Stop before service registration so the test never changes the host's installation.
  const body = (
    script.slice(script.indexOf('const source ='), script.indexOf('  let state')) + '\n}'
  )
    .replace('import.meta.dirname', JSON.stringify(source))
    .replace("'/opt/ls101-lab/current/runtime-manifest.json'", JSON.stringify(retainedManifest))
    .replace(/'\/var\/lib\/ls101-lab\/data([^']*)'/g, (_match, suffix) =>
      JSON.stringify(path.join(data, suffix))
    )
  const bindings = {
    ...fs,
    ...path,
    constants,
    createHash,
    randomUUID,
    process: {
      platform: 'linux',
      arch: process.arch,
      argv: ['node', 'installer', mode],
      getuid: () => 0,
      stdout: { write() {} }
    },
    execFileSync(executable, args) {
      assert.equal(executable, path.join(source, 'runtime/node'))
      if (args[0] === '--version') return 'v24.20.0'
      assert.deepEqual(args, [path.join(source, 'manager.cjs'), '--prepare-install'])
      return prepare(data, manifest)
    }
  }
  return () => new AsyncFunction(...Object.keys(bindings), body)(...Object.values(bindings))
}

test('a new installer prepares its target against an existing service before checking the marker', async (t) => {
  let prepared = false
  const run = await installerFixture(t, (data, manifest) => {
    prepared = true
    require('node:fs').writeFileSync(
      path.join(data, 'upgrade-ready.json'),
      JSON.stringify({
        targetVersion: manifest.releaseVersion,
        preparedAt: new Date().toISOString()
      })
    )
  })
  await run()
  assert.equal(prepared, true)
})

test('installer aborts on refused preparation and still rejects stopped services without a matching marker', async (t) => {
  const refused = await installerFixture(t, () => {
    throw new Error('RESOURCE_BUSY')
  })
  await assert.rejects(refused, /RESOURCE_BUSY/)
  const stopped = await installerFixture(t, () => {})
  await assert.rejects(stopped, { code: 'ENOENT' })
  const wrongVersion = await installerFixture(t, (data) => {
    require('node:fs').writeFileSync(
      path.join(data, 'upgrade-ready.json'),
      JSON.stringify({
        targetVersion: 'old-release',
        preparedAt: new Date().toISOString()
      })
    )
  })
  await assert.rejects(wrongVersion, /Prepare the upgrade/)
})

test('verification does not prepare or stop an installed service', async (t) => {
  const run = await installerFixture(
    t,
    () => assert.fail('verification must not stop the service'),
    '--verify'
  )
  await run()
})

test('the exact retained runtime can be reinstalled without an upgrade marker', async (t) => {
  const same = await installerFixture(t, () => {}, '--install', 'same')
  await same()
  const different = await installerFixture(t, () => {}, '--install', 'different')
  await assert.rejects(different, { code: 'ENOENT' })
})

test('desktop packaging creates missing output directories before checking their permissions', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'ls101-package-preflight-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'node_modules'))
  const script = await fs.readFile(path.join(scripts, 'package-desktop.mjs'), 'utf8')
  const body = script
    .slice(script.indexOf('const require ='), script.indexOf('await buildDesktop'))
    .replace('import.meta.url', "'file:///fixture/package-desktop.mjs'")
    .replace('import.meta.dirname', JSON.stringify(path.join(root, 'scripts/lab')))
  const bindings = {
    ...fs,
    ...path,
    constants,
    createRequire: () => ({}),
    process: { platform: 'linux', argv: ['node', 'package', 'student'] }
  }
  await new AsyncFunction(...Object.keys(bindings), body)(...Object.values(bindings))
  for (const name of ['out', 'dist'])
    assert.equal((await fs.stat(path.join(root, name))).isDirectory(), true)
})

test('the packaged-dependency allowlist does not depend on the platform path separator', async () => {
  const { pathToFileURL } = require('node:url')
  const { normalizeAsarEntries, unexpectedAsarEntries } = await import(
    pathToFileURL(path.join(scripts, 'package-audit.mjs')).href
  )
  const linux = [
    '/main',
    '/main/index.js',
    '/main/dependency-audit.json',
    '/preload/index.js',
    '/renderer/index.html',
    '/renderer/assets/index.js',
    '/package.json'
  ]
  // @electron/asar builds entry paths with path.join, so a Windows host lists the same archive with
  // backslashes. Before this was normalised, every Windows package failed here.
  const windows = linux.map((entry) => entry.replaceAll('/', '\\'))
  assert.deepEqual(unexpectedAsarEntries(linux), [])
  assert.deepEqual(unexpectedAsarEntries(windows), [])
  assert.deepEqual(normalizeAsarEntries(['\\main\\index.js']), ['/main/index.js'])

  // The allowlist must still reject anything outside the three built directories, on both platforms.
  assert.deepEqual(unexpectedAsarEntries(['/main/index.js', '/node_modules/electron/index.js']), [
    '/node_modules/electron/index.js'
  ])
  assert.deepEqual(
    unexpectedAsarEntries(['\\main\\index.js', '\\node_modules\\electron\\index.js']),
    ['/node_modules/electron/index.js']
  )
  assert.deepEqual(unexpectedAsarEntries(['/src/main/index.ts', '/README.md']), [
    '/src/main/index.ts',
    '/README.md'
  ])
  assert.deepEqual(unexpectedAsarEntries([]), [])
})
