import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { compactVerify, importSPKI } from 'jose'
import { validateSchema, type Schema } from '@ls101/lab-contracts'
import { pinnedSocket, PinnedTransport, validateTarget, type TrustedTarget } from './transport'
import { loadJson, saveFile, SerialWrites } from './files'
import type { BindingSummary } from './shared'

interface ServerConnection extends TrustedTarget {
  serverId: string
  connectionSecret: string
}
interface ConnectionData {
  schemaVersion: 1
  current: ServerConnection
  previous: ServerConnection[]
}
interface RuntimeBinding {
  summary: BindingSummary
  secret: string
}

export function machineDataRoot(root: string, computerName = hostname()): string {
  return join(
    root,
    'machines',
    createHash('sha256').update(computerName.trim().toLowerCase()).digest('hex')
  )
}

export class BindingStore {
  private readonly writes = new SerialWrites()
  private readonly runtimeId = randomUUID()
  private sequence = 0
  private readonly sessions = new Map<string, RuntimeBinding>()
  private readonly computerName: string

  constructor(
    readonly root: string,
    readonly transport: PinnedTransport,
    computerName = hostname()
  ) {
    this.computerName = computerName.trim().toLowerCase()
    validateSchema('Hostname', this.computerName)
  }

  private async data(): Promise<ConnectionData | null> {
    const value = await loadJson<ConnectionData>(join(this.root, 'server-connection.json'))
    if (!value) return null
    if (value.schemaVersion !== 1 || !value.current || !Array.isArray(value.previous))
      throw new Error('Unsupported server connection configuration')
    for (const target of [value.current, ...value.previous]) {
      validateTarget(target)
      if (!target.serverId) throw new Error('Missing server identity')
      validateSchema('ConnectionSecret', target.connectionSecret)
    }
    return value
  }

  private async session(target: ServerConnection): Promise<RuntimeBinding> {
    const cached = this.sessions.get(target.serverId)
    if (cached) return cached
    const connected = await this.transport.open(target, 'public')
    try {
      const response = await this.transport.request(connected.connectionId, 'postStudentSessions', {
        body: {
          connectionSecret: target.connectionSecret,
          computerName: this.computerName,
          platform: process.platform,
          runtimeId: this.runtimeId
        }
      })
      if (response.status !== 200) throw new Error((response.body as Schema<'Error'>).error.code)
      const registered = response.body as Schema<'StudentSession'>
      const record: RuntimeBinding = {
        secret: registered.deviceSecret,
        summary: {
          serverId: target.serverId,
          baseUrl: target.baseUrl,
          fingerprint: target.fingerprint,
          deviceId: registered.deviceId,
          contextId: registered.contextId,
          generation: registered.runtimeGeneration,
          maintenanceLocked: true,
          versionMismatch: connected.info.releaseVersion !== this.transport.version
        }
      }
      this.sessions.set(target.serverId, record)
      return record
    } finally {
      await this.transport.close(connected.connectionId)
    }
  }

  async configured(): Promise<boolean> {
    return (await this.data()) !== null
  }

  async summary(): Promise<BindingSummary | null> {
    return this.writes.run(async () => {
      const data = await this.data()
      return data ? { ...(await this.session(data.current)).summary } : null
    })
  }

  async connect(
    contextId?: string,
    serverId?: string
  ): Promise<{
    connectionId: string
    epoch: number
    info: Schema<'Info'>
    contextId: string
  }> {
    return this.writes.run(async () => {
      const data = await this.data()
      const target =
        data &&
        (serverId
          ? [data.current, ...data.previous].find((entry) => entry.serverId === serverId)
          : data.current)
      if (!target) throw new Error('Device is not bound')
      const record = await this.session(target)
      const connection = await this.transport.open(
        target,
        'student',
        `d.${record.summary.deviceId}.${record.secret}`
      )
      return { ...connection, contextId: contextId ?? record.summary.contextId }
    })
  }

  async enroll(file: string, administratorFingerprint?: string): Promise<BindingSummary> {
    return this.writes.run(async () => {
      const data = await this.data()
      if (Buffer.byteLength(file) > 64 * 1024) throw new Error('Enrollment file too large')
      const parts = file.trim().split('.')
      if (parts.length !== 3) throw new Error('Invalid enrollment file')
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        formatVersion: number
        purpose: string
        baseUrl: string
        serverId: string
        publicKeyFingerprint: string
      }
      const trusted =
        administratorFingerprint ??
        (data?.current.serverId === payload.serverId ? data.current.fingerprint : undefined)
      if (
        !trusted ||
        trusted !== payload.publicKeyFingerprint ||
        payload.formatVersion !== 1 ||
        payload.purpose !== 'ls101-device-enrollment'
      )
        throw new Error('Administrator-verified fingerprint required')
      const target = { baseUrl: payload.baseUrl, serverId: payload.serverId, fingerprint: trusted }
      const socket = await pinnedSocket(target)
      try {
        const certificate = new X509Certificate(socket.getPeerCertificate().raw)
        const publicKey = certificate.publicKey.export({ type: 'spki', format: 'pem' }).toString()
        const verified = await compactVerify(file.trim(), await importSPKI(publicKey, 'ES256'), {
          algorithms: ['ES256']
        })
        if (
          verified.protectedHeader.typ !== 'ls101-device-enrollment+jws' ||
          verified.protectedHeader.kid !== trusted ||
          Object.keys(verified.protectedHeader).some((key) => !['alg', 'typ', 'kid'].includes(key))
        )
          throw new Error('Invalid enrollment signature')
      } finally {
        socket.destroy()
      }
      const connected = await this.transport.open(target, 'public')
      try {
        if (connected.info.releaseVersion !== this.transport.version)
          throw new Error('VERSION_MISMATCH')
        const response = await this.transport.request(
          connected.connectionId,
          'postEnrollmentConnections',
          {
            body: {
              enrollmentFile: file.trim(),
              computerName: this.computerName,
              releaseVersion: this.transport.version
            }
          }
        )
        if (response.status !== 200) throw new Error((response.body as Schema<'Error'>).error.code)
        const current = { ...target, ...(response.body as Schema<'ServerConnection'>) }
        const previous = data
          ? [data.current, ...data.previous].filter((entry) => entry.serverId !== target.serverId)
          : []
        // This file must survive imaging onto another machine. Never use OS-bound encryption.
        await saveFile(
          join(this.root, 'server-connection.json'),
          JSON.stringify({ schemaVersion: 1, current, previous } satisfies ConnectionData)
        )
        this.sessions.delete(target.serverId)
        return { ...(await this.session(current)).summary }
      } finally {
        await this.transport.close(connected.connectionId)
      }
    })
  }

  async runtime(): Promise<{ runtimeId: string; runtimeGeneration: number; sequence: number }> {
    return this.writes.run(async () => {
      const data = await this.data()
      if (!data) throw new Error('Device is not bound')
      const record = await this.session(data.current)
      this.sequence++
      if (!Number.isSafeInteger(this.sequence)) throw new Error('Runtime sequence exhausted')
      return {
        runtimeId: this.runtimeId,
        runtimeGeneration: record.summary.generation,
        sequence: this.sequence
      }
    })
  }

  async observe(contextId: string, state: Schema<'StudentState'>): Promise<BindingSummary> {
    return this.writes.run(async () => {
      const data = await this.data()
      const record = data && this.sessions.get(data.current.serverId)
      if (
        !record ||
        record.summary.contextId !== contextId ||
        record.summary.serverId !== state.serverId ||
        record.summary.deviceId !== state.device.id
      )
        throw new Error('Stale binding state')
      record.summary.maintenanceLocked = state.mode === 'maintenance'
      record.summary.versionMismatch = state.releaseVersion !== this.transport.version
      return { ...record.summary }
    })
  }
}
