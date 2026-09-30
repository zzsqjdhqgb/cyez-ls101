import { randomUUID } from 'node:crypto'
import { readdir, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { OperationId } from '@ls101/lab-contracts'
import type { OperationInput, TransportResponse } from '@ls101/lab-client'
import { loadJson, saveFile, SerialWrites } from './files'

export interface TeacherOperation {
  id: string
  serverId: string
  operationId: OperationId
  idempotencyKey: string | null
  at: string
  status: 'sending' | 'succeeded' | 'rejected' | 'unknown'
  input: OperationInput
  response: TransportResponse | null
  secretFields: string[]
}
export class TeacherOperations {
  private readonly writes = new SerialWrites()
  constructor(readonly root: string) {}
  async begin(
    serverId: string,
    operationId: OperationId,
    input: OperationInput
  ): Promise<TeacherOperation> {
    const safe = structuredClone(input)
    const secretFields: string[] = []
    if (safe.body && typeof safe.body === 'object') {
      for (const key of ['password', 'newPassword', 'encryptionPassword']) {
        if (Object.hasOwn(safe.body, key)) secretFields.push(key)
        delete (safe.body as Record<string, unknown>)[key]
      }
    }
    const entry: TeacherOperation = {
      id: randomUUID(),
      serverId,
      operationId,
      idempotencyKey: input.idempotencyKey ?? null,
      at: new Date().toISOString(),
      status: 'sending',
      input: safe,
      response: null,
      secretFields
    }
    await this.save(entry)
    return entry
  }
  async finish(entry: TeacherOperation, response?: TransportResponse): Promise<void> {
    const finished: TeacherOperation = {
      ...entry,
      status:
        !response || response.status >= 500
          ? 'unknown'
          : response.status >= 400
            ? 'rejected'
            : 'succeeded',
      response: response ? { status: response.status, body: response.body } : null
    }
    await this.save(finished)
    if (finished.status === 'succeeded' && entry.idempotencyKey) {
      await this.writes.run(async () => {
        for (const file of await readdir(this.root)) {
          if (!/^[a-f0-9-]+\.json$/.test(file) || file === `${entry.id}.json`) continue
          const prior = await loadJson<TeacherOperation>(join(this.root, file))
          if (
            prior &&
            ['sending', 'unknown'].includes(prior.status) &&
            prior.serverId === entry.serverId &&
            prior.operationId === entry.operationId &&
            prior.idempotencyKey === entry.idempotencyKey &&
            JSON.stringify(prior.input.path ?? {}) === JSON.stringify(entry.input.path ?? {})
          ) {
            await saveFile(
              join(this.root, file),
              JSON.stringify({ ...prior, status: 'succeeded', response: finished.response })
            )
          }
        }
      })
    }
  }
  private async save(entry: TeacherOperation): Promise<void> {
    await this.writes.run(() =>
      saveFile(join(this.root, `${entry.id}.json`), JSON.stringify(entry))
    )
  }
  async list(): Promise<TeacherOperation[]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const entries: TeacherOperation[] = []
    for (const file of await readdir(this.root)) {
      if (!/^[a-f0-9-]+\.json$/.test(file)) continue
      const entry = await loadJson<TeacherOperation>(join(this.root, file))
      if (entry) {
        if (
          ['succeeded', 'rejected'].includes(entry.status) &&
          Date.parse(entry.at) < Date.now() - 90 * 86400000
        ) {
          await rm(join(this.root, file))
        } else entries.push({ ...entry, secretFields: entry.secretFields ?? [] })
      }
    }
    const sorted = entries.sort((a, b) => b.at.localeCompare(a.at))
    const completed = sorted.filter((entry) => ['succeeded', 'rejected'].includes(entry.status))
    const resolvedKeys = new Set(
      completed
        .filter((entry) => entry.status === 'succeeded')
        .filter((entry) => entry.idempotencyKey)
        .map(
          (entry) =>
            `${entry.serverId}:${entry.operationId}:${entry.idempotencyKey}:${JSON.stringify(entry.input.path ?? {})}`
        )
    )
    return sorted.filter((entry) => {
      if (['succeeded', 'rejected'].includes(entry.status)) return completed.indexOf(entry) < 200
      return (
        !entry.idempotencyKey ||
        !resolvedKeys.has(
          `${entry.serverId}:${entry.operationId}:${entry.idempotencyKey}:${JSON.stringify(entry.input.path ?? {})}`
        )
      )
    })
  }
}
