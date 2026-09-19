import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { exportFile } from '../files'

it('publishes an export without changing its source and preserves the previous export on copy failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ls101-export-'))
  try {
    const source = join(root, 'source.7z')
    const target = join(root, 'export.7z')
    const bytes = Buffer.alloc(2 * 1024 * 1024, 42)
    await writeFile(source, bytes)
    await writeFile(target, 'previous export')
    await expect(exportFile(join(root, 'missing.7z'), target)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(await readFile(target, 'utf8')).toBe('previous export')
    await exportFile(source, target)
    expect((await readFile(target)).equals(bytes)).toBe(true)
    expect((await readFile(source)).equals(bytes)).toBe(true)
    expect((await readdir(root)).sort()).toEqual(['export.7z', 'source.7z'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
