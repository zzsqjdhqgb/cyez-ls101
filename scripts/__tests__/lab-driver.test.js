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
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
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
    (_request, response) => {
      requests += 1
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
        certificate.fingerprint
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
        `sha256:${'0'.repeat(64)}`
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
    'nope'
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
  await mkdir(path.join(directory, 'runtime'), { recursive: true })
  await writeFile(
    path.join(directory, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
    `#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
    { mode: 0o755 }
  )
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

test('a failing helper reports only its error code and never the secret input', async () => {
  const directory = await workdir()
  await mkdir(path.join(directory, 'runtime'), { recursive: true })
  await writeFile(
    path.join(directory, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
    `#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
    { mode: 0o755 }
  )
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
