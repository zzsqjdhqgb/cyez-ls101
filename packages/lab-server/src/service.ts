import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import { readFile, mkdir, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import canonicalize from 'canonicalize'
import {
  DEFAULT_LIMITS,
  operationDefinitions,
  type OperationId,
  type Schema,
  type RequestBody
} from '@ls101/lab-contracts'
import { LabDatabase } from './database'
import { Security, type Principal } from './security'
import { ServerIdentity, hash, equalSecret } from './identity'
import { LabError, requireCondition } from './errors'
import type { FaultPoint } from './durable-files'
import { DEVICE_OFFLINE_AFTER_MS, registerDeviceHandlers } from './devices'
import { ArchiveStore, registerArchiveHandlers } from './archives'
import { TaskStore, registerTaskHandlers } from './tasks'
import { BackupStore, registerBackupHandlers } from './backups'

export interface Context {
  id: OperationId
  path: Record<string, string>
  query: Record<string, unknown>
  headers: Record<string, string | undefined>
  body: unknown
  principal?: Principal
  version: string
  loopback: boolean
  signal: AbortSignal
  stream?: AsyncIterable<Uint8Array>
}
export interface Result {
  status: number
  body?: unknown
  bytes?: Uint8Array
  filename?: string
  contentType?: string
  digest?: string
  file?: string
  release?: () => void
}
export type Handler = (context: Context) => Result | Promise<Result>
export interface ServiceOptions {
  root: string
  releaseVersion: string
  isLicenseActive: () => boolean
  now?: () => number
  fault?: FaultPoint
}
interface ServiceData {
  name: string
  baseUrl: string
  mode: 'normal' | 'maintenance'
  modeRevision: number
  settingsRevision: number
  limits: Schema<'Limits'>
}
export interface StoredDevice extends Schema<'Device'> {
  computerName: string
  platform: 'win32' | 'linux'
  registeredAt: string
}
interface EnrollmentRow {
  id: string
  expires_at: number
  closed_at: number | null
  data: string
  signed_file: string | null
}

export class LabService {
  readonly handlers: Partial<Record<OperationId, Handler>> = {}
  readonly security: Security
  readonly archives: ArchiveStore
  readonly tasks: TaskStore
  readonly backups: BackupStore
  readonly now: () => number
  readonly transfers = new Map<string, AbortController>()
  readonly fileReferences = new Map<string, number>()
  private readonly pages = new Map<string, { signature: string; ids: string[]; expires: number }>()
  private constructor(
    readonly options: ServiceOptions,
    readonly db: LabDatabase,
    readonly identity: ServerIdentity,
    readonly idempotencyKey: Buffer
  ) {
    this.now = options.now ?? Date.now
    this.security = new Security(db, this.now)
    this.archives = new ArchiveStore(this)
    this.tasks = new TaskStore(this)
    this.backups = new BackupStore(this)
    this.registerCore()
    registerDeviceHandlers(this)
    registerArchiveHandlers(this, this.archives)
    registerTaskHandlers(this, this.tasks)
    registerBackupHandlers(this, this.backups)
  }

  static async initialize(
    options: ServiceOptions,
    input: { name: string; baseUrl: string; password: string }
  ): Promise<LabService> {
    requireCondition(options.isLicenseActive(), 'LICENSE_INACTIVE')
    requireCondition(
      input.name.trim() &&
        input.name.length <= 200 &&
        input.password.length >= 1 &&
        input.password.length <= 1024,
      'INVALID_REQUEST'
    )
    LabService.validateBaseUrl(input.baseUrl)
    const db = await LabDatabase.open(options.root, true)
    try {
      requireCondition(!db.get('SELECT singleton FROM service'), 'CONTENT_CONFLICT')
      const identity = await ServerIdentity.create(options.root, options.now?.())
      const key = await readFile(join(options.root, 'identity/idempotency.key'))
      const service = new LabService(options, db, identity, key)
      await service.security.initialize(input.password)
      db.transaction(() =>
        db.run(
          'INSERT INTO service VALUES (1,?)',
          JSON.stringify({
            name: input.name.trim(),
            baseUrl: input.baseUrl,
            mode: 'maintenance',
            modeRevision: 1,
            settingsRevision: 1,
            limits: DEFAULT_LIMITS
          } satisfies ServiceData)
        )
      )
      await service.prepareDirectories()
      await service.archives.recover()
      service.tasks.retain()
      return service
    } catch (error) {
      await db.close()
      throw error
    }
  }

  static async open(options: ServiceOptions): Promise<LabService> {
    const db = await LabDatabase.open(options.root)
    try {
      const identity = await ServerIdentity.load(options.root)
      const service = new LabService(
        options,
        db,
        identity,
        await readFile(join(options.root, 'identity/idempotency.key'))
      )
      requireCondition(
        db.get('SELECT singleton FROM service') && db.get('SELECT singleton FROM security'),
        'STORAGE_UNAVAILABLE'
      )
      await service.prepareDirectories()
      await service.backups.recover()
      await service.archives.recover()
      await service.archives.collectGarbage()
      return service
    } catch (error) {
      await db.close()
      throw error
    }
  }

  private async prepareDirectories(): Promise<void> {
    for (const name of [
      'incoming',
      'archives/exams',
      'archives/submissions',
      'test-data',
      'backup-staging',
      'backups',
      'logs'
    ]) {
      await mkdir(join(this.options.root, name), { recursive: true, mode: 0o700 })
    }
  }

  static validateBaseUrl(value: string): void {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new LabError('INVALID_REQUEST')
    }
    requireCondition(
      url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === '/',
      'INVALID_REQUEST'
    )
  }

  data(): ServiceData {
    const row = this.db.get<{ data: string }>('SELECT data FROM service WHERE singleton=1')
    requireCondition(row, 'STORAGE_UNAVAILABLE')
    return JSON.parse(row.data)
  }

  saveData(data: ServiceData): void {
    this.db.run('UPDATE service SET data=? WHERE singleton=1', JSON.stringify(data))
  }
  timestamp(): string {
    return new Date(this.now()).toISOString()
  }
  mode(): Schema<'Mode'> {
    const { mode, modeRevision } = this.data()
    return { mode, modeRevision }
  }

  info(): Schema<'Info'> {
    return {
      serverId: this.identity.serverId,
      name: this.data().name,
      apiVersion: 1,
      releaseVersion: this.options.releaseVersion,
      serverTime: this.timestamp(),
      readiness: this.options.isLicenseActive() ? 'ready' : 'license-inactive'
    }
  }

  device(id: string): StoredDevice {
    const row = this.db.get<{ data: string }>('SELECT data FROM devices WHERE id=?', id)
    requireCondition(row, 'NOT_FOUND')
    return JSON.parse(row.data)
  }

  publicDevice(id: string): Schema<'Device'> {
    const { number, room, seat, displayName, enabled, revision } = this.device(id)
    return { id, number, room, seat, displayName, enabled, revision }
  }

  assertAuthorized(context: Context, normal = false): Principal {
    requireCondition(this.options.isLicenseActive(), 'LICENSE_INACTIVE')
    requireCondition(context.principal, 'AUTH_REQUIRED')
    this.security.recheck(context.principal)
    if (context.principal.role === 'student') {
      requireCondition(context.version === this.options.releaseVersion, 'VERSION_MISMATCH')
      requireCondition(this.device(context.principal.deviceId).enabled, 'DEVICE_DISABLED')
      if (normal)
        requireCondition(this.data().mode === 'normal', 'SERVICE_MAINTENANCE', this.mode())
    }
    return context.principal
  }

  write<T>(context: Context, action: () => T, normal = false): T {
    return this.db.transaction(() => {
      this.assertAuthorized(context, normal)
      return action()
    })
  }

  studentState(context: Context): Schema<'StudentState'> {
    requireCondition(context.principal?.role === 'student', 'AUTH_REQUIRED')
    this.security.recheck(context.principal)
    const device = this.publicDevice(context.principal.deviceId)
    const data = this.data()
    const availability = !this.options.isLicenseActive()
      ? 'license-inactive'
      : context.version !== this.options.releaseVersion
        ? 'version-mismatch'
        : !device.enabled
          ? 'disabled'
          : data.mode === 'maintenance'
            ? 'maintenance'
            : 'ready'
    const allowedOperations: Schema<'StudentState'>['allowedOperations'] = ['heartbeat']
    if (availability === 'ready')
      allowedOperations.push(
        'browse-exams',
        'download-exam',
        'start-practice',
        'submit',
        'query-receipt',
        'report-task-result'
      )
    if (availability === 'maintenance')
      allowedOperations.push('maintenance-task', 'report-task-result')
    return {
      ...this.mode(),
      serverId: this.identity.serverId,
      serverTime: this.timestamp(),
      releaseVersion: this.options.releaseVersion,
      device,
      availability,
      allowedOperations,
      heartbeatIntervalSeconds: 5,
      offlineAfterSeconds: DEVICE_OFFLINE_AFTER_MS / 1000,
      limits: data.limits
    }
  }

  taskRows(): Schema<'Task'>[] {
    return this.db
      .all<{ id: string }>(
        'SELECT id FROM tasks WHERE state IN (?,?,?)',
        'pending',
        'running',
        'cancel-requested'
      )
      .map((row) => this.tasks.task(this.tasks.row(row.id)))
      .filter((task) => ['pending', 'running', 'cancel-requested'].includes(task.status))
  }

  blockers(): Schema<'Blocker'>[] {
    const blockers: Schema<'Blocker'>[] = []
    const enrollment = this.openEnrollment()
    if (enrollment) blockers.push({ kind: 'enrollment', resourceId: enrollment.id })
    for (const task of this.taskRows()) {
      const row = this.tasks.row(task.id)
      blockers.push({
        kind: task.parameters.type === 'deployment-test' ? 'test-run' : 'history-cleanup',
        resourceId: row.batch_id
      })
    }
    for (const row of this.db.all<{ id: string }>('SELECT id FROM cleanup_plans')) {
      const plan = this.tasks.cleanup(row.id)
      if (
        ['previewing', 'awaiting-confirmation', 'executing', 'cancel-requested'].includes(
          plan.status
        )
      )
        blockers.push({ kind: 'history-cleanup', resourceId: plan.id })
    }
    for (const lease of this.db.all<{ id: string }>(
      'SELECT id FROM task_leases WHERE ended_at IS NULL AND expires_at>?',
      this.now()
    ))
      blockers.push({ kind: 'active-task-lease', resourceId: lease.id })
    for (const backup of this.db.all<{ id: string; state: string; barrier_state: string }>(
      'SELECT * FROM backups WHERE state IN (?,?)',
      'pending',
      'running'
    )) {
      blockers.push({
        kind:
          this.db.gate.backupId === backup.id
            ? 'backup-write-barrier'
            : backup.state === 'pending'
              ? 'backup-pending'
              : 'backup-running',
        resourceId: backup.id
      })
    }
    return [
      ...new Map(
        blockers.map((blocker) => [`${blocker.kind}:${blocker.resourceId}`, blocker])
      ).values()
    ]
  }

  async storage(): Promise<Schema<'StorageSummary'>> {
    const space = await statfs(this.options.root)
    const pending = this.db.get<{ bytes: number }>(
      'SELECT COALESCE(SUM(bytes),0) AS bytes FROM file_gc'
    )!
    return {
      usedBytes: (space.blocks - space.bfree) * space.bsize,
      freeBytes: space.bavail * space.bsize,
      pendingGcBytes: pending.bytes
    }
  }

  openEnrollment(): EnrollmentRow | undefined {
    return this.db.get(
      'SELECT * FROM enrollments WHERE closed_at IS NULL AND expires_at>?',
      this.now()
    )
  }

  enrollment(row: EnrollmentRow): Schema<'Enrollment'> {
    const data = JSON.parse(row.data) as Schema<'Enrollment'>
    return {
      ...data,
      status:
        row.closed_at !== null ? 'revoked' : row.expires_at <= this.now() ? 'expired' : 'active'
    }
  }

  operationDigest(value: unknown, sensitive = false): string {
    const normalized = canonicalize(value) ?? 'null'
    return sensitive
      ? createHmac('sha256', this.idempotencyKey).update(normalized).digest('hex')
      : hash(normalized)
  }

  route(context: Context): string {
    return operationDefinitions[context.id].route.replace(/\{([^}]+)\}/g, (_, key: string) =>
      encodeURIComponent(context.path[key])
    )
  }

  replay(context: Context, digest: string): Result | undefined {
    this.assertAuthorized(context)
    const key = context.headers['idempotency-key']
    requireCondition(key, 'INVALID_REQUEST')
    const row = this.db.get<{ digest: string; status: number; response: string }>(
      'SELECT * FROM idempotency WHERE subject=? AND method=? AND route=? AND key=?',
      context.principal!.role === 'teacher'
        ? 'teacher'
        : (context.principal as Extract<Principal, { role: 'student' }>).deviceId,
      'POST',
      this.route(context),
      key
    )
    if (!row) return undefined
    requireCondition(row.digest === digest, 'CONTENT_CONFLICT')
    return { status: row.status, ...(row.status === 204 ? {} : { body: JSON.parse(row.response) }) }
  }

  remember(context: Context, digest: string, result: Result): Result {
    this.db.run(
      'INSERT INTO idempotency VALUES (?,?,?,?,?,?,?,NULL)',
      context.principal!.role === 'teacher'
        ? 'teacher'
        : (context.principal as Extract<Principal, { role: 'student' }>).deviceId,
      'POST',
      this.route(context),
      context.headers['idempotency-key']!,
      digest,
      result.status,
      JSON.stringify(result.body ?? null)
    )
    return result
  }

  page<T>(
    context: Context,
    items: T[],
    identity: (item: T) => string
  ): { items: T[]; nextCursor: string | null } {
    const { cursor, limit = 50, ...filters } = context.query
    const signature = this.operationDigest({
      operation: context.id,
      path: context.path,
      principal: context.principal,
      filters
    })
    for (const [id, snapshot] of this.pages)
      if (snapshot.expires <= this.now()) this.pages.delete(id)
    let start = 0
    let snapshotId: string
    let ids: string[]
    if (cursor !== undefined) {
      try {
        const encoded = Buffer.from(String(cursor), 'base64url').toString('utf8')
        const value = JSON.parse(encoded) as { id: string; offset: number }
        const snapshot = this.pages.get(value.id)
        requireCondition(
          snapshot?.signature === signature &&
            Number.isSafeInteger(value.offset) &&
            value.offset >= 0 &&
            value.offset <= snapshot.ids.length,
          'INVALID_REQUEST'
        )
        snapshotId = value.id
        ids = snapshot.ids
        start = value.offset
      } catch {
        throw new LabError('INVALID_REQUEST')
      }
    } else {
      snapshotId = randomUUID()
      ids = items.map(identity)
      if (ids.length > Number(limit)) {
        let count = ids.length
        for (const snapshot of this.pages.values()) count += snapshot.ids.length
        requireCondition(ids.length <= 100000, 'RESOURCE_BUSY')
        while (this.pages.size && (this.pages.size >= 128 || count > 100000)) {
          const oldest = this.pages.keys().next().value!
          count -= this.pages.get(oldest)!.ids.length
          this.pages.delete(oldest)
        }
        this.pages.set(snapshotId, { signature, ids, expires: this.now() + 15 * 60000 })
      }
    }
    // A bounded ID snapshot preserves order when the previous page's rows are deleted or edited.
    const current = new Map(items.map((item) => [identity(item), item]))
    const page: T[] = []
    while (start < ids.length && page.length < Number(limit)) {
      const item = current.get(ids[start++])
      if (item !== undefined) page.push(item)
    }
    return {
      items: page,
      nextCursor:
        start < ids.length
          ? Buffer.from(JSON.stringify({ id: snapshotId, offset: start })).toString('base64url')
          : null
    }
  }

  private registerCore(): void {
    this.handlers.getInfo = () => ({ status: 200, body: this.info() })
    this.handlers.postTeacherSessions = async (context) => {
      requireCondition(this.options.isLicenseActive(), 'LICENSE_INACTIVE')
      const body = await this.security.login(
        context.body as RequestBody<'postTeacherSessions'>,
        context.headers['x-ls101-local-authorization'],
        context.loopback
      )
      return { status: 200, body: { ...body, serverId: this.identity.serverId } }
    }
    this.handlers.deleteTeacherSessionsCurrent = (context) => {
      this.security.logout(context.principal!)
      return { status: 204 }
    }
    this.handlers.getTeacherSecurity = () => ({
      status: 200,
      body: { revision: this.security.revision() }
    })
    this.handlers.putTeacherSecurityPassword = async (context) => {
      const body = context.body as RequestBody<'putTeacherSecurityPassword'>
      const revision = await this.security.changePassword(
        context.principal!,
        body.expectedRevision,
        body.newPassword
      )
      return { status: 200, body: { revision } }
    }
    this.handlers.getStudentState = (context) => ({ status: 200, body: this.studentState(context) })
    this.handlers.postStudentHeartbeat = (context) => {
      const body = context.body as Schema<'Heartbeat'>
      const principal = context.principal as Extract<Principal, { role: 'student' }>
      const accepted = this.db.transaction(() => {
        requireCondition(this.options.isLicenseActive(), 'LICENSE_INACTIVE')
        this.security.recheck(principal)
        const previous = this.db.get<{ generation: number; runtime_id: string; sequence: number }>(
          'SELECT * FROM heartbeats WHERE credential_id=?',
          principal.credentialId
        )
        if (previous) {
          requireCondition(
            previous.generation !== body.runtimeGeneration ||
              previous.runtime_id === body.runtimeId,
            'CONTENT_CONFLICT'
          )
          if (
            previous.generation > body.runtimeGeneration ||
            (previous.generation === body.runtimeGeneration && previous.sequence >= body.sequence)
          )
            return false
        }
        this.db.run(
          'INSERT INTO heartbeats VALUES (?,?,?,?,?,?) ON CONFLICT(credential_id) DO UPDATE SET generation=excluded.generation,runtime_id=excluded.runtime_id,sequence=excluded.sequence,accepted_at=excluded.accepted_at,data=excluded.data',
          principal.credentialId,
          body.runtimeGeneration,
          body.runtimeId,
          body.sequence,
          this.now(),
          JSON.stringify({ ...body, releaseVersion: context.version })
        )
        return true
      })
      const state = this.studentState(context)
      return {
        status: 200,
        body: {
          ...state,
          heartbeatAccepted: accepted,
          taskIds:
            accepted && state.availability === 'maintenance'
              ? this.taskRows()
                  .filter(
                    (task) =>
                      task.deviceId === principal.deviceId &&
                      task.status === 'pending' &&
                      Date.parse(task.expiresAt) > this.now()
                  )
                  .map((task) => task.id)
              : []
        }
      }
    }
    this.handlers.getTeacherSettings = async () => {
      const data = this.data()
      return {
        status: 200,
        body: {
          name: data.name,
          baseUrl: data.baseUrl,
          limits: data.limits,
          revision: data.settingsRevision,
          storage: await this.storage()
        }
      }
    }
    this.handlers.patchTeacherSettings = async (context) => {
      const body = context.body as RequestBody<'patchTeacherSettings'>
      if (body.baseUrl) LabService.validateBaseUrl(body.baseUrl)
      this.write(context, () => {
        const data = this.data()
        requireCondition(data.settingsRevision === body.expectedRevision, 'REVISION_CONFLICT', {
          revision: data.settingsRevision
        })
        this.saveData({
          ...data,
          name: body.name ?? data.name,
          baseUrl: body.baseUrl ?? data.baseUrl,
          limits: body.limits ?? data.limits,
          settingsRevision: data.settingsRevision + 1
        })
      })
      return this.handlers.getTeacherSettings!(context)
    }
    this.handlers.putTeacherServiceMode = (context) => {
      const body = context.body as RequestBody<'putTeacherServiceMode'>
      this.assertAuthorized(context)
      if (body.mode === 'normal') {
        const blockers = this.blockers()
        requireCondition(blockers.length === 0, 'RESOURCE_BUSY', { blockers })
      }
      const result = this.write(context, () => {
        const data = this.data()
        requireCondition(data.modeRevision === body.expectedRevision, 'REVISION_CONFLICT', {
          revision: data.modeRevision
        })
        if (body.mode === 'normal')
          requireCondition(this.blockers().length === 0, 'RESOURCE_BUSY', {
            blockers: this.blockers()
          })
        if (data.mode !== body.mode)
          this.saveData({ ...data, mode: body.mode, modeRevision: data.modeRevision + 1 })
        return this.mode()
      })
      if (body.mode === 'maintenance')
        for (const transfer of this.transfers.values())
          transfer.abort(new LabError('SERVICE_MAINTENANCE', result))
      return { status: 200, body: result }
    }
    this.handlers.getTeacherEnrollments = (context) => ({
      status: 200,
      body: this.page(
        context,
        this.db
          .all<EnrollmentRow>(
            "SELECT * FROM enrollments ORDER BY json_extract(data,'$.issuedAt') DESC,id DESC"
          )
          .map((row) => this.enrollment(row)),
        (row) => row.id
      )
    })
    this.handlers.postTeacherEnrollments = async (context) => {
      const body = context.body as RequestBody<'postTeacherEnrollments'>
      const digest = this.operationDigest({ ...body, validForSeconds: body.validForSeconds ?? 600 })
      const previous = this.replay(context, digest)
      if (previous) return previous
      const data = this.data(),
        id = randomUUID(),
        issued = this.now(),
        expires = issued + (body.validForSeconds ?? 600) * 1000
      const file = await this.identity.signEnrollment({
        formatVersion: 1,
        purpose: 'ls101-device-enrollment',
        serverId: this.identity.serverId,
        baseUrl: data.baseUrl,
        publicKeyFingerprint: this.identity.fingerprint,
        enrollmentId: id,
        issuedAt: new Date(issued).toISOString(),
        expiresAt: new Date(expires).toISOString(),
        enrollmentSecret: randomBytes(32).toString('base64url')
      })
      return this.write(context, () => {
        const replay = this.replay(context, digest)
        if (replay) return replay
        const current = this.data()
        requireCondition(current.modeRevision === body.expectedModeRevision, 'REVISION_CONFLICT', {
          revision: current.modeRevision
        })
        requireCondition(!this.openEnrollment(), 'RESOURCE_BUSY')
        this.db.run(
          'UPDATE enrollments SET closed_at=?,signed_file=NULL WHERE closed_at IS NULL AND expires_at<=?',
          this.now(),
          this.now()
        )
        if (current.mode !== 'maintenance')
          this.saveData({ ...current, mode: 'maintenance', modeRevision: current.modeRevision + 1 })
        const enrollment: Schema<'Enrollment'> = {
          id,
          status: 'active',
          issuedAt: new Date(issued).toISOString(),
          expiresAt: new Date(expires).toISOString(),
          registeredCount: 0
        }
        this.db.run(
          'INSERT INTO enrollments VALUES (?,?,NULL,?,?)',
          id,
          expires,
          JSON.stringify(enrollment),
          file
        )
        return this.remember(context, digest, { status: 201, body: { enrollment, ...this.mode() } })
      })
    }
    this.handlers.getTeacherEnrollmentsIdFile = (context) => {
      const row = this.db.get<EnrollmentRow>(
        'SELECT * FROM enrollments WHERE id=?',
        context.path.id
      )
      requireCondition(
        row && row.closed_at === null && row.expires_at > this.now() && row.signed_file,
        'NOT_FOUND'
      )
      return {
        status: 200,
        bytes: Buffer.from(row.signed_file),
        contentType: 'application/x-ls101-enrollment',
        filename: `${row.id}.lsjoin`
      }
    }
    this.handlers.deleteTeacherEnrollmentsId = (context) =>
      this.write(context, () => {
        this.db.run(
          'UPDATE enrollments SET closed_at=COALESCE(closed_at,?),signed_file=NULL WHERE id=?',
          this.now(),
          context.path.id
        )
        return { status: 204 }
      })
    this.handlers.putEnrollmentDevicesInstallationId = async (context) => {
      const body = context.body as RequestBody<'putEnrollmentDevicesInstallationId'>
      requireCondition(
        context.version === this.options.releaseVersion &&
          body.releaseVersion === this.options.releaseVersion,
        'VERSION_MISMATCH'
      )
      const payload = await this.identity.verifyEnrollment(body.enrollmentFile)
      return this.db.transaction(() => {
        requireCondition(this.options.isLicenseActive(), 'LICENSE_INACTIVE')
        requireCondition(this.data().mode === 'maintenance', 'ENROLLMENT_REJECTED')
        const enrollment = this.db.get<EnrollmentRow>(
          'SELECT * FROM enrollments WHERE id=?',
          payload.enrollmentId
        )
        requireCondition(
          enrollment &&
            enrollment.closed_at === null &&
            enrollment.expires_at > this.now() &&
            equalSecret(enrollment.signed_file ?? '', body.enrollmentFile),
          'ENROLLMENT_REJECTED'
        )
        const existing = this.db.get<{ id: string; data: string }>(
          'SELECT id,data FROM devices WHERE installation_id=?',
          context.path.installationId
        )
        let device: StoredDevice
        let duplicate = false
        if (existing) {
          device = JSON.parse(existing.data)
          const credential = this.db.get<{ hash: string }>(
            'SELECT hash FROM device_credentials WHERE device_id=? AND revoked_at IS NULL',
            existing.id
          )
          if (credential) {
            requireCondition(
              equalSecret(credential.hash, hash(body.deviceSecret)),
              'CONTENT_CONFLICT'
            )
            duplicate = true
          } else this.security.createDeviceCredential(existing.id, body.deviceSecret)
        } else {
          let number = String(
            this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM devices')!.count + 1
          ).padStart(3, '0')
          while (this.db.get('SELECT id FROM devices WHERE number=?', number))
            number = String(Number(number) + 1).padStart(3, '0')
          device = {
            id: randomUUID(),
            number,
            room: null,
            seat: null,
            displayName: null,
            enabled: true,
            revision: 1,
            computerName: body.computerName,
            platform: body.platform,
            registeredAt: this.timestamp()
          }
          this.db.run(
            'INSERT INTO devices VALUES (?,?,?,?)',
            device.id,
            context.path.installationId,
            number,
            JSON.stringify(device)
          )
          this.security.createDeviceCredential(device.id, body.deviceSecret)
        }
        if (!duplicate) {
          const metadata = JSON.parse(enrollment.data) as Schema<'Enrollment'>
          this.db.run(
            'UPDATE enrollments SET data=? WHERE id=?',
            JSON.stringify({ ...metadata, registeredCount: metadata.registeredCount + 1 }),
            enrollment.id
          )
        }
        return {
          status: duplicate ? 200 : 201,
          body: {
            deviceId: device.id,
            deviceNumber: device.number,
            registeredAt: device.registeredAt,
            ...this.mode()
          }
        }
      })
    }
  }
}
