import { randomUUID } from 'node:crypto'
import { readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { OperationId } from '@ls101/lab-contracts'
import type { OperationInput, TransportResponse } from '@ls101/lab-client'
import { loadJson, saveFile, SerialWrites } from './files'

interface TeacherOperation {
  id: string
  serverId: string
  operationId: OperationId
  idempotencyKey: string | null
  at: string
  status: 'sending' | 'succeeded' | 'rejected' | 'unknown'
  input: OperationInput
  response: TransportResponse | null
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
    if (safe.body && typeof safe.body === 'object') {
      for (const key of ['password', 'newPassword', 'encryptionPassword'])
        delete (safe.body as Record<string, unknown>)[key]
    }
    const entry: TeacherOperation = {
      id: randomUUID(),
      serverId,
      operationId,
      idempotencyKey: input.idempotencyKey ?? null,
      at: new Date().toISOString(),
      status: 'sending',
      input: safe,
      response: null
    }
    await this.save(entry)
    return entry
  }
  async finish(entry: TeacherOperation, response?: TransportResponse): Promise<void> {
    await this.save({
      ...entry,
      status:
        !response || response.status >= 500
          ? 'unknown'
          : response.status >= 400
            ? 'rejected'
            : 'succeeded',
      response: response ? { status: response.status, body: response.body } : null
    })
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
      if (entry) entries.push(entry)
    }
    return entries.sort((a, b) => b.at.localeCompare(a.at))
  }
}
