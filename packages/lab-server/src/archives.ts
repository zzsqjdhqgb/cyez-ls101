import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, readFile, rename, rm, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import { Zip, ZipPassThrough } from 'fflate'
import { decodeExamPackage, decodeSubmissionPackage } from '@ls101/exam-package'
import type { Schema, RequestBody } from '@ls101/lab-contracts'
import type { LabService, Context, Result } from './service'
import type { Principal } from './security'
import { ensureSpace, syncDirectory, verifiedFile } from './durable-files'
import { requireCondition, LabError } from './errors'

interface ExamRow {
  id: string
  package_id: string
  digest: string
  archive_id: string
  deleted_at: number | null
  data: string
}
interface SubmissionRow {
  id: string
  device_id: string
  digest: string
  archive_id: string
  receipt_id: string
  received_at: number
  deleted_at: number | null
  data: string
}
interface GrantRow {
  id: string
  device_id: string
  credential_id: string
  exam_id: string
  data: string
}
interface GrantData extends Schema<'PracticeGrant'> {
  request: Schema<'PracticeRequest'>
  packageId: string
}
type ArchiveKind = 'exams' | 'submissions' | 'test'

export class ArchiveStore {
  constructor(readonly service: LabService) {}

  path(kind: ArchiveKind, id: string): string {
    requireCondition(/^[0-9a-f-]{36}$/.test(id), 'STORAGE_UNAVAILABLE')
    return kind === 'test'
      ? join(this.service.options.root, 'test-data', `${id}.lssubmission`)
      : join(
          this.service.options.root,
          'archives',
          kind,
          `${id}.${kind === 'exams' ? 'lsexam' : 'lssubmission'}`
        )
  }

  exam(id: string, allowDeleted = false): ExamRow {
    const row = this.service.db.get<ExamRow>('SELECT * FROM exams WHERE id=?', id)
    requireCondition(row && (allowDeleted || row.deleted_at === null), 'NOT_FOUND')
    return row
  }

  submission(id: string, allowDeleted = false): SubmissionRow {
    const row = this.service.db.get<SubmissionRow>('SELECT * FROM submissions WHERE id=?', id)
    requireCondition(row && (allowDeleted || row.deleted_at === null), 'NOT_FOUND')
    return row
  }

  grant(context: Context, id: string): GrantRow {
    const principal = context.principal as Extract<Principal, { role: 'student' }>
    const row = this.service.db.get<GrantRow>(
      'SELECT * FROM practice_grants WHERE id=? AND device_id=?',
      id,
      principal.deviceId
    )
    requireCondition(row, 'NOT_FOUND')
    return row
  }

  receipt(row: SubmissionRow): Schema<'CompletedReceipt'> {
    const data = JSON.parse(row.data) as Schema<'Submission'>
    return row.deleted_at === null
      ? { status: 'received', receipt: data.receipt }
      : {
          status: 'deleted',
          receipt: data.receipt,
          deletedAt: new Date(row.deleted_at).toISOString()
        }
  }

  async receive<T>(
    context: Context,
    kind: ArchiveKind,
    resourceId: string,
    commit: (
      archiveId: string,
      digest: string,
      bytes: number,
      buffer: Uint8Array
    ) => Promise<() => T>
  ): Promise<T> {
    const { db } = this.service
    this.service.assertAuthorized(context, kind === 'submissions')
    const release = db.gate.enter()
    const archiveId = randomUUID(),
      uploadId = randomUUID()
    const temporary = join(this.service.options.root, 'incoming', `${uploadId}.part`)
    const target = this.path(kind, archiveId)
    const declared = context.headers['x-ls101-archive-sha256']!
    const limit =
      kind === 'exams'
        ? this.service.data().limits.maxExamArchiveBytes
        : this.service.data().limits.maxSubmissionArchiveBytes
    const expectedLength = Number(context.headers['content-length'])
    const owner =
      context.principal!.role === 'teacher'
        ? 'teacher'
        : (context.principal as Extract<Principal, { role: 'student' }>).deviceId
    const controller = new AbortController()
    const abort = (): void => controller.abort(context.signal.reason)
    context.signal.addEventListener('abort', abort, { once: true })
    if (context.signal.aborted) abort()
    let published = false,
      committed = false,
      reserved = false
    let received = 0
    try {
      requireCondition(
        context.stream && Number.isSafeInteger(expectedLength) && expectedLength > 0,
        'INVALID_REQUEST'
      )
      requireCondition(expectedLength <= limit, 'PAYLOAD_TOO_LARGE')
      await ensureSpace(this.service.options.root, expectedLength)
      db.transaction(() => {
        this.service.assertAuthorized(context, kind === 'submissions')
        requireCondition(
          !db.get('SELECT id FROM uploads WHERE kind=? AND resource_id=?', kind, resourceId),
          'RESOURCE_BUSY'
        )
        if (
          db.get<{ count: number }>('SELECT COUNT(*) AS count FROM uploads')!.count >= 8 ||
          (kind === 'submissions' &&
            db.get('SELECT id FROM uploads WHERE owner=? AND kind=?', owner, kind))
        )
          throw new LabError('RATE_LIMITED', undefined, 1)
        db.run(
          'INSERT INTO uploads VALUES (?,?,?,?,?,?,?)',
          uploadId,
          kind,
          resourceId,
          owner,
          declared,
          archiveId,
          this.service.now()
        )
        reserved = true
      }, release)
      if (kind === 'submissions') this.service.transfers.set(uploadId, controller)
      await this.service.options.fault?.('upload-reserved')
      const handle = await open(temporary, 'wx', 0o600)
      const digest = createHash('sha256')
      const timeout = setTimeout(() => controller.abort(new LabError('RESOURCE_BUSY')), 120000)
      try {
        for await (const chunk of context.stream) {
          controller.signal.throwIfAborted()
          received += chunk.byteLength
          requireCondition(received <= limit && received <= expectedLength, 'PAYLOAD_TOO_LARGE')
          digest.update(chunk)
          await handle.writeFile(chunk)
        }
        controller.signal.throwIfAborted()
        requireCondition(received === expectedLength, 'INVALID_REQUEST')
        requireCondition(digest.digest('hex') === declared, 'CONTENT_CONFLICT')
        await handle.sync()
        await this.service.options.fault?.('upload-file-synced')
      } finally {
        clearTimeout(timeout)
        await handle.close()
      }
      const apply = await commit(archiveId, declared, received, await readFile(temporary))
      controller.signal.throwIfAborted()
      await rename(temporary, target)
      published = true
      await syncDirectory(dirname(target))
      await this.service.options.fault?.('upload-file-published')
      const result = db.transaction(() => {
        this.service.assertAuthorized(context, kind === 'submissions')
        if (db.gate.closed) throw new LabError('SERVICE_NOT_READY', undefined, 1)
        const value = apply()
        db.run('DELETE FROM uploads WHERE id=?', uploadId)
        return value
      }, release)
      committed = true
      await this.service.options.fault?.('upload-committed')
      return result
    } finally {
      try {
        if (!committed && reserved)
          db.transaction(() => {
            db.run('DELETE FROM uploads WHERE id=?', uploadId)
            if (published)
              db.run(
                'INSERT OR IGNORE INTO file_gc VALUES (?,?,?)',
                target,
                received,
                'uncommitted-upload'
              )
          }, release)
      } finally {
        this.service.transfers.delete(uploadId)
        context.signal.removeEventListener('abort', abort)
        release()
        await rm(temporary, { force: true })
      }
    }
  }

  async download(kind: 'exams' | 'submissions', row: ExamRow | SubmissionRow): Promise<Result> {
    const data = JSON.parse(row.data) as Schema<'Exam'> | Schema<'Submission'>
    const filename = this.path(kind, row.archive_id)
    const references = this.service.fileReferences
    references.set(filename, (references.get(filename) ?? 0) + 1)
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      const remaining = (references.get(filename) ?? 1) - 1
      if (remaining === 0) references.delete(filename)
      else references.set(filename, remaining)
    }
    try {
      await verifiedFile(filename, data.archiveBytes, row.digest)
      return {
        status: 200,
        file: filename,
        digest: row.digest,
        release,
        filename: `${row.id}.${kind === 'exams' ? 'lsexam' : 'lssubmission'}`,
        contentType:
          kind === 'exams' ? 'application/x-ls101-exam' : 'application/x-ls101-submission'
      }
    } catch (error) {
      release()
      throw error
    }
  }

  deleteSubmission(id: string): 'deleted' | 'already-deleted' {
    const row = this.submission(id, true)
    if (row.deleted_at !== null) return 'already-deleted'
    const data = JSON.parse(row.data) as Schema<'Submission'>
    this.service.db.run('UPDATE submissions SET deleted_at=? WHERE id=?', this.service.now(), id)
    this.service.db.run(
      'INSERT OR IGNORE INTO file_gc VALUES (?,?,?)',
      this.path('submissions', row.archive_id),
      data.archiveBytes,
      'teacher-deleted'
    )
    return 'deleted'
  }

  async collectGarbage(): Promise<void> {
    const { db } = this.service
    if (db.gate.closed) return
    const release = db.gate.enter()
    try {
      for (const row of db.all<{ path: string; reason: string }>(
        'SELECT path,reason FROM file_gc'
      )) {
        if (this.service.fileReferences.has(row.path)) continue
        try {
          await this.service.options.fault?.('gc-before-remove')
          await rm(row.path, { force: true, recursive: row.reason === 'backup-staging' })
          await syncDirectory(dirname(row.path))
        } catch {
          continue
        }
        db.transaction(() => db.run('DELETE FROM file_gc WHERE path=?', row.path), release)
      }
    } finally {
      release()
    }
  }

  async recover(): Promise<void> {
    const { db } = this.service
    for (const kind of ['exams', 'submissions'] as const) {
      for (const row of db.all<ExamRow | SubmissionRow>(
        `SELECT * FROM ${kind} WHERE deleted_at IS NULL`
      )) {
        const data = JSON.parse(row.data) as { archiveBytes: number }
        try {
          requireCondition(
            (await stat(this.path(kind, row.archive_id))).size === data.archiveBytes,
            'STORAGE_UNAVAILABLE'
          )
        } catch {
          throw new LabError('STORAGE_UNAVAILABLE')
        }
      }
    }
    const uploads = db.all<{ id: string; kind: ArchiveKind; archive_id: string }>(
      'SELECT * FROM uploads'
    )
    db.transaction(() => {
      for (const upload of uploads) {
        db.run(
          'INSERT OR IGNORE INTO file_gc VALUES (?,?,?)',
          this.path(upload.kind, upload.archive_id),
          0,
          'recovered-upload'
        )
        db.run(
          'INSERT OR IGNORE INTO file_gc VALUES (?,?,?)',
          join(this.service.options.root, 'incoming', `${upload.id}.part`),
          0,
          'recovered-upload'
        )
      }
      db.run('DELETE FROM uploads')
    })
  }
}

export function registerArchiveHandlers(service: LabService, store: ArchiveStore): void {
  const { db, handlers } = service
  handlers.postTeacherExams = (context) =>
    store.receive(context, 'exams', randomUUID(), async (archiveId, digest, bytes, buffer) => {
      const archive = await decodeExamPackage(buffer, service.data().limits).catch(() => {
        throw new LabError('INVALID_EXAM')
      })
      const metadata: Schema<'Exam'> = {
        examId: randomUUID(),
        packageId: archive.exam.packageId,
        title: archive.exam.examData.title,
        archiveSha256: digest,
        archiveBytes: bytes,
        pageCount: archive.exam.examData.player.pages.length,
        resourceCount: Object.keys(archive.resources).length,
        published: true,
        importedAt: service.timestamp(),
        revision: 1
      }
      return () => {
        const existing = db.get<ExamRow>(
          'SELECT * FROM exams WHERE package_id=? AND deleted_at IS NULL',
          metadata.packageId
        )
        if (existing) {
          requireCondition(existing.digest === digest, 'CONTENT_CONFLICT')
          db.run(
            'INSERT OR IGNORE INTO file_gc VALUES (?,?,?)',
            store.path('exams', archiveId),
            bytes,
            'duplicate-exam'
          )
          return { status: 200, body: { ...JSON.parse(existing.data), duplicate: true } }
        }
        db.run(
          'INSERT INTO exams VALUES (?,?,?,?,NULL,?)',
          metadata.examId,
          metadata.packageId,
          digest,
          archiveId,
          JSON.stringify(metadata)
        )
        return { status: 201, body: { ...metadata, duplicate: false } }
      }
    })
  handlers.getTeacherExams = (context) => {
    const { published, q } = context.query
    const exams = db
      .all<{ data: string }>(
        "SELECT data FROM exams WHERE deleted_at IS NULL ORDER BY json_extract(data,'$.importedAt') DESC,id DESC"
      )
      .map((row) => JSON.parse(row.data) as Schema<'Exam'>)
      .filter(
        (exam) =>
          (published === undefined || published === exam.published) &&
          (!q || exam.title.toLowerCase().includes(String(q).toLowerCase()))
      )
    return { status: 200, body: service.page(context, exams, (exam) => exam.examId) }
  }
  handlers.getTeacherExamsExamId = (context) => ({
    status: 200,
    body: JSON.parse(store.exam(context.path.examId).data)
  })
  handlers.getTeacherExamsExamIdArchive = (context) =>
    store.download('exams', store.exam(context.path.examId))
  handlers.patchTeacherExamsExamId = (context) =>
    service.write(context, () => {
      const body = context.body as RequestBody<'patchTeacherExamsExamId'>
      const row = store.exam(context.path.examId),
        metadata = JSON.parse(row.data) as Schema<'Exam'>
      requireCondition(metadata.revision === body.expectedRevision, 'REVISION_CONFLICT', {
        revision: metadata.revision
      })
      if (metadata.published !== body.published) {
        metadata.published = body.published
        metadata.revision++
        db.run('UPDATE exams SET data=? WHERE id=?', JSON.stringify(metadata), row.id)
      }
      return { status: 200, body: metadata }
    })
  handlers.deleteTeacherExamsExamId = (context) =>
    service.write(context, () => {
      const row = store.exam(context.path.examId, true)
      if (row.deleted_at === null) {
        db.run('UPDATE exams SET deleted_at=? WHERE id=?', service.now(), row.id)
        db.run(
          'INSERT OR IGNORE INTO file_gc VALUES (?,?,?)',
          store.path('exams', row.archive_id),
          (JSON.parse(row.data) as Schema<'Exam'>).archiveBytes,
          'teacher-deleted'
        )
      }
      return { status: 204 }
    })
  handlers.getStudentExams = (context) => {
    service.assertAuthorized(context, true)
    const result = handlers.getTeacherExams!({
      ...context,
      query: { ...context.query, published: true }
    }) as Result
    return result
  }
  handlers.getStudentExamsExamIdArchive = (context) => {
    service.assertAuthorized(context, true)
    const row = store.exam(context.path.examId)
    requireCondition((JSON.parse(row.data) as Schema<'Exam'>).published, 'NOT_FOUND')
    return store.download('exams', row)
  }
  handlers.putStudentPracticesSubmissionId = (context) =>
    service.write(
      context,
      () => {
        const body = context.body as Schema<'PracticeRequest'>
        const principal = context.principal as Extract<Principal, { role: 'student' }>
        const exam = store.exam(body.examId),
          metadata = JSON.parse(exam.data) as Schema<'Exam'>
        requireCondition(metadata.published, 'NOT_FOUND')
        requireCondition(body.archiveSha256 === exam.digest, 'CONTENT_CONFLICT')
        const existing = db.get<GrantRow>(
          'SELECT * FROM practice_grants WHERE id=?',
          context.path.submissionId
        )
        if (existing) {
          const data = JSON.parse(existing.data) as GrantData
          requireCondition(
            existing.device_id === principal.deviceId &&
              service.operationDigest(body) === service.operationDigest(data.request),
            'CONTENT_CONFLICT'
          )
          requireCondition(Date.parse(data.startBefore) > service.now(), 'RESOURCE_BUSY')
          return {
            status: 200,
            body: {
              submissionId: data.submissionId,
              grantedAt: data.grantedAt,
              startBefore: data.startBefore,
              modeRevision: data.modeRevision
            }
          }
        }
        const grant: Schema<'PracticeGrant'> = {
          submissionId: context.path.submissionId,
          grantedAt: service.timestamp(),
          startBefore: new Date(service.now() + 30000).toISOString(),
          modeRevision: service.data().modeRevision
        }
        db.run(
          'INSERT INTO practice_grants VALUES (?,?,?,?,?)',
          grant.submissionId,
          principal.deviceId,
          principal.credentialId,
          exam.id,
          JSON.stringify({
            ...grant,
            request: body,
            packageId: exam.package_id
          } satisfies GrantData)
        )
        return { status: 201, body: grant }
      },
      true
    )
  handlers.putStudentSubmissionsSubmissionId = async (context) => {
    service.assertAuthorized(context, true)
    const grant = store.grant(context, context.path.submissionId)
    const existing = db.get<SubmissionRow>('SELECT * FROM submissions WHERE id=?', grant.id)
    if (existing) {
      requireCondition(
        existing.digest === context.headers['x-ls101-archive-sha256'],
        'CONTENT_CONFLICT'
      )
      return { status: 200, body: store.receipt(existing) }
    }
    return store.receive(
      context,
      'submissions',
      grant.id,
      async (archiveId, digest, bytes, buffer) => {
        const { submission } = await decodeSubmissionPackage(buffer, service.data().limits).catch(
          () => {
            throw new LabError('INVALID_SUBMISSION')
          }
        )
        const data = JSON.parse(grant.data) as GrantData
        requireCondition(
          submission.meta.submissionId === grant.id &&
            submission.meta.examPackageId === data.packageId &&
            service.operationDigest(submission.meta.candidate) ===
              service.operationDigest(data.request.candidate),
          'INVALID_SUBMISSION'
        )
        return () => {
          store.grant(context, grant.id)
          const receipt: Schema<'Receipt'> = {
            receiptId: randomUUID(),
            serverId: service.identity.serverId,
            deviceId: grant.device_id,
            submissionId: grant.id,
            archiveSha256: digest,
            receivedAt: service.timestamp()
          }
          const device = service.publicDevice(grant.device_id)
          const metadata: Schema<'Submission'> = {
            id: grant.id,
            examId: grant.exam_id,
            packageId: data.packageId,
            candidate: data.request.candidate,
            submittedAt: submission.meta.submittedAt,
            receipt,
            archiveBytes: bytes,
            deviceAtReceipt: {
              id: device.id,
              number: device.number,
              room: device.room,
              seat: device.seat,
              displayName: device.displayName
            },
            currentDevice: device
          }
          db.run(
            'INSERT INTO submissions VALUES (?,?,?,?,?,?,NULL,?)',
            grant.id,
            grant.device_id,
            digest,
            archiveId,
            receipt.receiptId,
            service.now(),
            JSON.stringify(metadata)
          )
          return { status: 201, body: { status: 'received', receipt } }
        }
      }
    )
  }
  handlers.getStudentSubmissionsSubmissionIdReceipt = (context) => {
    service.assertAuthorized(context, true)
    const grant = store.grant(context, context.path.submissionId)
    const row = db.get<SubmissionRow>('SELECT * FROM submissions WHERE id=?', grant.id)
    return {
      status: 200,
      body: row
        ? store.receipt(row)
        : db.get('SELECT id FROM uploads WHERE kind=? AND resource_id=?', 'submissions', grant.id)
          ? { status: 'receiving', retryAfterSeconds: 5 }
          : { status: 'not-received' }
    }
  }
  handlers.getTeacherSubmissions = (context) => {
    const q = context.query
    const entries = db
      .all<SubmissionRow>(
        'SELECT * FROM submissions WHERE deleted_at IS NULL ORDER BY received_at DESC,id DESC'
      )
      .map((row) => {
        const metadata = JSON.parse(row.data) as Schema<'Submission'>
        return { ...metadata, currentDevice: service.publicDevice(row.device_id) }
      })
      .filter(
        (row) =>
          (!q.examId || row.examId === q.examId) &&
          (!q.deviceId || row.currentDevice.id === q.deviceId) &&
          (!q.room || row.deviceAtReceipt.room === q.room) &&
          (!q.candidateId || row.candidate.candidateId.includes(String(q.candidateId))) &&
          (!q.displayName || row.candidate.displayName.includes(String(q.displayName))) &&
          (!q.from || row.receipt.receivedAt >= String(q.from)) &&
          (!q.before || row.receipt.receivedAt < String(q.before))
      )
    return { status: 200, body: service.page(context, entries, (row) => row.id) }
  }
  handlers.getTeacherSubmissionsId = (context) => {
    const row = store.submission(context.path.id)
    return {
      status: 200,
      body: { ...JSON.parse(row.data), currentDevice: service.publicDevice(row.device_id) }
    }
  }
  handlers.getTeacherSubmissionsIdArchive = (context) =>
    store.download('submissions', store.submission(context.path.id))
  handlers.deleteTeacherSubmissionsId = (context) =>
    service.write(context, () => {
      store.deleteSubmission(context.path.id)
      return { status: 204 }
    })
  handlers.postTeacherSubmissionsDelete = (context) => {
    const body = context.body as Schema<'SubmissionSelection'>
    const digest = service.operationDigest(body),
      replay = service.replay(context, digest)
    if (replay) return replay
    // Persist the fixed result with the changes; replay cannot grow the selected scope.
    return service.write(context, () => {
      const previous = service.replay(context, digest)
      if (previous) return previous
      const items: Schema<'BatchDeleteResult'>['items'] = body.submissionIds.map((submissionId) => {
        try {
          return { submissionId, status: store.deleteSubmission(submissionId) }
        } catch (error) {
          if (!(error instanceof LabError) || error.code !== 'NOT_FOUND') throw error
          return {
            submissionId,
            status: 'failed',
            error: { code: error.code, message: error.message, requestId: randomUUID() }
          }
        }
      })
      return service.remember(context, digest, { status: 200, body: { items } })
    })
  }
  handlers.postTeacherSubmissionsExport = async (context) => {
    const body = context.body as Schema<'SubmissionSelection'>
    const downloads: Result[] = []
    const temporary = join(service.options.root, 'incoming', `${randomUUID()}.zip`)
    try {
      // Acquire every reference synchronously before the first asynchronous integrity check.
      const rows = body.submissionIds.map((id) => store.submission(id))
      const pending = rows.map((row) => store.download('submissions', row))
      const results = await Promise.allSettled(pending)
      for (const result of results) if (result.status === 'fulfilled') downloads.push(result.value)
      requireCondition(
        results.every((result) => result.status === 'fulfilled'),
        'NOT_FOUND'
      )
      await zipFiles(downloads, temporary, context.signal)
      return {
        status: 200,
        file: temporary,
        filename: 'submissions.zip',
        contentType: 'application/zip',
        release: () => {
          for (const item of downloads) item.release?.()
          void rm(temporary, { force: true })
        }
      }
    } catch (error) {
      for (const item of downloads) item.release?.()
      await rm(temporary, { force: true })
      throw error
    }
  }
}

async function zipFiles(files: Result[], target: string, signal: AbortSignal): Promise<void> {
  const output = createWriteStream(target, { flags: 'wx', mode: 0o600 })
  let failure: Error | null = null
  const completion = finished(output)
  void completion.catch(() => undefined)
  const zip = new Zip((error, data, final) => {
    if (error) {
      failure = error
      output.destroy(error)
      return
    }
    output.write(data)
    if (final) output.end()
  })
  try {
    for (const file of files) {
      const entry = new ZipPassThrough(file.filename!)
      zip.add(entry)
      for await (const chunk of createReadStream(file.file!)) {
        signal.throwIfAborted()
        if (failure) throw failure
        entry.push(chunk as Uint8Array)
        if (output.writableNeedDrain) await once(output, 'drain', { signal })
      }
      entry.push(new Uint8Array(), true)
    }
    zip.end()
    await completion
  } catch (error) {
    output.destroy()
    zip.terminate()
    throw error
  }
}
