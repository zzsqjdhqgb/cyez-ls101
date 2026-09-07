import { randomBytes, randomUUID } from 'node:crypto'
import { LabDatabase } from './database'
import { equalSecret, hash, passwordHash } from './identity'
import { LabError, requireCondition } from './errors'

export type Principal =
  | { role: 'teacher'; revision: number; hash: string }
  | { role: 'student'; deviceId: string; credentialId: string; hash: string }

export class Security {
  private readonly localProofs = new Map<string, number>()
  constructor(
    private readonly db: LabDatabase,
    private readonly now: () => number
  ) {}

  async initialize(password: string): Promise<void> {
    const salt = randomBytes(32).toString('hex')
    const derived = await passwordHash(password, salt)
    this.db.transaction(() => this.db.run('INSERT INTO security VALUES (1,1,?,?)', salt, derived))
  }

  issueLocalProof(): string {
    const token = randomBytes(32).toString('base64url')
    for (const [key, expiration] of this.localProofs)
      if (expiration <= this.now()) this.localProofs.delete(key)
    this.localProofs.set(hash(token), this.now() + 30000)
    return token
  }

  revision(): number {
    return this.db.get<{ revision: number }>('SELECT revision FROM security WHERE singleton=1')!
      .revision
  }

  async login(
    input: { password?: string },
    localProof?: string,
    loopback = false
  ): Promise<{ token: string; expiresAt: string }> {
    requireCondition(Boolean(input.password) !== Boolean(localProof), 'AUTH_REQUIRED')
    const security = this.db.get<{ revision: number; salt: string; hash: string }>(
      'SELECT * FROM security WHERE singleton=1'
    )!
    if (localProof) {
      const key = hash(localProof)
      const expiry = this.localProofs.get(key) ?? 0
      this.localProofs.delete(key)
      requireCondition(loopback && expiry > this.now(), 'AUTH_REQUIRED')
    } else {
      requireCondition(
        equalSecret(await passwordHash(input.password!, security.salt), security.hash),
        'AUTH_REQUIRED'
      )
    }
    const token = `t.${randomBytes(32).toString('base64url')}`
    const expiration = this.now() + 8 * 3600000
    this.db.transaction(() => {
      requireCondition(this.revision() === security.revision, 'TOKEN_REVOKED')
      this.db.run(
        'INSERT INTO teacher_sessions VALUES (?,?,?)',
        hash(token),
        security.revision,
        expiration
      )
    })
    return { token, expiresAt: new Date(expiration).toISOString() }
  }

  authenticate(token: string | undefined, role: 'teacher' | 'student'): Principal {
    requireCondition(token, 'AUTH_REQUIRED')
    if (role === 'teacher') {
      requireCondition(token.startsWith('t.'), 'AUTH_REQUIRED')
      const row = this.db.get<{ revision: number; expires_at: number }>(
        'SELECT * FROM teacher_sessions WHERE hash=?',
        hash(token)
      )
      requireCondition(row, 'AUTH_REQUIRED')
      requireCondition(row.revision === this.revision(), 'TOKEN_REVOKED')
      requireCondition(row.expires_at > this.now(), 'TOKEN_EXPIRED')
      return { role, revision: row.revision, hash: hash(token) }
    }
    const parts = token.split('.')
    requireCondition(
      parts.length === 3 && parts[0] === 'd' && /^[A-Za-z0-9_-]{43}$/.test(parts[2]),
      'AUTH_REQUIRED'
    )
    const row = this.db.get<{ id: string; hash: string }>(
      'SELECT id,hash FROM device_credentials WHERE device_id=? AND revoked_at IS NULL',
      parts[1]
    )
    requireCondition(row && equalSecret(row.hash, hash(parts[2])), 'TOKEN_REVOKED')
    return { role, deviceId: parts[1], credentialId: row.id, hash: row.hash }
  }

  recheck(principal: Principal): void {
    if (principal.role === 'teacher') {
      const session = this.db.get<{ revision: number; expires_at: number }>(
        'SELECT * FROM teacher_sessions WHERE hash=?',
        principal.hash
      )
      requireCondition(session && session.revision === this.revision(), 'TOKEN_REVOKED')
      requireCondition(session.expires_at > this.now(), 'TOKEN_EXPIRED')
    } else {
      const credential = this.db.get<{ revoked_at: number | null; hash: string }>(
        'SELECT * FROM device_credentials WHERE id=?',
        principal.credentialId
      )
      requireCondition(
        credential && credential.revoked_at === null && credential.hash === principal.hash,
        'TOKEN_REVOKED'
      )
    }
  }

  async changePassword(
    principal: Principal,
    expectedRevision: number,
    password: string
  ): Promise<number> {
    const salt = randomBytes(32).toString('hex')
    const derived = await passwordHash(password, salt)
    return this.db.transaction(() => {
      this.recheck(principal)
      const revision = this.revision()
      requireCondition(revision === expectedRevision, 'REVISION_CONFLICT', { revision })
      this.db.run(
        'UPDATE security SET revision=?,salt=?,hash=? WHERE singleton=1',
        revision + 1,
        salt,
        derived
      )
      return revision + 1
    })
  }

  createDeviceCredential(deviceId: string, secret: string): string {
    const id = randomUUID()
    this.db.run('INSERT INTO device_credentials VALUES (?,?,?,NULL)', id, deviceId, hash(secret))
    return id
  }

  logout(principal: Principal): void {
    if (principal.role !== 'teacher') throw new LabError('AUTH_REQUIRED')
    this.db.transaction(() =>
      this.db.run('DELETE FROM teacher_sessions WHERE hash=?', principal.hash)
    )
  }
}
