import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import { once } from 'node:events'

const output = resolve('out/lab-server')
const node = join(output, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
const entry = join(output, 'server.cjs')

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function command(root, operation, input) {
  const child = spawn(node, [entry, operation, '--data-dir', root], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: tmpdir()
  })
  const stdout = [],
    stderr = []
  child.stdout.on('data', (chunk) => stdout.push(chunk))
  child.stderr.on('data', (chunk) => stderr.push(chunk))
  child.stdin.end(input === undefined ? undefined : JSON.stringify(input))
  const [code] = await once(child, 'close')
  assert.equal(code, 0, Buffer.concat(stderr).toString())
  return JSON.parse(Buffer.concat(stdout).toString())
}

test(
  'bundled Node service boots outside the repository, enforces licensing, and stops cleanly',
  { timeout: 30000 },
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ls101-bundled-runtime-'))
    const root = join(parent, 'data')
    const child = spawn(node, [entry, 'serve', '--data-dir', root], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: tmpdir()
    })
    const exited = once(child, 'close')
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const lines = createInterface({ input: child.stdout })
    try {
      const first = await Promise.race([
        once(lines, 'line').then(([line]) => JSON.parse(line)),
        exited.then(() => {
          throw new Error(stderr)
        })
      ])
      assert.equal(first.state, 'uninitialized')
      assert.equal((await command(root, 'status')).license.state, 'not-activated')
      assert.equal((await command(root, 'activate', 'not-a-valid-code')).activated, false)
      const listener = createServer()
      listener.listen(0, '127.0.0.1')
      await once(listener, 'listening')
      const port = listener.address().port
      await new Promise((done) => listener.close(done))
      // Fixture receipt uses the production validation format; the packaged CLI has no test override.
      await writeFile(
        join(root, 'license.json'),
        JSON.stringify({
          schemaVersion: 1,
          invitationCodeHash: '487c1f4d73f9cef0a13ae59eee14a604f67f93c307c89ecdf69b4f20fca0ff3d',
          activatedAt: new Date().toISOString()
        }),
        { mode: 0o600 }
      )
      const initialized = await command(root, 'initialize', {
        name: 'Bundled lab',
        baseUrl: `https://127.0.0.1:${port}/`,
        password: 'private-test-password',
        config: { schemaVersion: 1, port, host: '127.0.0.1' }
      })
      assert.equal(initialized.info.readiness, 'ready')
      const manifest = JSON.parse(await readFile(join(output, 'runtime-manifest.json'), 'utf8'))
      assert.equal(manifest.nodeVersion, '24.20.0')
      assert.equal((await command(root, 'status')).info.serverId, initialized.info.serverId)
      assert.ok(!stderr.includes('private-test-password'))
    } finally {
      child.kill('SIGTERM')
      const [code] = await exited
      lines.close()
      await rm(parent, { recursive: true, force: true })
      assert.equal(code, 0, stderr)
    }
  }
)
