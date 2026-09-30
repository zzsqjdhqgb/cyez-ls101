/*
 * Verifies the guest-side lab driver (tests/lab-vm/manager-driver.ts) without a Windows VM.
 *
 * The two things worth guarding are the ones a VM run would otherwise be the first to discover:
 *   - `verify-tls` must refuse a wrong pin BEFORE any HTTP request exists, and must report a real
 *     identity when the pin matches;
 *   - `manage` must speak the product's control-channel protocol, forward exactly the documented
 *     initialize input, and never surface a secret.
 *
 * Both bundles are built here so the test exercises the same artifact the VM uploads.
 */
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { createServer } = require('node:https')
const { createHash, X509Certificate, randomBytes } = require('node:crypto')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { after, before, test } = require('node:test')
const { promisify } = require('node:util')

const run = promisify(execFile)
const root = path.resolve(__dirname, '../..')
const outDir = path.join(root, 'out/lab-vm')
const driver = path.join(outDir, 'manager-driver.mjs')
const helper = path.join(outDir, 'echo-helper.mjs')

const scratch = []
let certificate

async function bundle(entry, fileName) {
  const { build } = await import('vite')
  await build({
    configFile: false,
    logLevel: 'silent',
    ssr: { noExternal: true },
    build: {
      ssr: path.join(root, entry),
      outDir,
      target: 'node24',
      emptyOutDir: false,
      rollupOptions: {
        external: [/^node:/],
        output: { format: 'es', entryFileNames: fileName, inlineDynamicImports: true }
      }
    }
  })
}

before(async () => {
  await mkdir(outDir, { recursive: true })
  await bundle('tests/lab-vm/manager-driver.ts', 'manager-driver.mjs')
  await bundle('tests/lab-vm/echo-helper.ts', 'echo-helper.mjs')

  // A self-signed ES256 service, built the same way the product builds its own identity.
  const {
    X509CertificateGenerator,
    BasicConstraintsExtension,
    KeyUsagesExtension,
    KeyUsageFlags,
    ExtendedKeyUsageExtension,
    ExtendedKeyUsage
  } = await import('@peculiar/x509')
  const { generateKeyPair, exportPKCS8 } = await import('jose')
  const pair = await generateKeyPair('ES256', { extractable: true })
  const created = await X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(16).toString('hex'),
    name: 'CN=LS101 Lab driver test',
    notBefore: new Date(Date.now() - 86400000),
    notAfter: new Date(Date.now() + 3650 * 86400000),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [
      new BasicConstraintsExtension(false, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth])
    ],
    keys: pair
  })
  const parsed = new X509Certificate(Buffer.from(created.toString('pem')))
  certificate = {
    pem: created.toString('pem'),
    key: await exportPKCS8(pair.privateKey),
    fingerprint: `sha256:${createHash('sha256')
      .update(parsed.publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')}`
  }
})

after(async () => {
  await Promise.all(scratch.splice(0).map((entry) => rm(entry, { recursive: true, force: true })))
})

async function workdir() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ls101-driver-'))
  scratch.push(directory)
  return directory
}

// The driver spawns `<runtime>/runtime/node[.exe]`, so the tests need a runtime directory that looks
// like an installed release without copying a 120 MB interpreter into it.
//
// On POSIX a shell script that execs the running interpreter is enough. On Windows the same trick
// writes a shell script named `node.exe`, which is not a PE image: `spawn` fails with `UNKNOWN` before
// the control-channel logic under test ever runs, and that is how this file's Windows portability went
// unnoticed for as long as the bundles could not be built. Windows gets a hard link to the running
// interpreter instead — instant on the same volume, and a real executable either way.
async function fakeRuntime(directory) {
  const target = path.join(directory, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  await mkdir(path.dirname(target), { recursive: true })
  if (process.platform === 'win32') {
    try {
      await link(process.execPath, target)
    } catch {
      await copyFile(process.execPath, target)
    }
    return target
  }
  await writeFile(target, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 })
  return target
}

async function driverRun(args, options = {}) {
  try {
    const result = await run(process.execPath, [driver, ...args], options)
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

// Starts the self-signed service and counts how many HTTP requests actually reach it.
async function withService(body, callback) {
  let requests = 0
  const server = createServer(
    { key: certificate.key, cert: certificate.pem },
    (request, response) => {
      requests += 1
      // The stub enforces the contract the real service enforces: every operation requires the client
      // version header and is answered 400 without it. Answering 200 unconditionally is what let a probe
      // that sent no headers pass this suite while failing against the product.
      if (!request.headers['x-ls101-client-version']) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'missing client version' } })
        )
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
  )
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  try {
    return await callback({
      url: `https://127.0.0.1:${server.address().port}/`,
      requests: () => requests
    })
  } finally {
    await new Promise((done) => server.close(done))
  }
}

test('the driver refuses a wrong pin before any request exists and reads /info when it matches', async () => {
  await withService(
    { serverId: 'driver-test-server', releaseVersion: '0.4.1' },
    async (service) => {
      const matched = await driverRun([
        'verify-tls',
        '--url',
        service.url,
        '--fingerprint',
        certificate.fingerprint,
        '--version',
        '0.4.1'
      ])
      assert.equal(matched.code, 0, matched.stderr)
      const observed = JSON.parse(matched.stdout)
      assert.equal(observed.fingerprint, certificate.fingerprint)
      assert.equal(observed.serverId, 'driver-test-server')
      assert.equal(observed.releaseVersion, '0.4.1')
      const afterMatch = service.requests()
      assert.equal(afterMatch, 1)

      // The security property: a mismatched pin must not send a single byte of HTTP.
      const mismatched = await driverRun([
        'verify-tls',
        '--url',
        service.url,
        '--fingerprint',
        `sha256:${'0'.repeat(64)}`,
        '--version',
        '0.4.1'
      ])
      assert.equal(mismatched.code, 1)
      assert.match(mismatched.stderr, /public key changed/)
      assert.equal(service.requests(), afterMatch, 'a wrong pin must not reach the service')

      // A normal CA-validating client cannot reach a self-signed service, which is why clients pin.
      const caClient = await driverRun([
        'verify-tls',
        '--url',
        service.url,
        '--fingerprint',
        certificate.fingerprint,
        '--version',
        '0.4.1',
        '--ca-verify',
        '--expect-connect-failure'
      ])
      assert.equal(caClient.code, 0, caClient.stderr)

      // The inverted expectation must fail when the connection actually succeeds.
      const inverted = await driverRun([
        'verify-tls',
        '--url',
        service.url,
        '--fingerprint',
        certificate.fingerprint,
        '--version',
        '0.4.1',
        '--expect-connect-failure'
      ])
      assert.equal(inverted.code, 1)
      assert.match(inverted.stderr, /refusal was required/)
    }
  )
})

test('the driver rejects a malformed fingerprint instead of silently trusting it', async () => {
  const result = await driverRun([
    'verify-tls',
    '--url',
    'https://127.0.0.1:1/',
    '--fingerprint',
    'nope',
    '--version',
    '0.4.1'
  ])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /sha256:<64 hex>/)
})

test('pipe-name refuses to invent a name on a platform that has no named pipes', async () => {
  const result = await driverRun(['pipe-name', '--root', 'C:/data'])
  if (process.platform === 'win32') {
    assert.equal(result.code, 0)
    assert.match(result.stdout.trim(), /^ls101-lab-[a-f0-9]{32}$/)
  } else {
    assert.equal(result.code, 1)
    assert.match(result.stderr, /only meaningful on Windows/)
  }
})

test('the driver hosts the real control channel and forwards exactly the initialize input', async () => {
  const directory = await workdir()
  // The driver spawns <runtime>/runtime/node with the helper, so the runtime layout mirrors the
  // installed release directory without copying a 120 MB binary into the test.
  await fakeRuntime(directory)
  const input = path.join(directory, 'input.json')
  const activation = path.join(directory, 'activation.txt')
  const password = path.join(directory, 'password.txt')
  const resultFile = path.join(directory, 'result.json')
  await writeFile(
    input,
    JSON.stringify({ name: 'LS101 Lab', baseUrl: 'https://10.0.0.5:8443/', port: 8443 })
  )
  await writeFile(activation, 'LS101-TEST-INVITATION')
  await writeFile(password, 'Aa1!ManagementPasswordForTheTest')
  const result = await driverRun([
    'manage',
    '--manager',
    helper,
    '--runtime',
    directory,
    '--operation',
    'initialize',
    '--input-file',
    input,
    '--activation-file',
    activation,
    '--password-file',
    password,
    '--result',
    resultFile
  ])
  assert.equal(result.code, 0, result.stderr)
  const value = JSON.parse(await readFile(resultFile, 'utf8')).value
  assert.equal(value.operation, 'initialize')
  assert.equal(value.hasInput, true)
  // local-manager.ts rejects any key outside these five, so the driver must send exactly them.
  assert.deepEqual(value.inputKeys, ['activationCode', 'baseUrl', 'name', 'password', 'port'])
  assert.equal(value.hasActivation, true)
  assert.equal(value.hasPassword, true)
  assert.equal(value.port, 8443)
  assert.equal(value.baseUrl, 'https://10.0.0.5:8443/')
  // The secrets travel over the encrypted channel and must not be echoed into stdout or stderr.
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /LS101-TEST-INVITATION|ManagementPassword/
  )
})

test('the driver can send no input at all for the parameterless operations', async () => {
  const directory = await workdir()
  await fakeRuntime(directory)
  const resultFile = path.join(directory, 'result.json')
  // `connection` is the operation the milestone-M2 phase run needs, and the runtime requires
  // `input === undefined` for it. Sending `{}` is answered with INVALID_REQUEST, which is what the first
  // real VM run of milestone M2 hit.
  const result = await driverRun([
    'manage',
    '--manager',
    helper,
    '--runtime',
    directory,
    '--operation',
    'connection',
    '--input-none',
    '--result',
    resultFile
  ])
  assert.equal(result.code, 0, result.stderr)
  const value = JSON.parse(await readFile(resultFile, 'utf8')).value
  assert.equal(value.operation, 'connection')
  assert.equal(value.hasInput, false)
  assert.deepEqual(value.inputKeys, [])

  // The two shapes are mutually exclusive: a caller that wants an object must not ask for none.
  const conflicting = await driverRun([
    'manage',
    '--manager',
    helper,
    '--runtime',
    directory,
    '--operation',
    'connection',
    '--input-none',
    '--password-file',
    path.join(directory, 'password.txt'),
    '--result',
    resultFile
  ])
  assert.notEqual(conflicting.code, 0)
  assert.match(conflicting.stderr, /--input-none cannot be combined/)
})

test('a failing helper reports only its error code and never the secret input', async () => {
  const directory = await workdir()
  await fakeRuntime(directory)
  const input = path.join(directory, 'input.json')
  const activation = path.join(directory, 'activation.txt')
  const password = path.join(directory, 'password.txt')
  await writeFile(
    input,
    JSON.stringify({ name: 'Lab', baseUrl: 'https://10.0.0.5:8443/', port: 8443 })
  )
  await writeFile(activation, 'LS101-TEST-INVITATION')
  await writeFile(password, 'Aa1!ManagementPasswordForTheTest')
  const result = await driverRun(
    [
      'manage',
      '--manager',
      helper,
      '--runtime',
      directory,
      '--operation',
      'initialize',
      '--input-file',
      input,
      '--activation-file',
      activation,
      '--password-file',
      password,
      '--result',
      path.join(directory, 'result.json')
    ],
    { env: { ...process.env, FAKE_FAIL: '1' } }
  )
  assert.equal(result.code, 1)
  assert.equal(result.stderr.trim(), 'LICENSE_INACTIVE')
  assert.doesNotMatch(result.stderr, /LS101-TEST-INVITATION|ManagementPassword/)
  // The installer detail is only ever surfaced for install/upgrade, never for initialize.
  assert.doesNotMatch(result.stderr, /installer detail/)
})

test('prepare-install reports the product\'s refusal the way the installer sees it', async () => {
  const directory = await workdir()
  await fakeRuntime(directory)
  // `install-windows.ps1` runs `<runtime>/manager.cjs --prepare-install` and judges it by its exit
  // status, so the driver runs the same pair. The stub stands in for the packaged manager: the point
  // here is that the exit status, stderr envelope and stdout are all carried back verbatim, which is
  // what makes a refusal diagnosable from the guest log alone.
  const manager = path.join(directory, 'manager.cjs')
  await writeFile(
    manager,
    [
      "const args = process.argv.slice(2)",
      "if (args[0] !== '--prepare-install') {",
      "  process.stderr.write('unexpected arguments\\n')",
      '  process.exit(9)',
      '}',
      "process.stdout.write('preparation attempted\\n')",
      'process.stderr.write(JSON.stringify({ ok: false, error: \'RESOURCE_BUSY\' }) + \'\\n\')',
      'process.exit(3)'
    ].join('\n')
  )
  const result = await driverRun(['prepare-install', '--runtime', directory])
  assert.equal(result.code, 0, result.stderr)
  const reported = JSON.parse(result.stdout)
  assert.equal(reported.exitCode, 3)
  assert.equal(reported.timedOut, false)
  assert.match(reported.stdout, /preparation attempted/)
  assert.match(reported.stderr, /RESOURCE_BUSY/)
  // A wrong argument list is a harness error, not a product verdict, and must be visible as one.
  assert.equal(JSON.parse(result.stdout).signal, null)

  const failed = await driverRun(['prepare-install', '--runtime', path.join(directory, 'missing')])
  assert.equal(failed.code, 0, 'the driver reports the outcome even when the child cannot start')
  const missing = JSON.parse(failed.stdout)
  assert.notEqual(missing.exitCode, 0)
  assert.ok(missing.error)
})

test('--raw reports a refused operation as data instead of an exit status', async () => {
  const directory = await workdir()
  await fakeRuntime(directory)
  const resultFile = path.join(directory, 'result.json')
  const refused = await driverRun(
    [
      'manage',
      '--manager',
      helper,
      '--runtime',
      directory,
      '--operation',
      'uninstall',
      '--input-none',
      '--result',
      resultFile,
      '--raw'
    ],
    { env: { ...process.env, FAKE_FAIL: '1' } }
  )
  // Without --raw the same call exits 1 with the code on stderr; M4 has to assert the code itself, so
  // the parsed envelope is the result.
  assert.equal(refused.code, 0, refused.stderr)
  const parsed = JSON.parse(refused.stdout)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.error, 'LICENSE_INACTIVE')
  // The result file is written either way, so a caller that prefers reading it is not left with nothing.
  assert.equal(JSON.parse(await readFile(resultFile, 'utf8')).ok, false)

  const malformed = await driverRun([
    'manage',
    '--manager',
    helper,
    '--runtime',
    directory,
    '--operation',
    'uninstall',
    '--input-none',
    '--result',
    resultFile,
    '--raw'
  ])
  assert.equal(malformed.code, 0, malformed.stderr)
  const ok = JSON.parse(malformed.stdout)
  assert.equal(ok.ok, true)
})

test('the probe refuses to send a request the contract would reject', async () => {
  // Without a version the probe cannot satisfy the header every operation requires, so it must fail
  // before connecting rather than send a request it knows the service will answer with 400.
  const result = await driverRun([
    'verify-tls',
    '--url',
    'https://127.0.0.1:1/',
    '--fingerprint',
    certificate.fingerprint
  ])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /requires --version/)
})
