import type { LicenseActivationResult, LicenseStatus } from '@ls101/core-types'
import { LabClient, RemoteError, type OperationInput } from '@ls101/lab-client'
import { operationDefinitions, type OperationId, type Schema } from '@ls101/lab-contracts'
import type { LabHost } from '@ls101/lab-desktop-host'

export interface SavedConnection {
  id: string
  name: string
  baseUrl: string
  fingerprint: string
  serverId?: string
}

export interface TeacherConnection {
  connectionId: string
  epoch: number
  info: Schema<'Info'>
}

export interface TeacherView {
  loading: boolean
  active: boolean
  connections: SavedConnection[]
  target: SavedConnection | null
  connection: TeacherConnection | null
  service: Schema<'ServiceState'> | null
  error: string | null
}

export class TeacherSession {
  private view: TeacherView = {
    loading: true,
    active: false,
    connections: [],
    target: null,
    connection: null,
    service: null,
    error: null
  }
  private readonly listeners = new Set<() => void>()
  private readonly requests = new Map<string, AbortController>()
  private serial = 0
  private readonly pendingKeys = new Map<string, string>()

  constructor(readonly host: LabHost) {}

  getSnapshot = (): TeacherView => this.view

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(change: Partial<TeacherView>): void {
    this.view = { ...this.view, ...change }
    for (const listener of this.listeners) listener()
  }

  async start(): Promise<void> {
    const license = await this.host.invoke<LicenseStatus>('license.status')
    this.update({ active: license.state === 'active', loading: false })
    if (this.view.active) this.update({ connections: await this.host.invoke('connections.list') })
  }

  async activate(code: string): Promise<void> {
    const result = await this.host.invoke<LicenseActivationResult>('license.activate', code)
    if (!result.activated)
      throw new Error(result.reason === 'expired' ? '许可已到期' : '激活码无效')
    await this.start()
  }

  async connect(target: SavedConnection, password: string): Promise<void> {
    const serial = ++this.serial
    await this.clearConnection()
    if (serial !== this.serial) throw new Error('连接已取消')
    const connection = await this.host.invoke<TeacherConnection>('connections.open', target)
    try {
      await this.host.invoke('connections.authenticate', {
        connectionId: connection.connectionId,
        password
      })
      if (serial !== this.serial) throw new Error('连接已取消')
      const saved = { ...target, serverId: connection.info.serverId, name: connection.info.name }
      await this.host.invoke('connections.save', saved)
      const connections = await this.host.invoke<SavedConnection[]>('connections.list')
      if (serial !== this.serial) throw new Error('连接已取消')
      this.update({ connection, target: saved, error: null, connections })
      await this.refreshService()
    } catch (error) {
      await this.host.invoke('connections.close', connection.connectionId)
      if (serial === this.serial) this.update({ connection: null, target: null, service: null })
      throw error
    }
  }

  async disconnect(): Promise<void> {
    this.serial++
    await this.clearConnection()
  }

  private async clearConnection(): Promise<void> {
    for (const request of this.requests.values()) request.abort()
    const connection = this.view.connection
    this.update({ connection: null, target: null, service: null })
    if (connection) await this.host.invoke('connections.close', connection.connectionId)
  }

  async connectLocal(): Promise<void> {
    const serial = ++this.serial
    await this.clearConnection()
    if (serial !== this.serial) throw new Error('连接已取消')
    const connection = await this.host.invoke<TeacherConnection>('localService.connection')
    try {
      if (serial !== this.serial) throw new Error('连接已取消')
      this.update({ connection, target: null, error: null })
      await this.refreshService()
    } catch (error) {
      await this.host.invoke('connections.close', connection.connectionId)
      if (serial === this.serial) this.update({ connection: null, service: null })
      throw error
    }
  }

  async request<T>(
    operationId: OperationId,
    input: OperationInput = {},
    signal?: AbortSignal
  ): Promise<T> {
    const connection = this.view.connection
    if (!connection) throw new Error('请先连接服务')
    const client = new LabClient(connection.connectionId, {
      request: async (connectionId, id, value, signal) => {
        if (signal?.aborted) throw new Error('读取已取消')
        const requestId = crypto.randomUUID(),
          abort = new AbortController()
        this.requests.set(requestId, abort)
        abort.signal.addEventListener(
          'abort',
          () => {
            void this.host.invoke('transport.cancel', requestId)
          },
          { once: true }
        )
        const cancel = (): void => abort.abort()
        signal?.addEventListener('abort', cancel, { once: true })
        try {
          return await this.host.invoke('transport.request', {
            connectionId,
            operationId: id,
            input: value,
            requestId
          })
        } finally {
          signal?.removeEventListener('abort', cancel)
          this.requests.delete(requestId)
        }
      }
    })
    try {
      const result = await client.request<T>(operationId, input, signal)
      if (connection !== this.view.connection) throw new Error('服务连接已切换')
      return result
    } catch (error) {
      if (
        connection === this.view.connection &&
        error instanceof RemoteError &&
        ['TOKEN_REVOKED', 'TOKEN_EXPIRED', 'AUTH_REQUIRED'].includes(error.code)
      )
        await this.disconnect()
      throw error
    }
  }

  async mutate<T>(operationId: OperationId, input: OperationInput = {}): Promise<T> {
    const connection = this.view.connection
    if (!connection) throw new Error('请先连接服务')
    const operation = operationDefinitions[operationId]
    const idempotent = operation.parameters.some(
      (parameter) => parameter.name.toLowerCase() === 'idempotency-key'
    )
    if (!idempotent) return this.request(operationId, input)
    const encoded = new TextEncoder().encode(
      JSON.stringify([this.view.connection?.info.serverId, operationId, input])
    )
    const signature = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)),
      (byte) => byte.toString(16).padStart(2, '0')
    ).join('')
    if (connection !== this.view.connection) throw new Error('服务连接已切换')
    const key = input.idempotencyKey ?? this.pendingKeys.get(signature) ?? crypto.randomUUID()
    this.pendingKeys.set(signature, key)
    const result = await this.request<T>(operationId, { ...input, idempotencyKey: key })
    this.pendingKeys.delete(signature)
    return result
  }

  async refreshService(): Promise<void> {
    const connection = this.view.connection
    const service = await this.request<Schema<'ServiceState'>>('getTeacherService')
    if (connection === this.view.connection) this.update({ service })
  }

  async changeMode(mode: 'normal' | 'maintenance'): Promise<void> {
    await this.refreshService()
    try {
      await this.mutate('putTeacherServiceMode', {
        body: { mode, expectedRevision: this.view.service!.modeRevision }
      })
    } finally {
      await this.refreshService()
    }
  }

  async importExam(): Promise<void> {
    const connection = this.view.connection!
    const archive = await this.host.invoke<{
      handle: string
      sha256: string
      bytes: number
    } | null>('transfer.import', { connectionId: connection.connectionId })
    if (!archive) return
    if (connection !== this.view.connection) throw new Error('服务连接已切换')
    await this.mutate('postTeacherExams', { archive })
  }

  async download(operation: OperationId, input: OperationInput, filename: string): Promise<void> {
    const archive = await this.mutate<{ handle: string }>(operation, input)
    if (archive.handle)
      await this.host.invoke('transfer.export', { handle: archive.handle, filename })
    else await this.host.invoke('transfer.exportJson', { body: archive, filename })
  }

  async changePassword(password: string): Promise<void> {
    const security = await this.request<{ revision: number }>('getTeacherSecurity')
    await this.mutate('putTeacherSecurityPassword', {
      body: { newPassword: password, expectedRevision: security.revision }
    })
    await this.disconnect()
  }
}
