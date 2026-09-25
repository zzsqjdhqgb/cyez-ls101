const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, mkdir, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')
const modulePromise = import('../lab/download-service-assets.mjs')

async function fixture(t) {
  const api = await modulePromise
  const root = await mkdtemp(join(tmpdir(), 'ls101-service-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = Buffer.from('verified service wrapper fixture')
  const asset = {
    ...api.WINSW_ASSET,
    url: 'https://example.test/WinSW.NET461.exe',
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
  const filename = api.serviceWrapperPath(root, asset)
  await mkdir(dirname(filename), { recursive: true })
  return {
    ...api,
    root,
    bytes,
    asset,
    filename,
    options: { root, platform: 'win32', asset, retryDelayMs: 0 }
  }
}

test('non-Windows setup skips the Windows asset without network access', async () => {
  const { setupServiceAssets } = await modulePromise
  assert.equal(
    await setupServiceAssets([], {
      platform: 'linux',
      fetch: () => assert.fail('unexpected download')
    }),
    'skipped'
  )
  await assert.rejects(setupServiceAssets(['--unknown']), /未知参数/)
})

test('setup downloads once and subsequent setup and build reads work offline', async (t) => {
  const f = await fixture(t)
  let requests = 0
  const options = {
    ...f.options,
    fetch: async () => {
      requests++
      return new Response(f.bytes)
    }
  }
  assert.equal(await f.setupServiceAssets([], options), 'downloaded')
  options.fetch = () => assert.fail('cached assets must work offline')
  assert.equal(await f.setupServiceAssets([], options), 'verified')
  assert.equal(await f.setupServiceAssets(['--verify'], options), 'verified')
  assert.deepEqual(await f.readServiceWrapper(f.root, f.asset), f.bytes)
  assert.equal(requests, 1)
})

test('build reads reject absent or corrupt assets and direct the user to setup', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.readServiceWrapper(f.root, f.asset), /yarn setup/)
  await writeFile(f.filename, 'corrupted wrapper')
  await assert.rejects(f.readServiceWrapper(f.root, f.asset), /构建不会下载资产/)
  assert.equal(
    await f.setupServiceAssets([], { ...f.options, fetch: async () => new Response(f.bytes) }),
    'downloaded'
  )
  assert.deepEqual(await f.readServiceWrapper(f.root, f.asset), f.bytes)
})

test('setup retries connection resets and interrupted response bodies', async (t) => {
  const f = await fixture(t)
  let requests = 0
  await f.setupServiceAssets([], {
    ...f.options,
    fetch: async () => {
      requests++
      const error = new TypeError('fetch failed', {
        cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
      })
      if (requests === 1) throw error
      if (requests === 2)
        return new Response(new ReadableStream({ start: (controller) => controller.error(error) }))
      return new Response(f.bytes)
    }
  })
  assert.equal(requests, 3)
  assert.deepEqual(await f.readServiceWrapper(f.root, f.asset), f.bytes)
})

test('failed downloads report the asset, recovery command and network cause', async (t) => {
  const f = await fixture(t)
  let requests = 0
  await assert.rejects(
    f.setupServiceAssets([], {
      ...f.options,
      fetch: async () => {
        requests++
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
      }
    }),
    (error) => {
      assert.match(error.message, /ECONNRESET/)
      assert.match(error.message, /HTTPS_PROXY/)
      assert.ok(error.message.includes(f.filename))
      assert.ok(error.message.includes(f.asset.url))
      return true
    }
  )
  assert.equal(requests, 3)
  assert.deepEqual(await readdir(dirname(f.filename)), [])
})

test('checksum failures never publish downloaded bytes or discard a verified cache', async (t) => {
  const f = await fixture(t)
  const options = { ...f.options, fetch: async () => new Response('tampered executable') }
  await assert.rejects(f.setupServiceAssets([], options), /SHA-256/)
  assert.deepEqual(await readdir(dirname(f.filename)), [])
  await writeFile(f.filename, f.bytes)
  await assert.rejects(f.setupServiceAssets(['--verify-upstream'], options), /SHA-256/)
  assert.deepEqual(await readFile(f.filename), f.bytes)
})

test('explicit upstream verification downloads and checks the pinned release again', async (t) => {
  const f = await fixture(t)
  await writeFile(f.filename, f.bytes)
  let requests = 0
  assert.equal(
    await f.setupServiceAssets(['--verify-upstream'], {
      ...f.options,
      fetch: async () => {
        requests++
        return new Response(f.bytes)
      }
    }),
    'downloaded'
  )
  assert.equal(requests, 1)
  assert.deepEqual(await readdir(dirname(f.filename)), [f.asset.filename])
})
