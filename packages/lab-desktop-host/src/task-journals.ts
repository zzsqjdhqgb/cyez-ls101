import { readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import canonicalize from 'canonicalize'
import { validateSchema } from '@ls101/lab-contracts'
import type { TaskJournal } from './shared'
import { loadJson, saveFile, requireId, SerialWrites } from './files'

export class TaskJournals {
  private readonly writes = new SerialWrites()
  constructor(readonly root: string) {}
  async save(next: TaskJournal): Promise<void> {
    requireId(next.task.id)
    requireId(next.contextId)
    requireId(next.runtimeId)
    validateSchema('Task', next.task)
    if (next.lease) validateSchema('TaskLease', next.lease)
    if (next.result) validateSchema('TaskResultInput', next.result)
    if (
      next.schemaVersion !== 1 ||
      typeof next.reported !== 'boolean' ||
      (next.reported && !next.result) ||
      (next.lease &&
        (next.lease.taskId !== next.task.id ||
          next.lease.runtimeId !== next.runtimeId ||
          canonicalize(next.lease.parameters) !== canonicalize(next.task.parameters))) ||
      (next.result && next.result.leaseId !== next.lease?.leaseId)
    )
      throw new Error('Invalid task journal')
    await this.writes.run(async () => {
      const path = join(this.root, next.task.id, 'journal.json'),
        current = await loadJson<TaskJournal>(path)
      if (
        current &&
        (current.contextId !== next.contextId ||
          current.runtimeId !== next.runtimeId ||
          canonicalize(current.task) !== canonicalize(next.task) ||
          (current.result && canonicalize(current.result) !== canonicalize(next.result)) ||
          (current.reported && !next.reported))
      )
        throw new Error('Task journal conflict')
      await saveFile(path, JSON.stringify(next))
    })
  }
  async list(): Promise<TaskJournal[]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const result: TaskJournal[] = []
    for (const id of await readdir(this.root)) {
      requireId(id)
      const value = await loadJson<TaskJournal>(join(this.root, id, 'journal.json'))
      if (value) result.push(value)
    }
    return result
  }
}
