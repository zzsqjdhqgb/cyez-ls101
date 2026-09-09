import { createServer } from 'node:https'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { X509CertificateGenerator, BasicConstraintsExtension } from '@peculiar/x509'
import { exportPKCS8, generateKeyPair } from 'jose'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { PinnedTransport } from '../transport'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action()
})

it('does not transmit HTTP headers or credentials when the SPKI pin is wrong', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ls101-pin-'))
  cleanup.push(() => rm(root, { force: true, recursive: true }))
  const keys = await generateKeyPair('ES256', { extractable: true })
  const certificate = (
    await X509CertificateGenerator.createSelfSigned({
      serialNumber: '01',
      name: 'CN=Lab transport test',
      notBefore: new Date(Date.now() - 60000),
      notAfter: new Date(Date.now() + 60000),
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      keys,
      extensions: [new BasicConstraintsExtension(false, undefined, true)]
    })
  ).toString('pem')
  const identity = {
    serverId: randomUUID(),
    certificate,
    privatePem: await exportPKCS8(keys.privateKey),
    fingerprint: `sha256:${createHash('sha256')
      .update(new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')}`
  }
  const received: string[] = []
  const server = createServer(
    { key: identity.privatePem, cert: identity.certificate },
    (request, response) => {
      received.push(request.headers.authorization ?? 'anonymous')
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          serverId: identity.serverId,
          name: 'Lab',
          apiVersion: 1,
          releaseVersion: 'test',
          serverTime: new Date().toISOString(),
          readiness: 'ready'
        })
      )
    }
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  )
  const port = (server.address() as { port: number }).port
  const transport = new PinnedTransport(join(root, 'downloads'), 'test')
  await expect(
    transport.open(
      { baseUrl: `https://127.0.0.1:${port}/`, fingerprint: `sha256:${'0'.repeat(64)}` },
      'student',
      'secret-device-token'
    )
  ).rejects.toThrow('public key')
  expect(received).toEqual([])
  const opened = await transport.open(
    { baseUrl: `https://127.0.0.1:${port}/`, fingerprint: identity.fingerprint },
    'student',
    'secret-device-token'
  )
  expect(opened.info.serverId).toBe(identity.serverId)
  expect(received).toEqual(['anonymous'])
  await transport.initialize()
  const original = join(root, 'original.lssubmission')
  const temporary = join(transport.directory, randomUUID())
  await writeFile(original, 'formal submission')
  await writeFile(temporary, 'temporary download')
  const archive = await transport.registerArchive(opened.connectionId, original)
  await transport.registerArchive(opened.connectionId, temporary)
  await transport.close(opened.connectionId)
  expect(() => transport.file(archive.handle)).toThrow('Invalid archive handle')
  expect(await readFile(original, 'utf8')).toBe('formal submission')
  await expect(readFile(temporary)).rejects.toMatchObject({ code: 'ENOENT' })
})
