import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeExamPackage, type ExamArchive } from '@ls101/exam-package'
import { saveFile } from './files'

export class ExamCache {
  private readonly loaded = new Map<string, ExamArchive>()
  constructor(readonly root: string) {}

  async prepare(filename: string, expectedDigest: string): Promise<string> {
    const bytes = await readFile(filename)
    if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest)
      throw new Error('Exam digest mismatch')
    const archive = await decodeExamPackage(bytes)
    await saveFile(join(this.root, `${expectedDigest}.lsexam`), bytes)
    const handle = randomUUID()
    this.loaded.set(handle, archive)
    return `ls101-exam://${handle}/`
  }

  release(baseUrl: string): void {
    this.loaded.delete(new URL(baseUrl).hostname)
  }

  respond(url: string): Response {
    const parsed = new URL(url),
      archive = this.loaded.get(parsed.hostname)
    if (!archive) return new Response(null, { status: 404 })
    const path = decodeURIComponent(parsed.pathname.slice(1))
    if (path === 'manifest.json' || path === '') return Response.json(archive.exam)
    const entry = Object.entries(archive.exam.examData.resources).find(
      ([, resource]) => resource.packagePath === path
    )
    if (!entry) return new Response(null, { status: 404 })
    const bytes = archive.resources[entry[0]]
    return new Response(new Uint8Array(bytes).buffer, {
      headers: { 'Content-Type': entry[1].mediaType ?? 'application/octet-stream' }
    })
  }
}
