import { randomUUID } from 'node:crypto'
import type { RequestBody, Schema } from '@ls101/lab-contracts'
import type { LabService, Context } from './service'
import type { Principal } from './security'
import { requireCondition, LabError } from './errors'
import { deviceDetails } from './devices'
import { TEST_SUITE, TEST_EXAM_DIGEST } from './test-suite'
import { TEST_EXAM_BYTES } from './test-suite'
import { decodeSubmissionPackage } from '@ls101/exam-package'

interface TaskRow {
  id: string
  batch_id: string
  device_id: string
  credential_id: string
  state: Schema<'TaskState'>
  expires_at: number
  data: string
}
interface LeaseRow {
  id: string
  task_id: string
  device_id: string
  runtime_id: string
  expires_at: number
  ended_at: number | null
}
interface StoredReport {
  input: Schema<'TaskResultInput'>
  acknowledgement: Schema<'TaskResult'>
}
type StoredRun = Omit<Schema<'TestRun'>, 'devices' | 'status'> & { deviceIds: string[] }

export class TaskStore {
  constructor(readonly service: LabService) {}

  row(id: string): TaskRow {
    const row = this.service.db.get<TaskRow>('SELECT * FROM tasks WHERE id=?', id)
    requireCondition(row, 'NOT_FOUND')
    return row
  }

  task(row: TaskRow): Schema<'Task'> {
    const task = JSON.parse(row.data) as Schema<'Task'>
    if (
      ['pending', 'running', 'cancel-requested'].includes(task.status) &&
      row.expires_at <= this.service.now()
    )
      return { ...task, status: 'expired' }
    const lease = this.service.db.get<LeaseRow>(
      'SELECT * FROM task_leases WHERE task_id=? AND ended_at IS NULL',
      row.id
    )
    if (lease && lease.expires_at <= this.service.now())
      return { ...task, status: task.status === 'cancel-requested' ? 'cancelled' : 'expired' }
    return task
  }

  update(task: Schema<'Task'>): void {
    this.service.db.run(
      'UPDATE tasks SET state=?,data=? WHERE id=?',
      task.status,
      JSON.stringify(task),
      task.id
    )
  }

  create(
    batchId: string,
    deviceId: string,
    expiresAt: string,
    parameters: Schema<'TaskParameters'>
  ): Schema<'Task'> {
    const credential = this.service.db.get<{ id: string }>(
      'SELECT id FROM device_credentials WHERE device_id=? AND revoked_at IS NULL',
      deviceId
    )
    requireCondition(credential, 'NOT_FOUND')
    const task: Schema<'Task'> = {
      id: randomUUID(),
      deviceId,
      status: 'pending',
      expiresAt,
      parameters,
      revision: 1
    }
    this.service.db.run(
      'INSERT INTO tasks VALUES (?,?,?,?,?,?,?)',
      task.id,
      batchId,
      deviceId,
      credential.id,
      task.status,
      Date.parse(expiresAt),
      JSON.stringify(task)
    )
    return task
  }

  assertMaintenance(context: Context): void {
    this.service.assertAuthorized(context)
    requireCondition(
      this.service.data().mode === 'maintenance',
      'RESOURCE_BUSY',
      this.service.mode()
    )
  }

  assertTaskOwner(context: Context, row: TaskRow): void {
    const principal = context.principal as Extract<Principal, { role: 'student' }>
    requireCondition(
      row.device_id === principal.deviceId && row.credential_id === principal.credentialId,
      'NOT_FOUND'
    )
  }

  lease(
    context: Context,
    taskId: string,
    leaseId: string,
    runtimeId?: string
  ): { row: TaskRow; lease: LeaseRow; task: Schema<'Task'> } {
    this.assertMaintenance(context)
    const row = this.row(taskId)
    this.assertTaskOwner(context, row)
    const lease = this.service.db.get<LeaseRow>(
      'SELECT * FROM task_leases WHERE id=? AND task_id=?',
      leaseId,
      taskId
    )
    requireCondition(
      lease &&
        lease.ended_at === null &&
        lease.expires_at > this.service.now() &&
        row.expires_at > this.service.now(),
      'RESOURCE_BUSY'
    )
    if (runtimeId) {
      const current = this.service.db.get<{ runtime_id: string }>(
        'SELECT runtime_id FROM heartbeats WHERE credential_id=?',
        row.credential_id
      )
      requireCondition(
        current?.runtime_id === runtimeId && lease.runtime_id === runtimeId,
        'RESOURCE_BUSY'
      )
    }
    requireCondition(['running', 'cancel-requested'].includes(row.state), 'RESOURCE_BUSY')
    return { row, lease, task: this.task(row) }
  }

  leaseResponse(task: Schema<'Task'>, lease: LeaseRow): Schema<'TaskLease'> {
    return {
      taskId: task.id,
      runtimeId: lease.runtime_id,
      leaseId: lease.id,
      leaseExpiresAt: new Date(lease.expires_at).toISOString(),
      serverTime: this.service.timestamp(),
      cancelRequested: task.status === 'cancel-requested',
      parameters: task.parameters
    }
  }

  cancelBatch(batchId: string): void {
    for (const row of this.service.db.all<TaskRow>(
      'SELECT * FROM tasks WHERE batch_id=?',
      batchId
    )) {
      const task = this.task(row)
      if (task.status === 'pending')
        this.update({ ...task, status: 'cancelled', revision: task.revision + 1 })
      else if (task.status === 'running')
        this.update({ ...task, status: 'cancel-requested', revision: task.revision + 1 })
    }
  }

  result(row: TaskRow): StoredReport | undefined {
    const report = this.service.db.get<{ data: string }>(
      'SELECT data FROM task_results WHERE task_id=? ORDER BY rowid DESC LIMIT 1',
      row.id
    )
    return report ? JSON.parse(report.data) : undefined
  }

  run(id: string): Schema<'TestRun'> {
    const record = this.service.db.get<{ data: string }>(
      'SELECT data FROM test_runs WHERE id=?',
      id
    )
    requireCondition(record, 'NOT_FOUND')
    const run = JSON.parse(record.data) as StoredRun
    const rows = this.service.db.all<TaskRow>(
      'SELECT * FROM tasks WHERE batch_id=? ORDER BY device_id',
      id
    )
    const devices = rows.map((row): Schema<'TestDeviceResult'> => {
      const device = deviceDetails(this.service, row.device_id),
        task = this.task(row),
        report = this.result(row)
      const confirmation = this.service.db.get<{ data: string }>(
        'SELECT data FROM test_confirmations WHERE run_id=? AND device_id=?',
        id,
        row.device_id
      )!
      return {
        device: {
          id: device.id,
          number: device.number,
          room: device.room,
          seat: device.seat,
          displayName: device.displayName
        },
        task,
        releaseVersion: device.heartbeat?.releaseVersion ?? null,
        lastHeartbeatAt: device.lastHeartbeatAt,
        cases: report?.input.result?.kind === 'deployment-test' ? report.input.result.cases : [],
        confirmation: JSON.parse(confirmation.data),
        report: report
          ? {
              leaseId: report.input.leaseId,
              status: report.input.status,
              completedAt: report.input.completedAt,
              error: report.input.error
            }
          : null,
        late: report?.acknowledgement.late ?? false
      }
    })
    return {
      id: run.id,
      suiteId: run.suiteId,
      suiteVersion: run.suiteVersion,
      createdAt: run.createdAt,
      expiresAt: run.expiresAt,
      retryOf: run.retryOf,
      status: aggregate(devices.map((device) => device.task.status)),
      devices
    }
  }

  cleanup(id: string): Schema<'CleanupPlan'> {
    const record = this.service.db.get<{ data: string }>(
      'SELECT data FROM cleanup_plans WHERE id=?',
      id
    )
    requireCondition(record, 'NOT_FOUND')
    const plan = JSON.parse(record.data) as Schema<'CleanupPlan'>
    const devices = plan.devices.map((entry) => {
      const row = this.row(entry.executionTaskId ?? entry.previewTaskId)
      const report = this.result(row)
      return {
        ...entry,
        status: this.task(row).status,
        ...(report?.input.result?.kind === 'history-preview'
          ? {
              selectionDigest: report.input.result.selectionDigest,
              selectedCount: report.input.result.selectedCount,
              selectedBytes: report.input.result.selectedBytes,
              previewedAt: report.input.completedAt
            }
          : {}),
        result:
          report?.input.result?.kind === 'history-execute' ? report.input.result : entry.result,
        error: report?.input.error ?? entry.error
      }
    })
    const selected = devices.filter((device) => device.confirmed)
    let status = plan.status
    if (
      plan.expiresAt <= this.service.timestamp() &&
      !['succeeded', 'failed', 'cancelled'].includes(status)
    )
      status = 'expired'
    else if (
      status === 'previewing' &&
      devices.every((device) => !['pending', 'running', 'cancel-requested'].includes(device.status))
    )
      status = 'awaiting-confirmation'
    else if (['executing', 'cancel-requested'].includes(status) && selected.length) {
      const summary = aggregate(selected.map((device) => device.status))
      status = summary === 'pending' || summary === 'running' ? 'executing' : summary
    }
    return { ...plan, status, devices }
  }

  validateResult(task: Schema<'Task'>, body: Schema<'TaskResultInput'>): void {
    if (body.result === null) {
      requireCondition(body.status !== 'succeeded', 'INVALID_REQUEST')
      return
    }
    if (task.parameters.type === 'deployment-test') {
      requireCondition(body.result.kind === 'deployment-test', 'INVALID_REQUEST')
      const ids = body.result.cases.map((item) => item.caseId)
      requireCondition(
        new Set(ids).size === ids.length &&
          ids.every(
            (id) =>
              task.parameters.type === 'deployment-test' && task.parameters.caseIds.includes(id)
          ),
        'INVALID_REQUEST'
      )
      if (body.status === 'succeeded') {
        requireCondition(
          ids.length === task.parameters.caseIds.length &&
            body.result.cases.every((item) => ['passed', 'manual-required'].includes(item.status)),
          'INVALID_REQUEST'
        )
        if (ids.some((id) => ['submission', 'duplicate', 'recovery'].includes(id)))
          requireCondition(
            this.service.db.get('SELECT task_id FROM test_submissions WHERE task_id=?', task.id),
            'INVALID_REQUEST'
          )
      }
    } else if (task.parameters.phase === 'preview')
      requireCondition(body.result.kind === 'history-preview', 'INVALID_REQUEST')
    else {
      requireCondition(body.result.kind === 'history-execute', 'INVALID_REQUEST')
      const result = body.result
      requireCondition(
        result.selectedCount ===
          result.deletedCount +
            result.alreadyAbsentCount +
            result.skippedCount +
            result.failedCount,
        'INVALID_REQUEST'
      )
      const plan = this.cleanup(task.parameters.planId),
        selection = plan.devices.find((device) => device.deviceId === task.deviceId)!
      requireCondition(result.selectedCount === selection.selectedCount, 'INVALID_REQUEST')
      if (body.status === 'succeeded')
        requireCondition(result.failedCount === 0 && result.skippedCount === 0, 'INVALID_REQUEST')
    }
  }
}

function aggregate(states: Schema<'TaskState'>[]): Schema<'TaskState'> {
  for (const state of [
    'cancel-requested',
    'running',
    'pending',
    'cancelled',
    'expired',
    'failed'
  ] as const)
    if (states.includes(state)) return state
  return 'succeeded'
}

export function registerTaskHandlers(service: LabService, store: TaskStore): void {
  const { db, handlers } = service
  const testLease = (context: Context): ReturnType<TaskStore['lease']> => {
    const leaseId = context.headers['x-ls101-task-lease']
    requireCondition(leaseId, 'INVALID_REQUEST')
    const lease = store.lease(context, context.path.taskId, leaseId)
    requireCondition(
      lease.task.parameters.type === 'deployment-test' && lease.task.status === 'running',
      'RESOURCE_BUSY'
    )
    return lease
  }
  handlers.getStudentTasksTaskIdTestExam = (context) => {
    testLease(context)
    return {
      status: 200,
      bytes: TEST_EXAM_BYTES,
      digest: TEST_EXAM_DIGEST,
      filename: 'deployment-test.lsexam',
      contentType: 'application/x-ls101-exam'
    }
  }
  handlers.getStudentTasksTaskIdTestReceipt = (context) => {
    testLease(context)
    const row = db.get<{ data: string }>(
      'SELECT data FROM test_submissions WHERE task_id=?',
      context.path.taskId
    )
    return {
      status: 200,
      body: row
        ? JSON.parse(row.data)
        : db.get(
              'SELECT id FROM uploads WHERE kind=? AND resource_id=?',
              'test',
              context.path.taskId
            )
          ? { status: 'receiving', retryAfterSeconds: 5 }
          : { status: 'not-received' }
    }
  }
  handlers.putStudentTasksTaskIdTestSubmission = (context) => {
    const { task } = testLease(context)
    const existing = db.get<{ digest: string; data: string }>(
      'SELECT digest,data FROM test_submissions WHERE task_id=?',
      task.id
    )
    if (existing) {
      requireCondition(
        existing.digest === context.headers['x-ls101-archive-sha256'],
        'CONTENT_CONFLICT'
      )
      return { status: 200, body: JSON.parse(existing.data) }
    }
    return service.archives.receive(
      context,
      'test',
      task.id,
      async (archiveId, digest, _bytes, buffer) => {
        const { submission } = await decodeSubmissionPackage(buffer, service.data().limits).catch(
          () => {
            throw new LabError('INVALID_SUBMISSION')
          }
        )
        requireCondition(
          task.parameters.type === 'deployment-test' &&
            submission.meta.submissionId === task.parameters.testSubmissionId &&
            submission.meta.examPackageId === 'ls101-lab-test-v1',
          'INVALID_SUBMISSION'
        )
        return () => {
          testLease(context)
          const body: Schema<'Received'> = {
            status: 'received',
            receipt: {
              receiptId: randomUUID(),
              serverId: service.identity.serverId,
              deviceId: task.deviceId,
              submissionId: submission.meta.submissionId,
              archiveSha256: digest,
              receivedAt: service.timestamp()
            }
          }
          db.run(
            'INSERT INTO test_submissions VALUES (?,?,?,?)',
            task.id,
            digest,
            archiveId,
            JSON.stringify(body)
          )
          return { status: 201, body }
        }
      }
    )
  }
  handlers.getStudentTasks = (context) => {
    store.assertMaintenance(context)
    const principal = context.principal as Extract<Principal, { role: 'student' }>
    const rows = db.all<TaskRow>(
      'SELECT * FROM tasks WHERE credential_id=? ORDER BY expires_at,id',
      principal.credentialId
    )
    return {
      status: 200,
      body: service.page(
        context,
        rows
          .map((row) => store.task(row))
          .filter((task) => ['pending', 'running'].includes(task.status)),
        (task) => task.id
      )
    }
  }
  handlers.postStudentTasksIdClaim = (context) =>
    service.write(context, () => {
      store.assertMaintenance(context)
      const row = store.row(context.path.id)
      store.assertTaskOwner(context, row)
      const task = store.task(row),
        body = context.body as RequestBody<'postStudentTasksIdClaim'>
      const current = db.get<{ runtime_id: string }>(
        'SELECT runtime_id FROM heartbeats WHERE credential_id=?',
        row.credential_id
      )
      requireCondition(current?.runtime_id === body.runtimeId, 'RESOURCE_BUSY')
      const backupBlockers = service
        .blockers()
        .filter((blocker) => blocker.kind.startsWith('backup-'))
      if (backupBlockers.length)
        throw new LabError('RESOURCE_BUSY', { blockers: backupBlockers }, 1)
      db.run(
        'UPDATE task_leases SET ended_at=? WHERE ended_at IS NULL AND expires_at<=?',
        service.now(),
        service.now()
      )
      const active = db.get<LeaseRow>(
        'SELECT * FROM task_leases WHERE device_id=? AND ended_at IS NULL',
        row.device_id
      )
      if (active) {
        if (
          active.task_id === row.id &&
          active.runtime_id === body.runtimeId &&
          ['running', 'cancel-requested'].includes(task.status)
        )
          return { status: 200, body: store.leaseResponse(task, active) }
        throw new LabError('RESOURCE_BUSY', {
          blockers: [{ kind: 'active-task-lease', resourceId: active.id }]
        })
      }
      requireCondition(task.status === 'pending', 'RESOURCE_BUSY')
      const lease: LeaseRow = {
        id: randomUUID(),
        task_id: row.id,
        device_id: row.device_id,
        runtime_id: body.runtimeId,
        expires_at: Math.min(row.expires_at, service.now() + 30000),
        ended_at: null
      }
      db.run(
        'INSERT INTO task_leases VALUES (?,?,?,?,?,NULL)',
        lease.id,
        row.id,
        row.device_id,
        lease.runtime_id,
        lease.expires_at
      )
      const running = { ...task, status: 'running' as const, revision: task.revision + 1 }
      store.update(running)
      return { status: 200, body: store.leaseResponse(running, lease) }
    })
  handlers.putStudentTasksIdLease = (context) =>
    service.write(context, () => {
      const body = context.body as RequestBody<'putStudentTasksIdLease'>
      const { task, lease, row } = store.lease(
        context,
        context.path.id,
        body.leaseId,
        body.runtimeId
      )
      if (task.status !== 'cancel-requested') {
        lease.expires_at = Math.min(row.expires_at, service.now() + 30000)
        db.run('UPDATE task_leases SET expires_at=? WHERE id=?', lease.expires_at, lease.id)
      }
      return { status: 200, body: store.leaseResponse(task, lease) }
    })
  handlers.putStudentTasksIdResult = (context) =>
    service.write(context, () => {
      const row = store.row(context.path.id)
      store.assertTaskOwner(context, row)
      const task = store.task(row),
        body = context.body as Schema<'TaskResultInput'>
      const lease = db.get<LeaseRow>(
        'SELECT * FROM task_leases WHERE id=? AND task_id=?',
        body.leaseId,
        task.id
      )
      requireCondition(lease, 'NOT_FOUND')
      const digest = service.operationDigest(body)
      const existing = db.get<{ digest: string; data: string }>(
        'SELECT * FROM task_results WHERE task_id=? AND lease_id=?',
        task.id,
        body.leaseId
      )
      if (existing) {
        requireCondition(existing.digest === digest, 'CONTENT_CONFLICT')
        return { status: 200, body: (JSON.parse(existing.data) as StoredReport).acknowledgement }
      }
      store.validateResult(task, body)
      const late =
        lease.expires_at <= service.now() ||
        ['cancel-requested', 'cancelled', 'expired'].includes(task.status)
      const acknowledgement: Schema<'TaskResult'> = {
        taskId: task.id,
        leaseId: body.leaseId,
        receivedAt: service.timestamp(),
        late
      }
      db.run(
        'INSERT INTO task_results VALUES (?,?,?,?)',
        task.id,
        body.leaseId,
        digest,
        JSON.stringify({ input: body, acknowledgement } satisfies StoredReport)
      )
      db.run('UPDATE task_leases SET ended_at=? WHERE id=?', service.now(), lease.id)
      store.update({
        ...task,
        status:
          task.status === 'cancel-requested'
            ? 'cancelled'
            : late
              ? task.status === 'expired'
                ? 'expired'
                : 'cancelled'
              : body.status,
        revision: task.revision + 1
      })
      if (task.parameters.type === 'history-cleanup') {
        const plan = store.cleanup(task.parameters.planId)
        db.run(
          'UPDATE cleanup_plans SET data=? WHERE id=?',
          JSON.stringify({ ...plan, revision: plan.revision + 1 }),
          plan.id
        )
      }
      return { status: 200, body: acknowledgement }
    })
  handlers.getTeacherTestSuites = (context) => ({
    status: 200,
    body: service.page(context, [TEST_SUITE], (suite) => suite.id)
  })
  handlers.postTeacherTestRuns = (context) =>
    service.write(context, () => {
      const body = context.body as Schema<'TestRunCreate'>,
        digest = service.operationDigest(body)
      const replay = service.replay(context, digest)
      if (replay) return replay
      store.assertMaintenance(context)
      requireCondition(
        body.suiteId === TEST_SUITE.id &&
          body.caseIds.every((id) => TEST_SUITE.cases.some((entry) => entry.id === id)) &&
          Date.parse(body.expiresAt) > service.now(),
        'INVALID_REQUEST'
      )
      if (body.retryOf) store.run(body.retryOf)
      const id = randomUUID(),
        run: StoredRun = {
          id,
          suiteId: TEST_SUITE.id,
          suiteVersion: TEST_SUITE.version,
          createdAt: service.timestamp(),
          expiresAt: body.expiresAt,
          retryOf: body.retryOf ?? null,
          deviceIds: body.deviceIds
        }
      db.run('INSERT INTO test_runs VALUES (?,?)', id, JSON.stringify(run))
      for (const deviceId of body.deviceIds) {
        store.create(id, deviceId, body.expiresAt, {
          type: 'deployment-test',
          suiteId: TEST_SUITE.id,
          suiteVersion: TEST_SUITE.version,
          caseIds: body.caseIds,
          testSubmissionId: randomUUID(),
          testExamSha256: TEST_EXAM_DIGEST
        })
        db.run(
          'INSERT INTO test_confirmations VALUES (?,?,?)',
          id,
          deviceId,
          JSON.stringify({ revision: 1, cases: [], updatedAt: null })
        )
      }
      return service.remember(context, digest, { status: 201, body: store.run(id) })
    })
  handlers.getTeacherTestRuns = (context) => ({
    status: 200,
    body: service.page(
      context,
      db
        .all<{ id: string }>('SELECT id FROM test_runs ORDER BY rowid DESC')
        .map((row) => store.run(row.id)),
      (run) => run.id
    )
  })
  handlers.getTeacherTestRunsId = (context) => ({ status: 200, body: store.run(context.path.id) })
  handlers.postTeacherTestRunsIdCancel = (context) =>
    service.write(context, () => {
      store.run(context.path.id)
      store.cancelBatch(context.path.id)
      return { status: 200, body: store.run(context.path.id) }
    })
  handlers.getTeacherTestRunsIdReport = (context) => ({
    status: 200,
    body: {
      ...store.run(context.path.id),
      serverId: service.identity.serverId,
      releaseVersion: service.options.releaseVersion,
      generatedAt: service.timestamp()
    }
  })
  handlers.putTeacherTestRunsIdDevicesDeviceIdConfirmation = (context) =>
    service.write(context, () => {
      const run = store.run(context.path.id),
        body = context.body as Schema<'ConfirmationInput'>
      const device = run.devices.find((entry) => entry.device.id === context.path.deviceId)
      requireCondition(device, 'NOT_FOUND')
      requireCondition(
        device.confirmation.revision === body.expectedRevision,
        'REVISION_CONFLICT',
        { revision: device.confirmation.revision }
      )
      const ids = body.cases.map((entry) => entry.caseId)
      requireCondition(
        new Set(ids).size === ids.length &&
          ids.every((id) =>
            TEST_SUITE.cases.some((entry) => entry.id === id && entry.requiresManualConfirmation)
          ),
        'INVALID_REQUEST'
      )
      const confirmation: Schema<'Confirmation'> = {
        revision: body.expectedRevision + 1,
        cases: body.cases,
        updatedAt: service.timestamp()
      }
      db.run(
        'UPDATE test_confirmations SET data=? WHERE run_id=? AND device_id=?',
        JSON.stringify(confirmation),
        run.id,
        device.device.id
      )
      return { status: 200, body: confirmation }
    })
  handlers.postTeacherHistoryCleanups = (context) =>
    service.write(context, () => {
      const body = context.body as Schema<'CleanupCreate'>,
        digest = service.operationDigest(body)
      const replay = service.replay(context, digest)
      if (replay) return replay
      store.assertMaintenance(context)
      requireCondition(Date.parse(body.expiresAt) > service.now(), 'INVALID_REQUEST')
      const id = randomUUID(),
        devices = body.deviceIds.map((deviceId): Schema<'CleanupDevice'> => {
          const task = store.create(id, deviceId, body.expiresAt, {
            type: 'history-cleanup',
            phase: 'preview',
            planId: id,
            submittedBefore: body.submittedBefore
          })
          return {
            deviceId,
            previewTaskId: task.id,
            executionTaskId: null,
            status: 'pending',
            selectionDigest: null,
            selectedCount: null,
            selectedBytes: null,
            previewedAt: null,
            confirmed: false,
            result: null,
            error: null
          }
        })
      const plan: Schema<'CleanupPlan'> = {
        id,
        revision: 1,
        status: 'previewing',
        createdAt: service.timestamp(),
        submittedBefore: body.submittedBefore,
        expiresAt: body.expiresAt,
        devices
      }
      db.run('INSERT INTO cleanup_plans VALUES (?,?)', id, JSON.stringify(plan))
      return service.remember(context, digest, { status: 201, body: plan })
    })
  handlers.getTeacherHistoryCleanups = (context) => ({
    status: 200,
    body: service.page(
      context,
      db
        .all<{ id: string }>('SELECT id FROM cleanup_plans ORDER BY rowid DESC')
        .map((row) => store.cleanup(row.id)),
      (plan) => plan.id
    )
  })
  handlers.getTeacherHistoryCleanupsId = (context) => ({
    status: 200,
    body: store.cleanup(context.path.id)
  })
  handlers.postTeacherHistoryCleanupsIdConfirm = (context) =>
    service.write(context, () => {
      store.assertMaintenance(context)
      const body = context.body as Schema<'CleanupConfirm'>,
        plan = store.cleanup(context.path.id)
      const selected = new Map(
        body.selections.map((selection) => [selection.deviceId, selection.selectionDigest])
      )
      requireCondition(selected.size === body.selections.length, 'INVALID_REQUEST')
      if (plan.devices.some((device) => device.confirmed)) {
        requireCondition(
          plan.devices.filter((device) => device.confirmed).length === selected.size &&
            plan.devices.every((device) =>
              device.confirmed
                ? selected.get(device.deviceId) === device.selectionDigest
                : !selected.has(device.deviceId)
            ),
          'CONTENT_CONFLICT'
        )
        return { status: 200, body: plan }
      }
      requireCondition(plan.revision === body.expectedRevision, 'REVISION_CONFLICT', {
        revision: plan.revision
      })
      requireCondition(
        ['previewing', 'awaiting-confirmation'].includes(plan.status) &&
          Date.parse(plan.expiresAt) > service.now(),
        'RESOURCE_BUSY'
      )
      for (const [id, digest] of selected) {
        const device = plan.devices.find((entry) => entry.deviceId === id)
        requireCondition(
          device && device.status === 'succeeded' && device.selectionDigest === digest,
          'CONTENT_CONFLICT'
        )
      }
      for (const device of plan.devices) {
        if (selected.has(device.deviceId)) {
          const task = store.create(plan.id, device.deviceId, plan.expiresAt, {
            type: 'history-cleanup',
            phase: 'execute',
            planId: plan.id,
            submittedBefore: plan.submittedBefore,
            selectionDigest: device.selectionDigest!
          })
          device.confirmed = true
          device.executionTaskId = task.id
          device.status = 'pending'
        } else {
          const task = store.task(store.row(device.previewTaskId))
          if (['pending', 'running'].includes(task.status))
            store.update({
              ...task,
              status: task.status === 'pending' ? 'cancelled' : 'cancel-requested',
              revision: task.revision + 1
            })
        }
      }
      plan.revision++
      plan.status = 'executing'
      db.run('UPDATE cleanup_plans SET data=? WHERE id=?', JSON.stringify(plan), plan.id)
      return { status: 200, body: store.cleanup(plan.id) }
    })
  handlers.postTeacherHistoryCleanupsIdCancel = (context) =>
    service.write(context, () => {
      const plan = store.cleanup(context.path.id)
      if (['previewing', 'awaiting-confirmation', 'executing'].includes(plan.status)) {
        store.cancelBatch(plan.id)
        const running = db.get(
          'SELECT id FROM tasks WHERE batch_id=? AND state=?',
          plan.id,
          'cancel-requested'
        )
        plan.status = running ? 'cancel-requested' : 'cancelled'
        plan.revision++
        db.run('UPDATE cleanup_plans SET data=? WHERE id=?', JSON.stringify(plan), plan.id)
      }
      return { status: 200, body: store.cleanup(plan.id) }
    })
}
