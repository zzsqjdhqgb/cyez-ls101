import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  createLegacyArchive,
  verifyLegacyArchive,
  type LegacyArchiveSourceFile
} from '../../src/main/legacy-data-archive'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

it('streams large source files without starving the event loop', async () => {
  const root = await temporaryDirectory('ls101-streaming-archive-')
  const sourceDirectory = path.join(root, 'models')
  const sourcePath = path.join(sourceDirectory, 'legacy-model.bin')
  const archivePath = path.join(root, 'archive.zip')
  await mkdir(sourceDirectory)
  const block = Buffer.alloc(32 * 1024 * 1024, 0x5a)
  await writeFile(sourcePath, block)
  const file = await archiveSourceFile(sourcePath, 'models/legacy-model.bin')
  let ticks = 0
  const timer = setInterval(() => {
    ticks += 1
  }, 1)

  try {
    const result = await createLegacyArchive({
      archivePath,
      createdAt: '2026-08-23T00:00:00.000Z',
      sourceDirectories: [{ name: 'models', fileCount: 1, sizeBytes: block.byteLength }],
      files: [file]
    })
    expect(result.archiveSizeBytes).toBeGreaterThan(block.byteLength)
  } finally {
    clearInterval(timer)
  }

  expect(ticks).toBeGreaterThan(0)
  const verified = await verifyLegacyArchive(archivePath)
  expect(verified.files).toEqual([
    {
      path: 'models/legacy-model.bin',
      sizeBytes: block.byteLength,
      sha256: createHash('sha256').update(block).digest('hex')
    }
  ])
})

it('verifies compressed archives created by the previous implementation', async () => {
  const root = await temporaryDirectory('ls101-compressed-archive-')
  const archivePath = path.join(root, 'legacy.zip')
  const content = strToU8('legacy data')
  const manifest = {
    formatVersion: 1,
    createdAt: '2026-08-23T00:00:00.000Z',
    sourceDirectories: [{ name: 'drafts', fileCount: 1, sizeBytes: content.byteLength }],
    files: [
      {
        path: 'drafts/draft.json',
        sizeBytes: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex')
      }
    ]
  }
  await writeFile(
    archivePath,
    zipSync(
      {
        'drafts/draft.json': content,
        'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`)
      },
      { level: 6, os: 3 }
    )
  )

  const verified = await verifyLegacyArchive(archivePath)

  expect(JSON.parse(verified.manifestText)).toEqual(manifest)
  expect(verified.files).toEqual(manifest.files)
  expect(verified.archiveSizeBytes).toBe((await readFile(archivePath)).byteLength)
})

async function archiveSourceFile(
  sourcePath: string,
  archivePath: string
): Promise<LegacyArchiveSourceFile> {
  const stats = await stat(sourcePath)
  return {
    sourcePath,
    archivePath,
    sizeBytes: stats.size,
    identity: { device: String(stats.dev), inode: String(stats.ino) }
  }
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(directory)
  return directory
}
