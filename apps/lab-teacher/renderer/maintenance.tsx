import { useState, type JSX } from 'react'
import { Download, Plus, Square, RefreshCw } from 'lucide-react'
import type { Schema } from '@ls101/lab-contracts'
import type { TeacherController } from './controller'
import { Dialog, Notice, Pager } from './ui'
import { bytes, time, useAction, useRead, usePagedRead } from './hooks'
import { failedTestCases, testCaseLabels, testStatusLabels } from './test-results'

export function Maintenance({ controller }: { controller: TeacherController }): JSX.Element {
  const [tab, setTab] = useState<'enrollments' | 'tests' | 'cleanup' | 'backups'>('enrollments')
  return (
    <>
      <div className="section-header">
        <h1>维护</h1>
      </div>
      <nav className="subtabs">
        {(
          [
            ['enrollments', '设备入网'],
            ['tests', '部署测试'],
            ['cleanup', '历史清理'],
            ['backups', '服务备份']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'enrollments' ? (
        <Enrollments controller={controller} />
      ) : tab === 'tests' ? (
        <Tests controller={controller} />
      ) : tab === 'cleanup' ? (
        <Cleanup controller={controller} />
      ) : (
        <Backups controller={controller} />
      )}
    </>
  )
}
function Enrollments({ controller }: { controller: TeacherController }): JSX.Element {
  const [minutes, setMinutes] = useState(10)
  const list = usePagedRead<Schema<'EnrollmentList'>>(
    controller,
    'getTeacherEnrollments',
    { query: { limit: 100 } },
    true
  )
  const action = useAction(list.refresh)
  return (
    <>
      <div className="section-header">
        <h2>入网批次</h2>
        <div className="actions">
          <label>
            有效期（分钟）
            <input
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
          <button
            className="primary"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await controller.refreshService()
                await controller.mutate('postTeacherEnrollments', {
                  body: {
                    expectedModeRevision: controller.getSnapshot().service!.modeRevision,
                    validForSeconds: minutes * 60
                  }
                })
                await controller.refreshService()
              })
            }
          >
            <Plus />
            开启入网
          </button>
        </div>
      </div>
      <Notice error={action.error ?? list.error} />
      <table>
        <thead>
          <tr>
            <th>创建时间</th>
            <th>到期时间</th>
            <th>注册数</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id}>
              <td>{time(item.issuedAt)}</td>
              <td>{time(item.expiresAt)}</td>
              <td>{item.registeredCount}</td>
              <td>{item.status}</td>
              <td className="actions">
                <button
                  title="下载入网文件"
                  aria-label="下载入网文件"
                  disabled={item.status !== 'active'}
                  onClick={() =>
                    action.run(() =>
                      controller.download(
                        'getTeacherEnrollmentsIdFile',
                        { path: { id: item.id } },
                        `${item.id}.lsjoin`
                      )
                    )
                  }
                >
                  <Download />
                </button>
                <button
                  title="关闭入网"
                  aria-label="关闭入网"
                  disabled={item.status !== 'active'}
                  onClick={() =>
                    action.run(() =>
                      controller.mutate('deleteTeacherEnrollmentsId', { path: { id: item.id } })
                    )
                  }
                >
                  <Square />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.loading && !list.data?.items.length && <p className="empty">暂无入网批次</p>}
      <Pager
        cursor={list.cursor}
        nextCursor={list.data?.nextCursor ?? null}
        onChange={list.setCursor}
        refresh={list.refresh}
      />
    </>
  )
}
function Tests({ controller }: { controller: TeacherController }): JSX.Element {
  const list = usePagedRead<Schema<'TestRunList'>>(
    controller,
    'getTeacherTestRuns',
    { query: { limit: 100 } },
    true
  )
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string | null>(null)
  return (
    <>
      <div className="section-header">
        <h2>部署测试</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus />
          创建测试
        </button>
      </div>
      <Notice error={list.error} />
      <table>
        <thead>
          <tr>
            <th>创建时间</th>
            <th>套件</th>
            <th>设备数</th>
            <th>状态</th>
            <th>到期时间</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id}>
              <td>
                <button className="text-button" onClick={() => setSelected(item.id)}>
                  {time(item.createdAt)}
                </button>
              </td>
              <td>{item.suiteId}</td>
              <td>{item.devices.length}</td>
              <td>{item.status}</td>
              <td>{time(item.expiresAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.loading && !list.data?.items.length && <p className="empty">暂无测试</p>}
      <Pager
        cursor={list.cursor}
        nextCursor={list.data?.nextCursor ?? null}
        onChange={list.setCursor}
        refresh={list.refresh}
      />
      {creating && (
        <CreateTask
          controller={controller}
          kind="test"
          close={() => setCreating(false)}
          saved={() => {
            setCreating(false)
            list.refresh()
          }}
        />
      )}
      {selected && (
        <TestDetails
          key={selected}
          controller={controller}
          id={selected}
          close={() => setSelected(null)}
          retried={(id) => {
            setSelected(id)
            list.refresh()
          }}
        />
      )}
    </>
  )
}
function TestDetails({
  controller,
  id,
  close,
  retried
}: {
  controller: TeacherController
  id: string
  close(): void
  retried(id: string): void
}): JSX.Element {
  const result = useRead<Schema<'TestRun'>>(
    controller,
    'getTeacherTestRunsId',
    { path: { id } },
    true
  )
  const action = useAction(result.refresh)
  const [confirming, setConfirming] = useState<Schema<'TestDeviceResult'> | null>(null)
  return (
    <Dialog title="测试详情" close={close}>
      <Notice error={action.error ?? result.error} />
      <div className="actions">
        <button
          onClick={() =>
            action.run(() => controller.mutate('postTeacherTestRunsIdCancel', { path: { id } }))
          }
        >
          <Square />
          取消测试
        </button>
        <button
          onClick={() =>
            action.run(() =>
              controller.download('getTeacherTestRunsIdReport', { path: { id } }, `${id}.json`)
            )
          }
        >
          <Download />
          导出报告
        </button>
      </div>
      {result.data?.devices.map((device) => (
        <section className="report-device" key={device.device.id}>
          <h3>
            {device.device.number} / {device.device.room ?? '-'} / {device.device.seat ?? '-'}
          </h3>
          <p>
            {testStatusLabels[device.task.status] ?? device.task.status}
            {device.late ? ' (迟到报告)' : ''} / 最后心跳 {time(device.lastHeartbeatAt)}
          </p>
          {device.report?.error && <Notice error={device.report.error.message} />}
          <table>
            <thead>
              <tr>
                <th>用例</th>
                <th>自动结果</th>
                <th>人工确认</th>
              </tr>
            </thead>
            <tbody>
              {device.cases.map((item) => (
                <tr key={item.caseId}>
                  <td>{testCaseLabels[item.caseId] ?? item.caseId}</td>
                  <td>
                    {testStatusLabels[item.status] ?? item.status}
                    {item.error && <small>{item.error.message}</small>}
                  </td>
                  <td>
                    {(() => {
                      const status = device.confirmation.cases.find(
                        (entry) => entry.caseId === item.caseId
                      )?.status
                      return status === 'pending'
                        ? '待确认'
                        : status
                          ? testStatusLabels[status]
                          : '-'
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {device.confirmation.cases.length > 0 && (
            <button onClick={() => setConfirming(device)}>人工确认</button>
          )}
          {failedTestCases(device).length > 0 && (
            <button
              disabled={action.busy}
              onClick={() => {
                const caseIds = failedTestCases(device),
                  suiteId = result.data!.suiteId
                action.run(async () => {
                  const next = await controller.mutate<Schema<'TestRun'>>('postTeacherTestRuns', {
                    body: {
                      suiteId,
                      deviceIds: [device.device.id],
                      caseIds,
                      retryOf: id,
                      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
                    }
                  })
                  retried(next.id)
                })
              }}
            >
              <RefreshCw />
              重试失败项
            </button>
          )}
        </section>
      ))}
      {confirming && (
        <ManualConfirmation
          controller={controller}
          runId={id}
          device={confirming}
          close={() => setConfirming(null)}
          saved={() => {
            setConfirming(null)
            result.refresh()
          }}
        />
      )}
    </Dialog>
  )
}
function ManualConfirmation({
  controller,
  runId,
  device,
  close,
  saved
}: {
  controller: TeacherController
  runId: string
  device: Schema<'TestDeviceResult'>
  close(): void
  saved(): void
}): JSX.Element {
  const [cases, setCases] = useState(device.confirmation.cases)
  const action = useAction(saved)
  return (
    <Dialog title={`人工确认 ${device.device.number}`} close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          action.run(() =>
            controller.mutate('putTeacherTestRunsIdDevicesDeviceIdConfirmation', {
              path: { id: runId, deviceId: device.device.id },
              body: { expectedRevision: device.confirmation.revision, cases }
            })
          )
        }}
      >
        {cases.map((item, index) => (
          <div className="confirmation-row" key={item.caseId}>
            <label>
              {testCaseLabels[item.caseId] ?? item.caseId}
              <select
                aria-label={`${testCaseLabels[item.caseId] ?? item.caseId}人工确认`}
                value={item.status}
                onChange={(event) =>
                  setCases(
                    cases.map((value, i) =>
                      i === index
                        ? {
                            ...value,
                            status: event.target.value as Schema<'ConfirmationCase'>['status']
                          }
                        : value
                    )
                  )
                }
              >
                <option value="pending">待确认</option>
                <option value="passed">通过</option>
                <option value="failed">失败</option>
              </select>
            </label>
            <label>
              备注
              <input
                value={item.note}
                onChange={(event) =>
                  setCases(
                    cases.map((value, i) =>
                      i === index ? { ...value, note: event.target.value } : value
                    )
                  )
                }
              />
            </label>
          </div>
        ))}
        <Notice error={action.error} />
        <button className="primary" disabled={action.busy} type="submit">
          保存人工结果
        </button>
      </form>
    </Dialog>
  )
}
function Cleanup({ controller }: { controller: TeacherController }): JSX.Element {
  const list = usePagedRead<Schema<'CleanupList'>>(
    controller,
    'getTeacherHistoryCleanups',
    { query: { limit: 100 } },
    true
  )
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string | null>(null)
  return (
    <>
      <div className="section-header">
        <h2>学生端历史清理</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus />
          创建预览
        </button>
      </div>
      <Notice error={list.error} />
      <table>
        <thead>
          <tr>
            <th>创建时间</th>
            <th>提交截止时间</th>
            <th>设备数</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id}>
              <td>
                <button className="text-button" onClick={() => setSelected(item.id)}>
                  {time(item.createdAt)}
                </button>
              </td>
              <td>{time(item.submittedBefore)}</td>
              <td>{item.devices.length}</td>
              <td>{item.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.loading && !list.data?.items.length && <p className="empty">暂无清理计划</p>}
      <Pager
        cursor={list.cursor}
        nextCursor={list.data?.nextCursor ?? null}
        onChange={list.setCursor}
        refresh={list.refresh}
      />
      {creating && (
        <CreateTask
          controller={controller}
          kind="cleanup"
          close={() => setCreating(false)}
          saved={() => {
            setCreating(false)
            list.refresh()
          }}
        />
      )}
      {selected && (
        <CleanupDetails controller={controller} id={selected} close={() => setSelected(null)} />
      )}
    </>
  )
}
function CleanupDetails({
  controller,
  id,
  close
}: {
  controller: TeacherController
  id: string
  close(): void
}): JSX.Element {
  const result = useRead<Schema<'CleanupPlan'>>(
    controller,
    'getTeacherHistoryCleanupsId',
    { path: { id } },
    true
  )
  const [selected, setSelected] = useState(new Set<string>()),
    [confirmation, setConfirmation] = useState<Schema<'CleanupConfirm'> | null>(null)
  const action = useAction(result.refresh)
  return (
    <Dialog title="历史清理详情" close={close}>
      <Notice error={action.error ?? result.error} />
      <p>
        {result.data?.status} / 截止 {time(result.data?.submittedBefore)}
      </p>
      <table>
        <thead>
          <tr>
            <th>选择</th>
            <th>设备</th>
            <th>预览数量 / 大小</th>
            <th>状态</th>
            <th>删除 / 已缺失 / 跳过 / 失败</th>
          </tr>
        </thead>
        <tbody>
          {result.data?.devices.map((device) => (
            <tr key={device.deviceId}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`选择 ${device.deviceId}`}
                  disabled={
                    !device.selectionDigest ||
                    device.status !== 'succeeded' ||
                    !['previewing', 'awaiting-confirmation'].includes(result.data!.status)
                  }
                  checked={selected.has(device.deviceId)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(device.deviceId)
                      else next.delete(device.deviceId)
                      return next
                    })
                  }
                />
              </td>
              <td>{device.deviceId}</td>
              <td>
                {device.selectedCount ?? '-'} / {bytes(device.selectedBytes)}
              </td>
              <td>{device.status}</td>
              <td>
                {device.result
                  ? `${device.result.deletedCount} / ${device.result.alreadyAbsentCount} / ${device.result.skippedCount} / ${device.result.failedCount}`
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button
          disabled={
            !selected.size ||
            !result.data ||
            !['previewing', 'awaiting-confirmation'].includes(result.data.status)
          }
          onClick={() =>
            setConfirmation({
              expectedRevision: result.data!.revision,
              selections: result
                .data!.devices.filter(
                  (device) => selected.has(device.deviceId) && device.selectionDigest
                )
                .map((device) => ({
                  deviceId: device.deviceId,
                  selectionDigest: device.selectionDigest!
                }))
            })
          }
        >
          确认所选快照
        </button>
        <button
          onClick={() =>
            action.run(() =>
              controller.mutate('postTeacherHistoryCleanupsIdCancel', { path: { id } })
            )
          }
        >
          <Square />
          取消后续清理
        </button>
      </div>
      {confirmation && (
        <Dialog title="执行历史清理" close={() => setConfirmation(null)}>
          <p>
            将清理 {confirmation.selections.length}{' '}
            台设备的已确认历史快照。已删除文件无法撤销，后续新增历史不会加入本次范围。
          </p>
          <Notice error={action.error} />
          <button
            className="danger"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await controller.mutate('postTeacherHistoryCleanupsIdConfirm', {
                  path: { id },
                  body: confirmation
                })
                setConfirmation(null)
              })
            }
          >
            执行清理
          </button>
        </Dialog>
      )}
    </Dialog>
  )
}
function CreateTask({
  controller,
  kind,
  close,
  saved
}: {
  controller: TeacherController
  kind: 'test' | 'cleanup'
  close(): void
  saved(): void
}): JSX.Element {
  const [room, setRoom] = useState(''),
    [selected, setSelected] = useState(new Set<string>()),
    [suiteId, setSuite] = useState(''),
    [caseIds, setCases] = useState(new Set<string>())
  const [before, setBefore] = useState(''),
    [duration, setDuration] = useState(30)
  const devices = usePagedRead<Schema<'DeviceList'>>(controller, 'getTeacherDevices', {
    query: { room: room || undefined, limit: 100 }
  })
  const suites = useRead<Schema<'TestSuiteList'>>(controller, 'getTeacherTestSuites', {
    query: { limit: 100 }
  })
  const action = useAction(saved)
  return (
    <Dialog title={kind === 'test' ? '创建部署测试' : '创建历史预览'} close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          action.run(async () => {
            const expiresAt = new Date(Date.now() + duration * 60000).toISOString()
            if (kind === 'test')
              await controller.mutate('postTeacherTestRuns', {
                body: { suiteId, caseIds: [...caseIds], deviceIds: [...selected], expiresAt }
              })
            else
              await controller.mutate('postTeacherHistoryCleanups', {
                body: {
                  deviceIds: [...selected],
                  submittedBefore: new Date(before).toISOString(),
                  expiresAt
                }
              })
          })
        }}
      >
        {kind === 'test' ? (
          <>
            <label>
              套件
              <select
                required
                value={suiteId}
                onChange={(event) => {
                  setSuite(event.target.value)
                  setCases(
                    new Set(
                      suites.data?.items
                        .find((suite) => suite.id === event.target.value)
                        ?.cases.map((item) => item.id)
                    )
                  )
                }}
              >
                <option value="">选择套件</option>
                {suites.data?.items.map((suite) => (
                  <option key={suite.id} value={suite.id}>
                    {suite.name}
                  </option>
                ))}
              </select>
            </label>
            {suites.data?.items
              .find((suite) => suite.id === suiteId)
              ?.cases.map((item) => (
                <label className="check" key={item.id}>
                  <input
                    type="checkbox"
                    checked={caseIds.has(item.id)}
                    onChange={(event) =>
                      setCases((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(item.id)
                        else next.delete(item.id)
                        return next
                      })
                    }
                  />
                  {item.name}
                  {item.requiresManualConfirmation && ' (需人工确认)'}
                </label>
              ))}
          </>
        ) : (
          <label>
            提交时间早于
            <input
              type="datetime-local"
              required
              value={before}
              onChange={(event) => setBefore(event.target.value)}
            />
          </label>
        )}
        <label>
          任务有效期（分钟）
          <input
            type="number"
            required
            min={1}
            max={1440}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </label>
        <label>
          机房筛选
          <input
            value={room}
            onChange={(event) => {
              setRoom(event.target.value)
              devices.setCursor(null)
            }}
          />
        </label>
        <div className="device-picker">
          {devices.data?.items.map((device) => (
            <label className="check" key={device.id}>
              <input
                type="checkbox"
                checked={selected.has(device.id)}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(device.id)
                    else next.delete(device.id)
                    return next
                  })
                }
              />
              {device.number} / {device.room ?? '-'} / {device.seat ?? '-'} /{' '}
              {device.online ? '在线' : '离线'}
            </label>
          ))}
        </div>
        <Notice error={action.error ?? devices.error ?? suites.error} />
        <Pager
          cursor={devices.cursor}
          nextCursor={devices.data?.nextCursor ?? null}
          onChange={devices.setCursor}
          refresh={devices.refresh}
        />
        <button
          className="primary"
          type="submit"
          disabled={action.busy || !selected.size || (kind === 'test' && !caseIds.size)}
        >
          创建（{selected.size} 台）
        </button>
      </form>
    </Dialog>
  )
}
function Backups({ controller }: { controller: TeacherController }): JSX.Element {
  const list = usePagedRead<Schema<'BackupList'>>(
    controller,
    'getTeacherBackups',
    { query: { limit: 100 } },
    true
  )
  const [password, setPassword] = useState('')
  const action = useAction(list.refresh)
  return (
    <>
      <div className="section-header">
        <h2>加密备份</h2>
      </div>
      <p>备份不包含快照之后的收卷数据。恢复只在服务机停止服务后执行。</p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          const secret = password
          setPassword('')
          action.run(() =>
            controller.mutate('postTeacherBackups', { body: { encryptionPassword: secret } })
          )
        }}
      >
        <label>
          备份密码
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={
            action.busy ||
            list.data?.items.some((item) => ['pending', 'running'].includes(item.status))
          }
          type="submit"
        >
          <Plus />
          创建备份
        </button>
      </form>
      <Notice error={action.error ?? list.error} />
      <table>
        <thead>
          <tr>
            <th>创建时间</th>
            <th>快照时间</th>
            <th>版本</th>
            <th>状态</th>
            <th>大小</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id}>
              <td>{time(item.createdAt)}</td>
              <td>{time(item.snapshotAt)}</td>
              <td>{item.releaseVersion}</td>
              <td>
                {item.status}
                {item.error && <small>{item.error.message}</small>}
              </td>
              <td>{bytes(item.archiveBytes)}</td>
              <td>
                <button
                  title="下载备份"
                  aria-label="下载备份"
                  disabled={item.status !== 'ready'}
                  onClick={() =>
                    action.run(() =>
                      controller.download(
                        'getTeacherBackupsIdArchive',
                        { path: { id: item.id } },
                        `${item.id}.7z`
                      )
                    )
                  }
                >
                  <Download />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.loading && !list.data?.items.length && <p className="empty">暂无备份</p>}
      <Pager
        cursor={list.cursor}
        nextCursor={list.data?.nextCursor ?? null}
        onChange={list.setCursor}
        refresh={list.refresh}
      />
    </>
  )
}
