/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { createHash, randomBytes } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { after, before, describe, it } = require('node:test')

let formatReport
let parseAllowlist
let parseOptions
let verifyAllowlist

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ALLOWLIST_FILE = 'packages/airouter/src/main/index-tts-runtime.ts'
const PLATFORM = 'linux-x64'

const HELPER_NAME = 'ls101-index-tts-helper-cuda'
const LIBRARY_NAME = 'libaudiocpp.so.0'

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** A minimal `index-tts-runtime.ts`-shaped fixture. */
function allowlistSource(platform, digests) {
  return [
    '// fixture for scripts/__tests__/verify-allowlist.test.js',
    'export const INDEX_TTS_HELPER_SHA256: Record<string, readonly string[]> = {',
    `  '${platform}': [`,
    ...digests.map((digest) => `    '${digest}',`),
    '  ]',
    '}',
    ''
  ].join('\n')
}

describe('index-tts runtime allowlist gate', () => {
  let root
  let runtimeDirectory
  let fixtureAllowlistPath
  let digests

  before(async () => {
    ;({ formatReport, parseAllowlist, parseOptions, verifyAllowlist } =
      await import('../index-tts/verify-allowlist.mjs'))
    root = await mkdtemp(path.join(tmpdir(), 'index-tts-allowlist-'))
    runtimeDirectory = path.join(root, 'externals/ai/index-tts/runtime', PLATFORM)
    fixtureAllowlistPath = path.join(root, 'index-tts-runtime.fixture.ts')
    await mkdir(path.join(runtimeDirectory, 'not-a-file'), { recursive: true })

    // Random bytes: the digests are unique to this run, so the real allowlist can never match them.
    const payloads = {
      [HELPER_NAME]: randomBytes(48),
      [LIBRARY_NAME]: randomBytes(96)
    }
    for (const [name, payload] of Object.entries(payloads)) {
      await writeFile(path.join(runtimeDirectory, name), payload)
    }
    digests = Object.fromEntries(
      Object.entries(payloads).map(([name, payload]) => [name, sha256(payload)])
    )
    await writeFile(
      fixtureAllowlistPath,
      allowlistSource(PLATFORM, [digests[HELPER_NAME], digests[LIBRARY_NAME]])
    )
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const verify = (overrides = {}) =>
    verifyAllowlist({ root, platform: PLATFORM, allowlistPath: fixtureAllowlistPath, ...overrides })

  /** Writes one allowlist fixture and returns its path. */
  async function writeAllowlist(name, digestsOnList) {
    const allowlistPath = path.join(root, `${name}.ts`)
    await writeFile(allowlistPath, allowlistSource(PLATFORM, digestsOnList))
    return allowlistPath
  }

  it('scans every file in the staged runtime directory, skipping subdirectories', async () => {
    const result = await verify()
    assert.equal(result.platform, PLATFORM)
    assert.equal(result.directory, runtimeDirectory)
    assert.deepEqual(
      result.assets.map((asset) => asset.name),
      [LIBRARY_NAME, HELPER_NAME]
    )
    for (const asset of result.assets) {
      assert.equal(asset.digest, digests[asset.name])
      assert.ok(asset.size > 0)
    }
  })

  it('parses --platform and the value-less flags', () => {
    assert.deepEqual(parseOptions(['--platform', 'linux-x64']), { platform: 'linux-x64' })
    assert.deepEqual(parseOptions(['--platform', 'linux-x64', '--report']), {
      platform: 'linux-x64',
      report: true
    })
    assert.deepEqual(parseOptions(['--report', '--platform', 'win32-x64']), {
      platform: 'win32-x64',
      report: true
    })
    assert.deepEqual(parseOptions(['--report']), { report: true })
    assert.deepEqual(parseOptions(['--help']), { help: true })
    assert.deepEqual(parseOptions(['-h']), { help: true })
    assert.throws(() => parseOptions(['--unknown']), /未知参数：--unknown/)
  })

  it('refuses --platform consumed from another option', () => {
    for (const argv of [
      ['--platform'],
      ['--platform', ''],
      ['--platform', '--report'],
      ['--platform', '--'],
      ['--platform', '-h']
    ]) {
      assert.throws(
        () => parseOptions(argv),
        (error) => {
          assert.match(error.message, /--platform 缺少取值/)
          return true
        },
        `expected ${JSON.stringify(argv)} to be rejected`
      )
    }
  })

  it('never lets a value-less flag swallow the next argument', () => {
    // --platform is the only value-taking option in this script; the boolean flags must stay boolean.
    assert.deepEqual(parseOptions(['--report', '--help']), { report: true, help: true })
    assert.deepEqual(parseOptions(['-h', '--report']), { report: true, help: true })
    assert.deepEqual(parseOptions(['--report', '--platform', 'darwin-arm64']), {
      platform: 'darwin-arm64',
      report: true
    })
  })

  it('fails closed on an empty allowlist', async () => {
    const result = await verify({ allowlistPath: await writeAllowlist('empty', []) })
    assert.equal(result.ok, false)
    assert.deepEqual(
      result.assets.map((asset) => asset.allowed),
      [false, false]
    )
  })

  it('fails when only the helper is allowlisted but a co-located library is not', async () => {
    // The exact hole the gate exists to keep closed: a byte-identical helper next to a trojanised
    // shared library must not pass.
    const result = await verify({
      allowlistPath: await writeAllowlist('helper-only', [digests[HELPER_NAME]])
    })
    const byName = Object.fromEntries(result.assets.map((asset) => [asset.name, asset]))
    assert.equal(byName[HELPER_NAME].allowed, true)
    assert.equal(byName[LIBRARY_NAME].allowed, false)
    assert.equal(result.ok, false)
  })

  it('passes when every runtime file is allowlisted', async () => {
    const result = await verify()
    assert.equal(result.ok, true)
    assert.deepEqual(
      result.assets.map((asset) => asset.allowed),
      [true, true]
    )
  })

  it('emits a paste-ready INDEX_TTS_HELPER_SHA256 block with one digest per file', async () => {
    // The report is generated from the failing state, so it must carry every runtime digest.
    const result = await verify({
      allowlistPath: await writeAllowlist('helper-only', [digests[HELPER_NAME]])
    })
    const report = formatReport(result)

    assert.ok(report.includes('INDEX_TTS_HELPER_SHA256'))
    assert.ok(report.includes(`'${PLATFORM}': [`))
    assert.match(report, /allowlisted: no \(1\/2\)/)
    for (const [name, digest] of Object.entries(digests)) {
      assert.ok(report.includes(`'${digest}', // ${name}`), `block is missing ${name}`)
      assert.ok(report.includes(`| ${name} | `))
    }
    const digestLines = report.split('\n').filter((line) => /^\s*'[0-9a-f]{64}', \/\/ /.test(line))
    assert.equal(digestLines.length, Object.keys(digests).length)
  })

  it('fails with the Chinese message when the runtime directory is missing', async () => {
    await assert.rejects(
      () => verify({ runtimeDirectory: path.join(root, 'no-such-runtime') }),
      /缺少 IndexTTS 运行时目录/
    )
  })

  it('fails with the Chinese message when the runtime directory is empty', async () => {
    const emptyDirectory = path.join(root, 'empty-runtime')
    await mkdir(emptyDirectory, { recursive: true })
    await assert.rejects(() => verify({ runtimeDirectory: emptyDirectory }), /运行期目录为空/)
  })

  it('parses the real airouter runtime allowlist', async () => {
    const source = await readFile(path.join(REPO_ROOT, ALLOWLIST_FILE), 'utf8')
    // A rename of the constant would silently make the gate match nothing; fail loudly instead.
    assert.ok(source.includes('INDEX_TTS_HELPER_SHA256'))

    const parsed = parseAllowlist(source)
    assert.equal(typeof parsed, 'object')
    for (const [platform, values] of Object.entries(parsed)) {
      assert.match(platform, /^[a-z0-9]+-[a-z0-9]+$/)
      assert.ok(Array.isArray(values) && values.length > 0)
      for (const digest of values) assert.match(digest, /^[0-9a-f]{64}$/)
    }

    // The gate must fail closed against the real file for binaries it does not know.
    const result = await verify({ allowlistPath: path.join(REPO_ROOT, ALLOWLIST_FILE) })
    assert.equal(result.ok, false)
    assert.deepEqual(
      result.assets.map((asset) => asset.allowed),
      [false, false]
    )
  })
})
