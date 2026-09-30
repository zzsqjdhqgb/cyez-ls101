import { useState, type JSX } from 'react'
import { Button, Field } from '@ls101/desktop-ui'
import type { Schema } from '@ls101/lab-contracts'
import { formatTime, useLabAction } from '@ls101/lab-renderer'
import { useServiceList, useServiceQuery, useWorkspace } from '../../session/workspace'
import {
  ActionNotice,
  EditorModal,
  EmptyList,
  ListFooter,
  QueryNotice,
  RefreshButton,
  Status,
  useConfirmation
} from '../../components/WorkspaceUI'
import { DevicePicker } from './DevicePicker'
import { retryTestSelections } from './maintenance-model'
import styles from '../Workspace.module.css'

export function TestsPanel(): JSX.Element {
  const { view } = useWorkspace()
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const list = useServiceList<Schema<'TestRun'>>('getTeacherTestRuns', {}, 5000)
  return (
    <div className={styles.stack}>
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={view.service?.mode !== 'maintenance'}
          onClick={() => setCreating(true)}
        >
          新建部署测试
        </Button>
        <RefreshButton refresh={list.refresh} />
      </div>
      <p className={styles.hint}>
        选择设备和测试项后开始测试。声音是否可听、麦克风位置等需要人工确认，自动完成不代表现场核对通过。
      </p>
      <QueryNotice query={list} />
      <EmptyList visible={Boolean(list.data && !list.data.items.length)} title="暂无部署测试" />
      {list.data?.items.length ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>创建时间</th>
                <th>状态</th>
                <th>设备数</th>
                <th>到期时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((run) => (
                <tr key={run.id}>
                  <td>
                    {formatTime(run.createdAt)}
                    {run.retryOf ? <small>失败项重试</small> : null}
                  </td>
                  <td>
                    <Status value={run.status} />
                  </td>
                  <td>{run.devices.length}</td>
                  <td>{formatTime(run.expiresAt)}</td>
                  <td>
                    <Button size="small" onClick={() => setDetail(run.id)}>
                      查看测试
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {list.data ? <ListFooter list={list} /> : null}
      {creating ? (
        <TestCreator
          close={() => setCreating(false)}
          created={(id) => {
            setCreating(false)
            setDetail(id)
            list.first()
          }}
        />
      ) : null}
      {detail ? (
        <TestDetails
          id={detail}
          close={() => {
            setDetail(null)
            list.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
function TestCreator({
  close,
  created
}: {
  close(): void
  created(id: string): void
}): JSX.Element {
  const { session } = useWorkspace()
  const suites = useServiceQuery<Schema<'TestSuiteList'>>('getTeacherTestSuites', {
    query: { limit: 200 }
  })
  const [suiteId, setSuiteId] = useState('')
  const suite = suites.data?.items.find((item) => item.id === suiteId) ?? suites.data?.items[0]
  const [cases, setCases] = useState<Set<string> | null>(null)
  const selectedCases = cases ?? new Set(suite?.cases.map((item) => item.id))
  const [devices, setDevices] = useState<Set<string>>(new Set())
  const [minutes, setMinutes] = useState(15)
  const action = useLabAction()
  return (
    <EditorModal title="新建部署测试" close={close} busy={action.busy}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          if (suite)
            void action.run(async () => {
              const result = await session.mutate<Schema<'TestRun'>>('postTeacherTestRuns', {
                body: {
                  suiteId: suite.id,
                  caseIds: [...selectedCases],
                  deviceIds: [...devices],
                  expiresAt: new Date(Date.now() + minutes * 60000).toISOString()
                }
              })
              created(result.id)
            })
        }}
      >
        <QueryNotice query={suites} />
        <Field htmlFor="test-suite" label="测试套件">
          <select
            id="test-suite"
            value={suite?.id ?? ''}
            onChange={(event) => {
              setSuiteId(event.target.value)
              setCases(null)
            }}
          >
            {suites.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <div className={styles.checks}>
          {suite?.cases.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={selectedCases.has(item.id)}
                onChange={(event) => {
                  const next = new Set(selectedCases)
                  if (event.target.checked) next.add(item.id)
                  else next.delete(item.id)
                  setCases(next)
                }}
              />
              {item.name}
              {item.requiresManualConfirmation ? '（需人工确认）' : ''}
            </label>
          ))}
        </div>
        <Field htmlFor="test-minutes" label="有效期（分钟）">
          <input
            id="test-minutes"
            required
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
        </Field>
        <DevicePicker selected={devices} change={setDevices} />
        <ActionNotice action={action} />
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            disabled={
              action.busy || !suite || !selectedCases.size || !devices.size || devices.size > 500
            }
          >
            开始测试
          </Button>
          <Button disabled={action.busy} onClick={close}>
            取消
          </Button>
        </div>
      </form>
    </EditorModal>
  )
}
function TestDetails({ id, close }: { id: string; close(): void }): JSX.Element {
  const { session, view } = useWorkspace()
  const query = useServiceQuery<Schema<'TestRun'>>('getTeacherTestRunsId', { path: { id } }, 3000)
  const suites = useServiceQuery<Schema<'TestSuiteList'>>('getTeacherTestSuites', {
    query: { limit: 200 }
  })
  const { action, ask, dialog } = useConfirmation()
  const [confirming, setConfirming] = useState<Schema<'TestDeviceResult'> | null>(null)
  const run = query.data
  const caseName = (caseId: string): string =>
    suites.data?.items
      .find((suite) => suite.id === run?.suiteId)
      ?.cases.find((item) => item.id === caseId)?.name ?? caseId
  return (
    <EditorModal title="部署测试详情" close={close} busy={action.busy}>
      <div className={styles.stack}>
        <QueryNotice query={query} />
        <ActionNotice action={action} />
        {run ? (
          <>
            <div className={styles.actions}>
              <Status value={run.status} />
              <span className={styles.hint}>
                {formatTime(run.createdAt)} · {run.devices.length} 台设备
              </span>
              <RefreshButton refresh={query.refresh} />
              <Button
                disabled={action.busy}
                onClick={() =>
                  void action.run(() =>
                    session.download(
                      'getTeacherTestRunsIdReport',
                      { path: { id } },
                      `部署测试-${id}.json`
                    )
                  )
                }
              >
                导出报告
              </Button>
              <Button
                disabled={action.busy || !['pending', 'running'].includes(run.status)}
                onClick={() =>
                  ask({
                    title: '取消部署测试',
                    message:
                      '尚未执行的任务将取消，运行中的任务会请求停止。等待设备确认停止或租约到期后，才会解除维护阻塞。',
                    run: async () => {
                      await session.mutate('postTeacherTestRunsIdCancel', { path: { id } })
                      query.refresh()
                      await session.refreshService()
                    }
                  })
                }
              >
                取消测试
              </Button>
              <Button
                disabled={
                  action.busy ||
                  view.service?.mode !== 'maintenance' ||
                  !retryTestSelections(run).length
                }
                onClick={() =>
                  ask({
                    title: '重试失败项',
                    message: '仅对失败、取消或超时的测试项创建新批次，原报告和人工确认记录会保留。',
                    run: async () => {
                      for (const group of retryTestSelections(run))
                        await session.mutate('postTeacherTestRuns', {
                          body: {
                            ...group,
                            suiteId: run.suiteId,
                            retryOf: run.id,
                            expiresAt: new Date(Date.now() + 15 * 60000).toISOString()
                          }
                        })
                      query.refresh()
                      await session.refreshService()
                    }
                  })
                }
              >
                重试失败项
              </Button>
            </div>
            {run.devices.map((device) => (
              <section key={device.device.id} className={styles.card}>
                <h3>
                  {device.device.number} ·{' '}
                  {device.device.displayName ?? device.device.room ?? '设备'}
                </h3>
                <div className={styles.actions}>
                  <Status value={device.task.status} />
                  <span className={styles.hint}>
                    最后心跳 {formatTime(device.lastHeartbeatAt)}
                    {device.late ? ' · 迟到报告，不改变任务已取消或到期的事实' : ''}
                  </span>
                </div>
                {device.report?.error ? (
                  <p className={styles.hint}>{device.report.error.message}</p>
                ) : null}
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>测试项</th>
                      <th>自动结果</th>
                      <th>人工确认</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(device.task.parameters.type === 'deployment-test'
                      ? device.task.parameters.caseIds
                      : []
                    ).map((caseId) => (
                      <tr key={caseId}>
                        <td>{caseName(caseId)}</td>
                        <td>
                          <Status
                            value={
                              device.cases.find((item) => item.caseId === caseId)?.status ??
                              'pending'
                            }
                          />
                        </td>
                        <td>
                          {device.confirmation.cases.find((item) => item.caseId === caseId) ? (
                            <Status
                              value={
                                device.confirmation.cases.find((item) => item.caseId === caseId)!
                                  .status
                              }
                            />
                          ) : (
                            '无需确认'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {device.confirmation.cases.length ? (
                  <Button disabled={action.busy} onClick={() => setConfirming(device)}>
                    人工确认
                  </Button>
                ) : null}
              </section>
            ))}
          </>
        ) : null}
      </div>
      {dialog}
      {confirming ? (
        <ConfirmationEditor
          runId={id}
          device={confirming}
          caseName={caseName}
          close={() => setConfirming(null)}
          saved={query.refresh}
        />
      ) : null}
    </EditorModal>
  )
}
function ConfirmationEditor({
  runId,
  device,
  caseName,
  close,
  saved
}: {
  runId: string
  device: Schema<'TestDeviceResult'>
  caseName(id: string): string
  close(): void
  saved(): void
}): JSX.Element {
  const { session } = useWorkspace()
  const [cases, setCases] = useState(device.confirmation.cases)
  const action = useLabAction()
  return (
    <EditorModal title={`人工确认 · ${device.device.number}`} close={close} busy={action.busy}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          void action.run(async () => {
            await session.mutate('putTeacherTestRunsIdDevicesDeviceIdConfirmation', {
              path: { id: runId, deviceId: device.device.id },
              body: { expectedRevision: device.confirmation.revision, cases }
            })
            saved()
            close()
          })
        }}
      >
        <p className={styles.hint}>
          请现场核对后选择结果。人工结果单独保存，不会覆盖自动测试结果。
        </p>
        {cases.map((item, index) => (
          <Field
            key={item.caseId}
            htmlFor={`confirmation-${item.caseId}`}
            label={caseName(item.caseId)}
          >
            <select
              id={`confirmation-${item.caseId}`}
              value={item.status}
              onChange={(event) =>
                setCases(
                  cases.map((current, at) =>
                    at === index
                      ? { ...current, status: event.target.value as typeof item.status }
                      : current
                  )
                )
              }
            >
              <option value="pending">未确认</option>
              <option value="passed">通过</option>
              <option value="failed">失败</option>
            </select>
          </Field>
        ))}
        <ActionNotice action={action} />
        {action.error?.code === 'REVISION_CONFLICT' ? (
          <p className={styles.hint}>记录已更新，请取消并重新打开确认窗口。</p>
        ) : null}
        <Button type="submit" variant="primary" disabled={action.busy}>
          保存人工确认
        </Button>
      </form>
    </EditorModal>
  )
}
