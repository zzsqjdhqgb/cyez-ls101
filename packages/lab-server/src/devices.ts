import type { RequestBody, Schema } from '@ls101/lab-contracts'
import type { LabService } from './service'
import { requireCondition } from './errors'

export function deviceDetails(service: LabService, id: string): Schema<'DeviceDetails'> {
  const device = service.device(id)
  const observation = service.db.get<{ data: string; accepted_at: number }>(
    'SELECT h.data,h.accepted_at FROM heartbeats h JOIN device_credentials c ON c.id=h.credential_id WHERE c.device_id=? ORDER BY h.accepted_at DESC LIMIT 1',
    id
  )
  return {
    ...device,
    online: !!observation && observation.accepted_at > service.now() - 20000,
    lastHeartbeatAt: observation ? new Date(observation.accepted_at).toISOString() : null,
    heartbeat: observation ? JSON.parse(observation.data) : null,
    submissionSummaryUpdatedAt: observation
      ? new Date(observation.accepted_at).toISOString()
      : null,
    tasks: service.taskRows().filter((task) => task.deviceId === id)
  }
}

export function registerDeviceHandlers(service: LabService): void {
  const { db, handlers } = service
  handlers.getTeacherDevices = (context) => {
    const { room, online, versionMismatch, q } = context.query
    const devices = db
      .all<{ id: string }>('SELECT id FROM devices ORDER BY number COLLATE BINARY,id')
      .map(({ id }) => deviceDetails(service, id))
    const filtered = devices.filter(
      (device) =>
        (room === undefined || device.room === room) &&
        (online === undefined || device.online === online) &&
        (versionMismatch === undefined ||
          Boolean(
            device.heartbeat && device.heartbeat.releaseVersion !== service.options.releaseVersion
          ) === versionMismatch) &&
        (!q ||
          `${device.number} ${device.room ?? ''} ${device.seat ?? ''} ${device.displayName ?? ''} ${device.computerName}`
            .toLowerCase()
            .includes(String(q).toLowerCase()))
    )
    return { status: 200, body: service.page(context, filtered, (device) => device.id) }
  }
  handlers.getTeacherDevicesId = (context) => ({
    status: 200,
    body: deviceDetails(service, context.path.id)
  })
  handlers.patchTeacherDevicesId = (context) =>
    service.write(context, () => {
      const body = context.body as RequestBody<'patchTeacherDevicesId'>
      const device = service.device(context.path.id)
      requireCondition(device.revision === body.expectedRevision, 'REVISION_CONFLICT', {
        revision: device.revision
      })
      const changes = { ...body } as Partial<typeof body>
      delete changes.expectedRevision
      if (changes.number !== undefined) {
        changes.number = changes.number.trim()
        requireCondition(changes.number.length > 0, 'INVALID_REQUEST')
        requireCondition(
          !db.get('SELECT id FROM devices WHERE number=? AND id<>?', changes.number, device.id),
          'CONTENT_CONFLICT'
        )
      }
      if (
        Object.entries(changes).some(([key, value]) => device[key as keyof typeof device] !== value)
      ) {
        const updated = { ...device, ...changes, revision: device.revision + 1 }
        db.run(
          'UPDATE devices SET number=?,data=? WHERE id=?',
          updated.number,
          JSON.stringify(updated),
          device.id
        )
      }
      return { status: 200, body: deviceDetails(service, device.id) }
    })
  handlers.postTeacherDevicesIdResetBinding = (context) =>
    service.write(context, () => {
      const digest = service.operationDigest({ deviceId: context.path.id })
      const replay = service.replay(context, digest)
      if (replay) return replay
      const device = service.device(context.path.id)
      db.run(
        'UPDATE device_credentials SET revoked_at=? WHERE device_id=? AND revoked_at IS NULL',
        service.now(),
        device.id
      )
      for (const task of service.taskRows().filter((task) => task.deviceId === device.id)) {
        const state = task.status === 'pending' ? 'cancelled' : 'cancel-requested'
        db.run(
          'UPDATE tasks SET state=?,data=? WHERE id=?',
          state,
          JSON.stringify({ ...task, status: state, revision: task.revision + 1 }),
          task.id
        )
      }
      return service.remember(context, digest, { status: 204 })
    })
  handlers.getTeacherService = async () => {
    const devices = db
      .all<{ id: string }>('SELECT id FROM devices')
      .map(({ id }) => deviceDetails(service, id))
    return {
      status: 200,
      body: {
        ...service.info(),
        ...service.mode(),
        openEnrollment: service.openEnrollment()?.id ?? null,
        activeTasks: service.taskRows(),
        blockers: service.blockers(),
        storage: await service.storage(),
        deviceSummary: {
          total: devices.length,
          online: devices.filter((device) => device.online).length,
          versionMismatch: devices.filter(
            (device) =>
              device.heartbeat && device.heartbeat.releaseVersion !== service.options.releaseVersion
          ).length,
          practicing: devices.filter((device) => device.heartbeat?.phase === 'practicing').length,
          unknownStatistics: devices.filter((device) => !device.heartbeat).length
        }
      }
    }
  }
  handlers.getTeacherLogs = (context) => {
    const rows = db
      .all<{ data: string }>('SELECT data FROM logs ORDER BY time DESC,id DESC')
      .map((row) => JSON.parse(row.data) as Schema<'LogEntry'>)
    const filtered = rows.filter(
      (row) =>
        (!context.query.level || row.level === context.query.level) &&
        (!context.query.requestId || row.requestId === context.query.requestId) &&
        (!context.query.from || row.at >= String(context.query.from)) &&
        (!context.query.before || row.at < String(context.query.before))
    )
    return { status: 200, body: service.page(context, filtered, (row) => row.id) }
  }
}
