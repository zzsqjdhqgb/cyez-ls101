import { randomBytes, randomUUID, X509Certificate } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { compactVerify, importSPKI } from 'jose'
import { pinnedSocket, PinnedTransport, type TrustedTarget } from './transport'
import { loadJson, saveFile, SerialWrites } from './files'
import type { BindingSummary } from './shared'
import type { Schema } from '@ls101/lab-contracts'

interface BindingRecord {
  summary: BindingSummary
  secret: string
  installationId: string
}
interface BindingData {
  schemaVersion: 1
  current: BindingRecord | null
  previous: BindingRecord[]
  installationId: string
  pending: { target: TrustedTarget; secret: string } | null
}
export class BindingStore {
  private readonly writes = new SerialWrites()
  private runtimeId = randomUUID()
  private sequence = 0
  private allocatedContext: string | null = null
  constructor(
    readonly root: string,
    readonly transport: PinnedTransport,
    private readonly codec: { encrypt(value: string): string; decrypt(value: string): string }
  ) {}

  private async data(): Promise<BindingData> {
    const value = await loadJson<BindingData>(join(this.root, 'binding.json'))
    if (value && value.schemaVersion !== 1) throw new Error('Unsupported binding data')
    return (
      value ?? {
        schemaVersion: 1,
        current: null,
        previous: [],
        installationId: randomUUID(),
        pending: null
      }
    )
  }
  private async save(data: BindingData): Promise<void> {
    await saveFile(join(this.root, 'binding.json'), JSON.stringify(data))
  }
  async summary(): Promise<BindingSummary | null> {
    return (await this.data()).current?.summary ?? null
  }

  async connect(
    contextId?: string
  ): Promise<{ connectionId: string; epoch: number; info: Schema<'Info'>; contextId: string }> {
    const data = await this.data()
    const record = contextId
      ? [data.current, ...data.previous].find((entry) => entry?.summary.contextId === contextId)
      : data.current
    if (!record) throw new Error('Device is not bound')
    const connection = await this.transport.open(
      {
        baseUrl: record.summary.baseUrl,
        fingerprint: record.summary.fingerprint,
        serverId: record.summary.serverId
      },
      'student',
      `d.${record.summary.deviceId}.${this.codec.decrypt(record.secret)}`
    )
    return { ...connection, contextId: record.summary.contextId }
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
        (data.current?.summary.serverId === payload.serverId
          ? data.current.summary.fingerprint
          : undefined)
      if (
        !trusted ||
        trusted !== payload.publicKeyFingerprint ||
        payload.formatVersion !== 1 ||
        payload.purpose !== 'ls101-device-enrollment'
      )
        throw new Error('Administrator-verified fingerprint required')
      const target: TrustedTarget = {
        baseUrl: payload.baseUrl,
        serverId: payload.serverId,
        fingerprint: trusted
      }
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
      const same = data.current?.summary.serverId === payload.serverId
      const pending =
        data.pending && JSON.stringify(data.pending.target) === JSON.stringify(target)
          ? data.pending
          : null
      let secret = pending
        ? this.codec.decrypt(pending.secret)
        : randomBytes(32).toString('base64url')
      if (same && !pending) {
        const currentSecret = this.codec.decrypt(data.current!.secret)
        const probe = await this.transport.open(
          target,
          'student',
          `d.${data.current!.summary.deviceId}.${currentSecret}`
        )
        try {
          const response = await this.transport.request(probe.connectionId, 'getStudentState', {})
          if (response.status === 200) secret = currentSecret
          else if (response.status !== 401)
            throw new Error('Current device credential could not be checked')
        } finally {
          await this.transport.close(probe.connectionId)
        }
      }
      data.pending = { target, secret: this.codec.encrypt(secret) }
      await this.save(data)
      const connected = await this.transport.open(target, 'public')
      try {
        if (connected.info.releaseVersion !== this.transport.version)
          throw new Error('VERSION_MISMATCH')
        const response = await this.transport.request(
          connected.connectionId,
          'putEnrollmentDevicesInstallationId',
          {
            path: { installationId: data.installationId },
            body: {
              enrollmentFile: file.trim(),
              deviceSecret: secret,
              computerName: hostname(),
              platform: process.platform,
              releaseVersion: this.transport.version
            }
          }
        )
        if (response.status >= 400) throw new Error((response.body as Schema<'Error'>).error.code)
        const registered = response.body as Schema<'RegisteredDevice'>
        if (
          same &&
          secret === this.codec.decrypt(data.current!.secret) &&
          data.current!.summary.deviceId === registered.deviceId &&
          response.status === 200
        ) {
          data.pending = null
          await this.save(data)
          return data.current!.summary
        }
        const summary: BindingSummary = {
          serverId: payload.serverId,
          baseUrl: payload.baseUrl,
          fingerprint: trusted,
          deviceId: registered.deviceId,
          contextId: randomUUID(),
          generation: 0,
          maintenanceLocked: true,
          versionMismatch: false
        }
        if (data.current) data.previous.push(data.current)
        data.current = {
          summary,
          secret: this.codec.encrypt(secret),
          installationId: data.installationId
        }
        data.pending = null
        await this.save(data)
        this.allocatedContext = null
        return summary
      } finally {
        await this.transport.close(connected.connectionId)
      }
    })
  }

  async runtime(): Promise<{ runtimeId: string; runtimeGeneration: number; sequence: number }> {
    return this.writes.run(async () => {
      const data = await this.data(),
        record = data.current
      if (
        !record ||
        !Number.isSafeInteger(record.summary.generation) ||
        record.summary.generation < 0 ||
        record.summary.generation >= Number.MAX_SAFE_INTEGER
      )
        throw new Error('Invalid runtime generation')
      if (this.allocatedContext !== record.summary.contextId) {
        record.summary.generation++
        await this.save(data)
        this.allocatedContext = record.summary.contextId
        this.runtimeId = randomUUID()
        this.sequence = 0
      }
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
      if (
        !data.current ||
        data.current.summary.contextId !== contextId ||
        data.current.summary.serverId !== state.serverId
      )
        throw new Error('Stale binding state')
      data.current.summary.maintenanceLocked = state.mode === 'maintenance'
      data.current.summary.versionMismatch = state.releaseVersion !== this.transport.version
      await this.save(data)
      return data.current.summary
    })
  }
}
