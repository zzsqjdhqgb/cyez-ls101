/*
 * Validates the driver's HTTPS request shape against the product's own generated contract.
 *
 * This file exists because of a real defect. The probe sent no X-LS101-Client-Version header, the
 * service answered 400 — correctly, the request was invalid — and the container test passed anyway,
 * because its hand-written stub answered 200 to anything. The stub was a mirror of the probe author's
 * assumption, so it agreed with the bug and the only way to find it was a full VM rebuild.
 *
 * The expectation therefore comes from packages/lab-contracts/src/contract.generated.json, which is
 * generated from the API design document, and the header values are checked with the same schema
 * objects the server validates against. Nothing here re-states the protocol by hand.
 */
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { test } = require('node:test')
const Ajv = require('ajv')

const root = path.resolve(__dirname, '../..')
const contractPath = path.join(root, 'packages/lab-contracts/src/contract.generated.json')
const driverPath = path.join(root, 'tests/lab-vm/manager-driver.ts')
const headersModule = import(pathToFileURL(path.join(root, 'tests/lab-vm/probe-headers.mjs')).href)

test('the probe sends every header the contract requires for the operation it calls', async () => {
  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  const { buildProbeHeaders, PROBE_OPERATION, PROBE_PATH } = await headersModule
  const operation = contract.operations[PROBE_OPERATION]
  assert.ok(operation, `the contract declares no operation named ${PROBE_OPERATION}`)
  // The request the probe builds must be the request the contract serves.
  assert.ok(
    PROBE_PATH.endsWith(operation.route),
    `${PROBE_PATH} does not end with the contracted route ${operation.route}`
  )

  const sent = Object.fromEntries(
    Object.entries(buildProbeHeaders('0.4.1')).map(([name, value]) => [name.toLowerCase(), value])
  )
  const required = operation.parameters.filter(
    (parameter) => parameter.in === 'header' && parameter.required
  )
  assert.ok(required.length > 0, `${PROBE_OPERATION} should declare at least one required header`)
  for (const parameter of required) {
    const name = parameter.name.toLowerCase()
    assert.ok(name in sent, `the probe omits the required header ${parameter.name}`)
    const validate = new Ajv({ strict: false }).compile(parameter.schema)
    assert.ok(validate(sent[name]), `${parameter.name} does not satisfy the contracted schema`)
  }
})

test('the version header is one the probe can satisfy under every operation that requires it', async () => {
  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  const { buildProbeHeaders } = await headersModule
  const sent = Object.fromEntries(
    Object.entries(buildProbeHeaders('0.4.1')).map(([name, value]) => [name.toLowerCase(), value])
  )
  // The service reads this header for every operation it dispatches, so a schema change to the shared
  // parameter must not quietly invalidate the probe. Other required headers are per-operation and belong
  // to operations this probe never calls.
  let checked = 0
  for (const [id, operation] of Object.entries(contract.operations)) {
    for (const parameter of operation.parameters) {
      if (parameter.in !== 'header' || !parameter.required) continue
      if (parameter.name.toLowerCase() !== 'x-ls101-client-version') continue
      checked += 1
      const validate = new Ajv({ strict: false }).compile(parameter.schema)
      assert.ok(
        validate(sent['x-ls101-client-version']),
        `operation ${id} would reject the probe's version`
      )
    }
  }
  assert.ok(checked > 0, 'at least one operation must require the client version header')
})

test('the driver builds its request from that helper instead of by hand', async () => {
  const source = await readFile(driverPath, 'utf8')
  // A helper nobody calls would make the tests above vacuous.
  assert.match(source, /headers:\s*buildProbeHeaders\(version\)/)
  assert.match(source, /\$\{target\.origin\}\$\{PROBE_PATH\}/)
  // Without a version the probe cannot satisfy the contract, so it refuses rather than sending a request
  // it knows will be rejected.
  assert.match(source, /verify-tls requires --version/)
})

test('a client version the contract would reject never reaches a request', async () => {
  const { buildProbeHeaders } = await headersModule
  assert.deepEqual(buildProbeHeaders('0.4.1'), { 'X-LS101-Client-Version': '0.4.1' })
  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  const schema = contract.operations.getInfo.parameters.find(
    (parameter) => parameter.name.toLowerCase() === 'x-ls101-client-version'
  ).schema
  const validate = new Ajv({ strict: false }).compile(schema)
  for (const rejected of ['', 'x'.repeat(schema.maxLength + 1), undefined, null, 42]) {
    assert.throws(() => buildProbeHeaders(rejected), /1 to 128 characters/)
    assert.equal(validate(rejected), false, `${JSON.stringify(rejected)} should be invalid`)
  }
})
