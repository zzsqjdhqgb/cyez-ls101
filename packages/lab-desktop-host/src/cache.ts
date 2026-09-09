import { randomUUID, createHash } from 'node:crypto'
import { readFile, readdir, stat, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeExamPackage, type ExamArchive } from '@ls101/exam-package'
import { saveFile, SerialWrites } from './files'

export class ExamCache {
  private readonly loaded = new Map<string, ExamArchive>()
  private readonly writes = new SerialWrites()
  constructor(readonly root: string) {}

  async prepare(filename: string, expectedDigest: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('Invalid exam digest')
    if (this.loaded.size >= 4) throw new Error('Exam cache is busy')
    if ((await stat(filename)).size > 512 * 1024 ** 2) throw new Error('Exam archive is too large')
    const bytes = await readFile(filename)
    if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest)
      throw new Error('Exam digest mismatch')
    const archive = await decodeExamPackage(bytes)
    await this.writes.run(async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const entries = await Promise.all(
        (await readdir(this.root))
          .filter((name) => /^[a-f0-9]{64}\.lsexam$/.test(name))
          .map(async (name) => ({ name, info: await stat(join(this.root, name)) }))
      )
      let total = entries.reduce((sum, entry) => sum + entry.info.size, 0) + bytes.length
      let count = entries.length
      for (const entry of entries.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs)) {
        if (total <= 2 * 1024 ** 3 && count < 20) break
        await rm(join(this.root, entry.name))
        total -= entry.info.size
        count--
      }
      await saveFile(join(this.root, `${expectedDigest}.lsexam`), bytes)
    })
    if (this.loaded.size >= 4) throw new Error('Exam cache is busy')
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
