/*
 * Container-side tests for the guest acceptance helpers.
 *
 * These run in `yarn vm:test` and cover exactly the logic that used to live in PowerShell and could
 * only be exercised by a full VM rebuild. Every case marked "regression" below is a defect that
 * actually happened and cost a VM cycle to find.
 */
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')

const harness = import('../../infra/windows-vm/guest/lab-harness.mjs')
const directories = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workdir() {
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-harness-'))
  directories.push(root)
  return root
}

test('a single-line JSON payload is read, not its first character', async () => {
  const { extractJsonPayload } = await harness
  // Regression: the PowerShell reader indexed a scalar string, so `$lines[0]` was "{" and every
  // one-line payload failed with "No JSON payload was found".
  const payload = { state: 'uninitialized', license: { state: 'not-activated' } }
  assert.deepEqual(extractJsonPayload(JSON.stringify(payload)), payload)
  assert.deepEqual(extractJsonPayload(`${JSON.stringify(payload)}\n`), payload)
  assert.deepEqual(extractJsonPayload(`${JSON.stringify(payload)}\r\n`), payload)
})

test('the newest JSON line wins and surrounding noise is ignored', async () => {
  const { extractJsonPayload } = await harness
  const text = ['WARNING: something', '{"attempt":1}', 'more noise', '{"attempt":2}', ''].join(
    '\r\n'
  )
  assert.deepEqual(extractJsonPayload(text), { attempt: 2 })
  assert.throws(
    () => extractJsonPayload('no json here'),
    /No JSON payload was found[\s\S]*no json here/
  )
  assert.throws(() => extractJsonPayload(''), /No JSON payload was found/)
})

test('probe payloads are found by marker and survive pretty-printed neighbours', async () => {
  const { extractProbePayload, PROBE_PREFIX } = await harness
  const text = ['noise', '{\n  "pretty": true\n}', `${PROBE_PREFIX}{"acl":[1,2]}`, 'trailing'].join(
    '\r\n'
  )
  assert.deepEqual(extractProbePayload(text), { acl: [1, 2] })
  assert.throws(() => extractProbePayload('noise only'), /LS101PROBE/)
})

test('assertions refuse anything that is not a boolean', async () => {
  const { assertThat, AssertionError } = await harness
  assert.doesNotThrow(() => assertThat(true, 'ok'))
  assert.throws(() => assertThat(false, 'boom'), AssertionError)
  assert.throws(() => assertThat(false, 'boom'), /boom/)
  // Regression: PowerShell bound a one-item pipeline result (a bare string) to a [bool] parameter and
  // failed outright. Requiring a boolean keeps that decision at the call site.
  assert.throws(() => assertThat('NT AUTHORITY\\SYSTEM', 'match'), AssertionError)
  assert.throws(() => assertThat(['a'], 'match'), AssertionError)
  assert.throws(() => assertThat(undefined, 'missing'), AssertionError)
})

test('collection assertions behave the same for one match and for many', async () => {
  const { assertSome, assertNone } = await harness
  const entries = ['NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators', 'NT SERVICE\\LS101Lab']
  const isSystem = (entry) => entry.includes('SYSTEM')
  // Regression: one match and three matches must not take different paths.
  assert.doesNotThrow(() => assertSome(entries, isSystem, 'SYSTEM present'))
  assert.doesNotThrow(() => assertSome(['only one'], (item) => item === 'only one', 'single match'))
  assert.throws(
    () => assertSome(entries, (entry) => entry.includes('Users'), 'no Users'),
    /no Users/
  )
  assert.throws(() => assertSome([], isSystem, 'empty'), /empty/)
  assert.doesNotThrow(() => assertNone(entries, (entry) => entry.includes('Users'), 'no Users'))
  assert.throws(() => assertNone(entries, isSystem, 'SYSTEM absent'), /SYSTEM absent/)
})

test('a one-element array from PowerShell is normalised before it is asserted on', async () => {
  const { asArray } = await harness
  // Regression risk: ConvertTo-Json in PowerShell 5.1 unwraps a one-element array, so the same probe
  // returned a different shape depending on how many items it found.
  assert.deepEqual(asArray({ port: 8443 }), [{ port: 8443 }])
  assert.deepEqual(asArray([{ port: 8443 }]), [{ port: 8443 }])
  assert.deepEqual(asArray([]), [])
  assert.deepEqual(asArray(null), [])
  assert.deepEqual(asArray(undefined), [])
})

test('guest text is decoded whatever encoding PowerShell wrote', async () => {
  const { decodeGuestText } = await harness
  const text = '{"state":"ok"}'
  assert.equal(decodeGuestText(Buffer.from(text, 'utf8')), text)
  assert.equal(
    decodeGuestText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])),
    text
  )
  assert.equal(
    decodeGuestText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])),
    text
  )
  assert.equal(decodeGuestText(Buffer.from(text, 'utf16le')), text)
  assert.equal(decodeGuestText(text), text)
})

test('a configuration is validated before anything reads a field from it', async () => {
  const { parseConfig, REQUIRED_CONFIG_KEYS } = await harness
  const complete = Object.fromEntries(REQUIRED_CONFIG_KEYS.map((key) => [key, `${key}-value`]))
  assert.deepEqual(parseConfig(JSON.stringify(complete)), complete)
  assert.throws(() => parseConfig('not json'), /not valid JSON/)
  assert.throws(() => parseConfig('[1,2]'), /must be a JSON object/)
  assert.throws(() => parseConfig('null'), /must be a JSON object/)
  // Regression: a missing key used to surface much later as a null path argument somewhere unrelated.
  const incomplete = { ...complete }
  delete incomplete.dataRoot
  delete incomplete.probes
  // The message lists them in the declared order, so it is stable to assert on.
  assert.throws(() => parseConfig(JSON.stringify(incomplete)), /missing: probes, dataRoot$/)
})

test('process results carry the exit code and both streams without throwing', async () => {
  const { runProcess } = await harness
  const success = await runProcess(process.execPath, ['-e', 'process.stdout.write("out")'])
  assert.equal(success.code, 0)
  assert.equal(success.stdout, 'out')
  const failure = await runProcess(process.execPath, [
    '-e',
    'process.stderr.write("bad"); process.exit(3)'
  ])
  assert.equal(failure.code, 3)
  assert.equal(failure.stderr, 'bad')
  // Native tools write progress to stderr; that must never be treated as a failure by itself.
  const noisy = await runProcess(process.execPath, [
    '-e',
    'process.stderr.write("warn"); process.stdout.write("ok")'
  ])
  assert.equal(noisy.code, 0)
  assert.equal(noisy.stdout, 'ok')
  const withInput = await runProcess(
    process.execPath,
    ['-e', 'process.stdin.pipe(process.stdout)'],
    { input: 'piped' }
  )
  assert.equal(withInput.stdout, 'piped')
})

test('a hanging command is bounded and reported as timed out', async () => {
  const { runProcess } = await harness
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    timeoutMs: 500
  })
  assert.equal(result.timedOut, true)
  assert.notEqual(result.code, 0)
})

test('the run publishes its phase before it starts and records the outcome', async () => {
  const { LabRun } = await harness
  const directory = await workdir()
  const run = new LabRun(directory)
  await run.step('first', async () => {})
  const findings = await run.step('with-value', async () => ({ pid: 3644 }))
  assert.deepEqual(findings, { pid: 3644 })
  await assert.rejects(
    run.step('second', async () => {
      throw new Error('nope')
    }),
    /nope/
  )
  run.finish()
  run.status('failed')

  const progress = await readFile(path.join(directory, 'lab-progress.txt'), 'utf8')
  assert.match(progress, /first/)
  assert.match(progress, /second/)
  const results = JSON.parse(await readFile(path.join(directory, 'lab-results.json'), 'utf8'))
  assert.equal(results.first.status, 'passed')
  assert.deepEqual(results['with-value'].value, { pid: 3644 })
  assert.equal(results.second.status, 'failed')
  assert.match(results.second.error, /nope/)
  assert.ok(results.finishedAt)
  assert.equal(await readFile(path.join(directory, 'lab-status.txt'), 'utf8'), 'failed')
})

test('the start-up record is written from literals so it survives a broken configuration', async () => {
  const { writeStartupRecord } = await harness
  const directory = await workdir()
  const record = writeStartupRecord(directory, 'C:\\does\\not\\exist.json')
  const text = await readFile(record, 'utf8')
  assert.match(text, /configExists=false/)
  assert.match(text, /configBytes=0/)
  assert.match(text, new RegExp(`node=${process.version.replaceAll('.', '\\.')}`))
  assert.match(text, /configArgument=C:\\does\\not\\exist\.json/)
})

test('command line arguments are read strictly', async () => {
  const { readArgument } = await harness
  assert.equal(readArgument(['--config', 'C:\\a.json'], '--config'), 'C:\\a.json')
  assert.equal(readArgument(['--other'], '--config'), undefined)
  assert.throws(() => readArgument(['--config'], '--config'), /requires a value/)
  assert.throws(() => readArgument(['--config', '--other'], '--config'), /requires a value/)
})
