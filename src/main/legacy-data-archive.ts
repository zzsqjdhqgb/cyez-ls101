import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import { strToU8, Unzip, UnzipInflate, Zip, ZipPassThrough } from 'fflate'
import type { LegacyDataSourceInfo } from '@ls101/core-types'

const MANIFEST_FILENAME = 'manifest.json'
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024

export interface LegacyArchiveSourceFile {
  archivePath: string
  sourcePath: string
  sizeBytes: number
  identity: { device: string; inode: string }
}

export interface LegacyArchiveManifest {
  formatVersion: 1
  createdAt: string
  sourceDirectories: LegacyDataSourceInfo[]
  files: Array<{ path: string; sizeBytes: number; sha256: string }>
}

export interface CreateLegacyArchiveRequest {
  archivePath: string
  createdAt: string
  sourceDirectories: LegacyDataSourceInfo[]
  files: LegacyArchiveSourceFile[]
}

export interface CreateLegacyArchiveResult {
  archiveSizeBytes: number
  archiveSha256: string
  manifest: LegacyArchiveManifest
}

export interface VerifyLegacyArchiveResult {
  archiveSizeBytes: number
  archiveSha256: string
  manifestText: string
  files: Array<{ path: string; sizeBytes: number; sha256: string }>
}

export interface LegacyArchiveOperations {
  create(request: CreateLegacyArchiveRequest): Promise<CreateLegacyArchiveResult>
  verify(archivePath: string): Promise<VerifyLegacyArchiveResult>
}

export const inProcessLegacyArchiveOperations: LegacyArchiveOperations = {
  create: createLegacyArchive,
  verify: verifyLegacyArchive
}

export async function createLegacyArchive(
  request: CreateLegacyArchiveRequest
): Promise<CreateLegacyArchiveResult> {
  const manifestFiles: LegacyArchiveManifest['files'] = []
  for (const file of request.files) {
    const measured = await hashSourceFile(file)
    manifestFiles.push({
      path: file.archivePath,
      sizeBytes: measured.sizeBytes,
      sha256: measured.sha256
    })
  }

  const manifest: LegacyArchiveManifest = {
    formatVersion: 1,
    createdAt: request.createdAt,
    sourceDirectories: request.sourceDirectories,
    files: manifestFiles.sort((left, right) => left.path.localeCompare(right.path))
  }
  const generated = await writeArchiveAtomically(request.archivePath, request.files, manifest)
  return { ...generated, manifest }
}

export async function verifyLegacyArchive(archivePath: string): Promise<VerifyLegacyArchiveResult> {
  const archiveHash = createHash('sha256')
  let archiveSizeBytes = 0
  let failure: unknown
  let manifestSize = 0
  const manifestChunks: Uint8Array[] = []
  const files: VerifyLegacyArchiveResult['files'] = []
  const paths = new Set<string>()

  const unzip = new Unzip((file) => {
    if (paths.has(file.name)) {
      failure ??= new Error('旧数据归档包含重复路径')
      return
    }
    paths.add(file.name)
    const hash = createHash('sha256')
    let sizeBytes = 0
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure ??= error
        return
      }
      if (chunk) {
        sizeBytes += chunk.byteLength
        hash.update(chunk)
        if (file.name === MANIFEST_FILENAME) {
          manifestSize += chunk.byteLength
          if (manifestSize > MAX_MANIFEST_BYTES) {
            failure ??= new Error('旧数据归档清单过大')
          } else {
            manifestChunks.push(chunk.slice())
          }
        }
      }
      if (final && file.name !== MANIFEST_FILENAME) {
        files.push({ path: file.name, sizeBytes, sha256: hash.digest('hex') })
      }
    }
    try {
      file.start()
    } catch (error) {
      failure ??= error
    }
  })
  unzip.register(UnzipInflate)

  try {
    for await (const chunk of createReadStream(archivePath)) {
      const data = asUint8Array(chunk)
      archiveHash.update(data)
      archiveSizeBytes += data.byteLength
      unzip.push(data)
      if (failure) throw failure
    }
    unzip.push(new Uint8Array(), true)
    if (failure) throw failure
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
    throw new Error('旧数据归档无法读取', { cause: error })
  }

  if (!paths.has(MANIFEST_FILENAME)) throw new Error('旧数据归档缺少清单文件')
  return {
    archiveSizeBytes,
    archiveSha256: archiveHash.digest('hex'),
    manifestText: Buffer.concat(manifestChunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
    files
  }
}

async function writeArchiveAtomically(
  archivePath: string,
  files: LegacyArchiveSourceFile[],
  manifest: LegacyArchiveManifest
): Promise<{ archiveSizeBytes: number; archiveSha256: string }> {
  const temporaryPath = `${archivePath}.${randomUUID()}.tmp`
  await mkdir(path.dirname(archivePath), { recursive: true })
  const output = createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 })
  const outputFinished = finished(output)
  void outputFinished.catch(() => undefined)
  const archiveHash = createHash('sha256')
  let archiveSizeBytes = 0
  let outputDrain: Promise<void> | null = null
  let archiveError: unknown
  let completed = false

  output.once('error', (error) => {
    archiveError ??= error
  })

  const archive = new Zip((error, chunk, final) => {
    if (error) {
      archiveError ??= error
      output.destroy(error)
      return
    }
    if (chunk?.byteLength) {
      archiveHash.update(chunk)
      archiveSizeBytes += chunk.byteLength
      if (!output.write(Buffer.from(chunk))) {
        outputDrain = Promise.race([
          once(output, 'drain').then(() => undefined),
          outputFinished.then(() => undefined)
        ])
      }
    }
    if (final) output.end()
  })

  const waitForOutput = async (): Promise<void> => {
    if (outputDrain) {
      await outputDrain
      outputDrain = null
    }
    if (archiveError) throw archiveError
  }

  try {
    for (const file of files) {
      const entry = new ZipPassThrough(file.archivePath)
      entry.os = 3
      archive.add(entry)
      const measured = await hashSourceFile(file, async (chunk) => {
        entry.push(chunk)
        await waitForOutput()
      })
      entry.push(new Uint8Array(), true)
      await waitForOutput()
      const expected = manifest.files.find((candidate) => candidate.path === file.archivePath)
      if (
        !expected ||
        measured.sizeBytes !== expected.sizeBytes ||
        measured.sha256 !== expected.sha256
      ) {
        throw new Error(`旧数据在归档期间发生变化：${file.sourcePath}`)
      }
    }

    const manifestEntry = new ZipPassThrough(MANIFEST_FILENAME)
    manifestEntry.os = 3
    archive.add(manifestEntry)
    manifestEntry.push(strToU8(`${JSON.stringify(manifest, null, 2)}\n`), true)
    await waitForOutput()
    archive.end()
    await outputFinished
    if (archiveError) throw archiveError

    const handle = await open(temporaryPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, archivePath)
    completed = true
    return { archiveSizeBytes, archiveSha256: archiveHash.digest('hex') }
  } finally {
    if (!completed) {
      archive.terminate()
      output.destroy()
      await outputFinished.catch(() => undefined)
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

async function hashSourceFile(
  file: LegacyArchiveSourceFile,
  onChunk?: (chunk: Uint8Array) => Promise<void>
): Promise<{ sizeBytes: number; sha256: string }> {
  const before = await lstat(file.sourcePath)
  assertExpectedSourceFile(file, before)
  const hash = createHash('sha256')
  let sizeBytes = 0
  for await (const chunk of createReadStream(file.sourcePath)) {
    const data = asUint8Array(chunk)
    sizeBytes += data.byteLength
    hash.update(data)
    await onChunk?.(data)
  }
  const after = await lstat(file.sourcePath)
  assertExpectedSourceFile(file, after)
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
    throw new Error(`旧数据在归档期间发生变化：${file.sourcePath}`)
  }
  if (sizeBytes !== file.sizeBytes) {
    throw new Error(`旧数据在归档期间发生变化：${file.sourcePath}`)
  }
  return { sizeBytes, sha256: hash.digest('hex') }
}

function assertExpectedSourceFile(
  file: LegacyArchiveSourceFile,
  stats: Awaited<ReturnType<typeof lstat>>
): void {
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    String(stats.dev) !== file.identity.device ||
    String(stats.ino) !== file.identity.inode ||
    stats.size !== file.sizeBytes
  ) {
    throw new Error(`旧数据在归档期间发生变化：${file.sourcePath}`)
  }
}

function asUint8Array(chunk: unknown): Uint8Array {
  if (!(chunk instanceof Uint8Array)) throw new TypeError('文件流返回了无效数据')
  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
}
