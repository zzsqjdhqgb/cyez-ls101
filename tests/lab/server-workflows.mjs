/* eslint-disable @typescript-eslint/explicit-function-return-type -- This is a plain JavaScript node:test entry. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import { request } from 'node:https'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { zipSync } from 'fflate'

const output = resolve('out/lab-server')
const node = join(output, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
const entry = join(output, 'server.cjs')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function command(root, operation, input) {
  const child = spawn(node, [entry, operation, '--data-dir', root], {
    cwd: tmpdir(),
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15000
  })
  const stdout = [],
    stderr = []
  child.stdout.on('data', (chunk) => stdout.push(chunk))
  child.stderr.on('data', (chunk) => stderr.push(chunk))
  child.stdin.end(input === undefined ? undefined : JSON.stringify(input))
  const [code] = await once(child, 'close')
  return { code, text: Buffer.concat(stdout).toString(), error: Buffer.concat(stderr).toString() }
}

test(
  'shipping CLI: real enrollment and submission survive shutdown and an independent restart',
  { timeout: 60000 },
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ls101-shipping-workflow-'))
    const root = join(parent, 'data')
    const manifest = JSON.parse(await readFile(join(output, 'runtime-manifest.json'), 'utf8'))
    let child, exited, lines
    const start = async () => {
      child = spawn(node, [entry, 'serve', '--data-dir', root], {
        cwd: tmpdir(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-16000)
      })
      exited = once(child, 'close')
      lines = createInterface({ input: child.stdout })
      const timer = setTimeout(() => child.kill(), 15000)
      try {
        return await Promise.race([
          once(lines, 'line').then(([line]) => JSON.parse(line)),
          exited.then(() => {
            throw new Error(`Shipping service exited before readiness: ${stderr}`)
          })
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    const stop = async () => {
      const result = await command(root, 'shutdown')
      assert.equal(result.code, 0, result.error)
      const timer = setTimeout(() => child.kill(), 15000)
      try {
        assert.equal((await exited)[0], 0)
      } finally {
        clearTimeout(timer)
        lines.close()
      }
    }
    try {
      assert.equal((await start()).state, 'uninitialized')
      // A valid production-format receipt; no activation bypass is compiled into server.cjs.
      await writeFile(
        join(root, 'license.json'),
        JSON.stringify({
          schemaVersion: 1,
          invitationCodeHash: '487c1f4d73f9cef0a13ae59eee14a604f67f93c307c89ecdf69b4f20fca0ff3d',
          activatedAt: new Date().toISOString()
        }),
        { mode: 0o600 }
      )
      const listener = createServer()
      listener.listen(0, '127.0.0.1')
      await once(listener, 'listening')
      const port = listener.address().port
      await new Promise((done) => listener.close(done))
      const initialized = await command(root, 'initialize', {
        name: 'Shipping workflow',
        baseUrl: `https://127.0.0.1:${port}/`,
        password: 'shipping-secret',
        config: { schemaVersion: 1, port, host: '127.0.0.1' }
      })
      assert.equal(initialized.code, 0, initialized.error)
      const serverId = JSON.parse(initialized.text).info.serverId
      const certificate = await readFile(join(root, 'identity/certificate.pem'))
      const api = (method, path, { token, body, bytes, headers = {} } = {}) =>
        new Promise((done, fail) => {
          const data = bytes ?? (body === undefined ? undefined : Buffer.from(JSON.stringify(body)))
          const call = request(
            {
              host: '127.0.0.1',
              port,
              path: `/api/v1${path}`,
              method,
              ca: certificate,
              checkServerIdentity: () => undefined,
              agent: false,
              headers: {
                'x-ls101-client-version': manifest.releaseVersion,
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                ...(data ? { 'content-length': String(data.length) } : {}),
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                ...headers
              }
            },
            (response) => {
              const chunks = []
              response.on('error', fail)
              response.on('data', (chunk) => chunks.push(chunk))
              response.on('end', () => {
                const bytes = Buffer.concat(chunks)
                try {
                  done({
                    status: response.statusCode,
                    bytes,
                    body: response.headers['content-type']?.includes('application/json')
                      ? JSON.parse(bytes.toString())
                      : bytes.toString()
                  })
                } catch (error) {
                  fail(error)
                }
              })
            }
          )
          call.setTimeout(10000, () => call.destroy(new Error(`Request timeout: ${path}`)))
          call.on('error', fail)
          call.end(data)
        })
      const teacher = (
        await api('POST', '/teacher/sessions', { body: { password: 'shipping-secret' } })
      ).body.token
      assert.ok(teacher)
      const batch = await api('POST', '/teacher/enrollments', {
        token: teacher,
        body: { expectedModeRevision: 1 },
        headers: { 'idempotency-key': randomUUID() }
      })
      assert.equal(batch.status, 201)
      const file = await api('GET', `/teacher/enrollments/${batch.body.enrollment.id}/file`, {
        token: teacher
      })
      const secret = randomBytes(32).toString('base64url')
      const enrolled = await api('PUT', `/enrollment/devices/${randomUUID()}`, {
        body: {
          enrollmentFile: file.body,
          deviceSecret: secret,
          computerName: 'shipping-student',
          platform: process.platform,
          releaseVersion: manifest.releaseVersion
        }
      })
      assert.equal(enrolled.status, 201)
      const student = `d.${enrolled.body.deviceId}.${secret}`
      assert.equal(
        (
          await api('DELETE', `/teacher/enrollments/${batch.body.enrollment.id}`, {
            token: teacher
          })
        ).status,
        204
      )
      const packageId = randomUUID()
      const template = {
        format: 'ls101-submission',
        formatVersion: 1,
        meta: { examPackageId: packageId, examTitle: 'Shipping exam' },
        schemaUses: [],
        resources: {}
      }
      const exam = {
        format: 'ls101-exam',
        formatVersion: 1,
        packageId,
        examData: {
          title: 'Shipping exam',
          player: {
            pages: [{ id: 'one', content: [], timeline: [{ type: 'countdown', seconds: 1 }] }],
            recordingIndices: []
          },
          resources: {}
        },
        answerCapturePlan: { strings: [], audios: [] },
        submissionTemplate: template
      }
      const archive = (value) => zipSync({ 'manifest.json': Buffer.from(JSON.stringify(value)) })
      const examBytes = archive(exam)
      const upload = (token, bytes, kind) => ({
        token,
        bytes,
        headers: {
          'content-type': `application/x-ls101-${kind}`,
          'x-ls101-archive-sha256': hash(bytes)
        }
      })
      const imported = await api('POST', '/teacher/exams', upload(teacher, examBytes, 'exam'))
      assert.equal(imported.status, 201)
      const state = await api('GET', '/teacher/service', { token: teacher })
      assert.equal(
        (
          await api('PUT', '/teacher/service/mode', {
            token: teacher,
            body: { mode: 'normal', expectedRevision: state.body.modeRevision }
          })
        ).status,
        200
      )
      const id = randomUUID(),
        candidate = { candidateId: '001', displayName: 'Shipping student' }
      assert.equal(
        (
          await api('PUT', `/student/practices/${id}`, {
            token: student,
            body: { examId: imported.body.examId, archiveSha256: hash(examBytes), candidate }
          })
        ).status,
        201
      )
      const submissionBytes = archive({
        ...template,
        meta: {
          ...template.meta,
          submissionId: id,
          candidate,
          startedAt: new Date().toISOString(),
          submittedAt: new Date().toISOString()
        },
        answers: { strings: [], audios: [] }
      })
      const received = await api(
        'PUT',
        `/student/submissions/${id}`,
        upload(student, submissionBytes, 'submission')
      )
      assert.equal(received.status, 201)
      await stop()
      assert.equal((await start()).info.serverId, serverId)
      const replay = await api(
        'PUT',
        `/student/submissions/${id}`,
        upload(student, submissionBytes, 'submission')
      )
      assert.equal(replay.status, 200)
      assert.deepEqual(replay.body, received.body)
      const download = await api('GET', `/teacher/submissions/${id}/archive`, { token: teacher })
      assert.equal(download.status, 200)
      assert.equal(hash(download.bytes), hash(submissionBytes))
      assert.equal((await command(root, 'initialize', {})).code, 1)
      await stop()
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill()
      if (exited) await exited
      lines?.close()
      await rm(parent, { recursive: true, force: true })
    }
  }
)
