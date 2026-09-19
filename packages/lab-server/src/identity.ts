import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  scrypt as deriveKey,
  X509Certificate
} from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CompactSign,
  compactVerify,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  importSPKI
} from 'jose'
import {
  X509CertificateGenerator,
  BasicConstraintsExtension,
  KeyUsagesExtension,
  KeyUsageFlags,
  ExtendedKeyUsageExtension,
  ExtendedKeyUsage
} from '@peculiar/x509'
import { durableWrite } from './durable-files'
import { LabError } from './errors'

const ENROLLMENT_TYPE = 'ls101-device-enrollment+jws'
export interface EnrollmentPayload {
  formatVersion: 1
  purpose: 'ls101-device-enrollment'
  serverId: string
  baseUrl: string
  publicKeyFingerprint: string
  enrollmentId: string
  issuedAt: string
  expiresAt: string
  enrollmentSecret: string
}

export class ServerIdentity {
  private constructor(
    readonly serverId: string,
    readonly certificate: string,
    readonly privatePem: string,
    readonly publicPem: string,
    readonly fingerprint: string
  ) {}

  static async create(root: string, now = Date.now()): Promise<ServerIdentity> {
    const id = randomUUID()
    const pair = await generateKeyPair('ES256', { extractable: true })
    const certificate = await X509CertificateGenerator.createSelfSigned({
      serialNumber: randomBytes(16).toString('hex'),
      name: `CN=LS101 Lab ${id}`,
      notBefore: new Date(now - 86400000),
      notAfter: new Date(now + 3650 * 86400000),
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth])
      ],
      keys: pair
    })
    const directory = join(root, 'identity')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await durableWrite(join(directory, 'key.pem'), await exportPKCS8(pair.privateKey))
    await durableWrite(join(directory, 'certificate.pem'), certificate.toString('pem'))
    await durableWrite(join(directory, 'server-id'), id)
    await durableWrite(join(directory, 'idempotency.key'), randomBytes(32))
    return ServerIdentity.load(root)
  }

  static async load(root: string): Promise<ServerIdentity> {
    const directory = join(root, 'identity')
    const [id, privatePem, certificate] = await Promise.all([
      readFile(join(directory, 'server-id'), 'utf8'),
      readFile(join(directory, 'key.pem'), 'utf8'),
      readFile(join(directory, 'certificate.pem'), 'utf8')
    ])
    const cert = new X509Certificate(certificate)
    const publicPem = cert.publicKey.export({ format: 'pem', type: 'spki' }).toString()
    const key = await importPKCS8(privatePem, 'ES256', { extractable: true })
    const proof = await new CompactSign(new TextEncoder().encode(id))
      .setProtectedHeader({ alg: 'ES256' })
      .sign(key)
    await compactVerify(proof, await importSPKI(publicPem, 'ES256'))
    const fingerprint = `sha256:${hash(cert.publicKey.export({ type: 'spki', format: 'der' }))}`
    return new ServerIdentity(id, certificate, privatePem, publicPem, fingerprint)
  }

  async signEnrollment(payload: EnrollmentPayload): Promise<string> {
    return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
      .setProtectedHeader({ alg: 'ES256', typ: ENROLLMENT_TYPE, kid: this.fingerprint })
      .sign(await importPKCS8(this.privatePem, 'ES256'))
  }

  async verifyEnrollment(file: string): Promise<EnrollmentPayload> {
    try {
      if (Buffer.byteLength(file) > 64 * 1024) throw new Error('Oversized enrollment')
      const { payload, protectedHeader } = await compactVerify(
        file,
        await importSPKI(this.publicPem, 'ES256'),
        { algorithms: ['ES256'] }
      )
      if (
        protectedHeader.typ !== ENROLLMENT_TYPE ||
        protectedHeader.kid !== this.fingerprint ||
        Object.keys(protectedHeader).some((key) => !['alg', 'typ', 'kid'].includes(key))
      )
        throw new Error('Invalid header')
      const result = JSON.parse(new TextDecoder().decode(payload)) as EnrollmentPayload
      if (
        result.formatVersion !== 1 ||
        result.purpose !== 'ls101-device-enrollment' ||
        result.serverId !== this.serverId ||
        result.publicKeyFingerprint !== this.fingerprint
      )
        throw new Error('Invalid identity')
      return result
    } catch {
      throw new LabError('ENROLLMENT_REJECTED')
    }
  }
}

export function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function passwordHash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    deriveKey(
      password,
      Buffer.from(salt, 'hex'),
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key.toString('hex')))
    )
  })
}
