const assert = require('node:assert/strict')
const test = require('node:test')
const { copyFile, chmod, mkdtemp, readFile, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createRequire } = require('node:module')

const modulePromise = import('../lab/prepare-archive-engine.mjs')
const serverRequire = createRequire(join(__dirname, '../../packages/lab-server/package.json'))

test('archive engine setup repairs package permissions, preserves bytes and supports read-only verification', async () => {
  const { prepareArchiveEngine } = await modulePromise
  const root = await mkdtemp(join(tmpdir(), 'ls101-archive-engine-'))
  const engine = join(root, process.platform === 'win32' ? '7za.exe' : '7za')
  try {
    await copyFile(serverRequire('7zip-bin').path7za, engine)
    const original = await readFile(engine)
    if (process.platform !== 'win32') {
      await chmod(engine, 0o644)
      await assert.rejects(prepareArchiveEngine({ engine, check: true }), /EACCES/)
      assert.equal((await stat(engine)).mode & 0o777, 0o644)
    }
    await prepareArchiveEngine({ engine })
    await prepareArchiveEngine({ engine, check: true })
    await prepareArchiveEngine({ engine })
    assert.deepEqual(await readFile(engine), original)
    if (process.platform !== 'win32') assert.equal((await stat(engine)).mode & 0o777, 0o755)
    await assert.rejects(
      prepareArchiveEngine({ engine: join(root, 'missing') }),
      /Lab archive engine is unavailable:.*ENOENT/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
