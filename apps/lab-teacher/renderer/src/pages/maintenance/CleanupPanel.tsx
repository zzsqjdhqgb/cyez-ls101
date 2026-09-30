import { useState, type JSX } from 'react'
import { Button, Field } from '@ls101/desktop-ui'
import type { Schema } from '@ls101/lab-contracts'
import { formatBytes, formatTime, useLabAction } from '@ls101/lab-renderer'
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
import styles from '../Workspace.module.css'

export function CleanupPanel(): JSX.Element {
  const { view } = useWorkspace()
  const list = useServiceList<Schema<'CleanupPlan'>>('getTeacherHistoryCleanups', {}, 5000)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  return (
    <div className={styles.stack}>
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={view.service?.mode !== 'maintenance'}
          onClick={() => setCreating(true)}
        >
          新建清理预览
        </Button>
        <RefreshButton refresh={list.refresh} />
      </div>
      <p className={styles.hint}>
        仅清理学生设备上已有成功提交回执的历史文件。先选择设备和截止时间，等待只读预览，再确认固定范围。未提交的作答不会删除。
      </p>
      <QueryNotice query={list} />
      <EmptyList visible={Boolean(list.data && !list.data.items.length)} title="暂无历史清理计划" />
      {list.data?.items.length ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>创建时间</th>
                <th>状态</th>
                <th>清理截止时间</th>
                <th>设备数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((plan) => (
                <tr key={plan.id}>
                  <td>{formatTime(plan.createdAt)}</td>
                  <td>
                    <Status value={plan.status} />
                  </td>
                  <td>{formatTime(plan.submittedBefore)}</td>
                  <td>{plan.devices.length}</td>
                  <td>
                    <Button size="small" onClick={() => setDetail(plan.id)}>
                      查看清理
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
        <CleanupCreator
          close={() => setCreating(false)}
          created={(id) => {
            setCreating(false)
            setDetail(id)
            list.first()
          }}
        />
      ) : null}
      {detail ? (
        <CleanupDetails
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
function CleanupCreator({
  close,
  created
}: {
  close(): void
  created(id: string): void
}): JSX.Element {
  const { session } = useWorkspace()
  const [devices, setDevices] = useState<Set<string>>(new Set())
  const [before, setBefore] = useState('')
  const [minutes, setMinutes] = useState(30)
  const action = useLabAction()
  return (
    <EditorModal title="新建清理预览" close={close} busy={action.busy}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          void action.run(async () => {
            const plan = await session.mutate<Schema<'CleanupPlan'>>('postTeacherHistoryCleanups', {
              body: {
                deviceIds: [...devices],
                submittedBefore: new Date(before).toISOString(),
                expiresAt: new Date(Date.now() + minutes * 60000).toISOString()
              }
            })
            created(plan.id)
          })
        }}
      >
        <div className={styles.grid}>
          <Field htmlFor="cleanup-before" label="清理此时间之前已提交的历史">
            <input
              id="cleanup-before"
              type="datetime-local"
              required
              value={before}
              onChange={(event) => setBefore(event.target.value)}
            />
          </Field>
          <Field htmlFor="cleanup-minutes" label="计划有效期（分钟）">
            <input
              id="cleanup-minutes"
              type="number"
              min={1}
              max={1440}
              required
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </Field>
        </div>
        <DevicePicker selected={devices} change={setDevices} />
        <ActionNotice action={action} />
        <Button
          type="submit"
          variant="primary"
          disabled={action.busy || !devices.size || devices.size > 500 || !before}
        >
          生成只读预览
        </Button>
      </form>
    </EditorModal>
  )
}
function CleanupDetails({ id, close }: { id: string; close(): void }): JSX.Element {
  const { session } = useWorkspace()
  const query = useServiceQuery<Schema<'CleanupPlan'>>(
    'getTeacherHistoryCleanupsId',
    { path: { id } },
    3000
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { action, ask, dialog } = useConfirmation()
  const plan = query.data
  const choices =
    plan?.devices.filter(
      (device) => device.selectionDigest && device.status === 'succeeded' && !device.confirmed
    ) ?? []
  const selections = choices
    .filter((device) => selected.has(device.deviceId))
    .map((device) => ({ deviceId: device.deviceId, selectionDigest: device.selectionDigest! }))
  return (
    <EditorModal title="历史清理详情" close={close} busy={action.busy}>
      <div className={styles.stack}>
        <QueryNotice query={query} />
        <ActionNotice action={action} />
        {plan ? (
          <>
            <div className={styles.actions}>
              <Status value={plan.status} />
              <span className={styles.hint}>截止 {formatTime(plan.submittedBefore)}</span>
              <RefreshButton refresh={query.refresh} />
              <Button
                disabled={
                  action.busy ||
                  !['previewing', 'awaiting-confirmation', 'executing'].includes(plan.status)
                }
                onClick={() =>
                  ask({
                    title: '取消清理计划',
                    message:
                      '取消只能停止后续删除，已经删除的文件无法恢复。运行中的任务仍需等待停止确认。',
                    danger: true,
                    run: async () => {
                      await session.mutate('postTeacherHistoryCleanupsIdCancel', { path: { id } })
                      query.refresh()
                      await session.refreshService()
                    }
                  })
                }
              >
                取消清理
              </Button>
            </div>
            <p className={styles.hint}>
              仅能选择已返回有效预览的设备。确认后范围固定，不包含后续新增记录，已删除文件不能撤销。
            </p>
            <div className={styles.tableFrame}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>选择</th>
                    <th>设备</th>
                    <th>状态</th>
                    <th>候选数量 / 大小</th>
                    <th>预览时间</th>
                    <th>执行结果</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.devices.map((device) => (
                    <tr key={device.deviceId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`确认清理设备 ${device.deviceId}`}
                          disabled={
                            !choices.includes(device) ||
                            !['previewing', 'awaiting-confirmation'].includes(plan.status)
                          }
                          checked={selected.has(device.deviceId)}
                          onChange={(event) => {
                            const next = new Set(selected)
                            if (event.target.checked) next.add(device.deviceId)
                            else next.delete(device.deviceId)
                            setSelected(next)
                          }}
                        />
                      </td>
                      <td>{device.deviceId}</td>
                      <td>
                        <Status value={device.status} />
                        {device.error ? <small>{device.error.message}</small> : null}
                      </td>
                      <td>
                        {device.selectedCount ?? '未知'} / {formatBytes(device.selectedBytes)}
                      </td>
                      <td>{formatTime(device.previewedAt)}</td>
                      <td>
                        {device.result ? (
                          <>
                            <div>
                              已删除 {device.result.deletedCount} · 已不存在{' '}
                              {device.result.alreadyAbsentCount}
                            </div>
                            <div>
                              跳过 {device.result.skippedCount} · 失败 {device.result.failedCount}
                            </div>
                            <small>释放 {formatBytes(device.result.deletedBytes)}</small>
                            {device.result.errors.map((error, index) => (
                              <small key={index}>{error?.message}</small>
                            ))}
                          </>
                        ) : (
                          '尚未执行'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="danger"
              disabled={
                action.busy ||
                !selections.length ||
                !['previewing', 'awaiting-confirmation'].includes(plan.status)
              }
              onClick={() => {
                const fixed = [...selections]
                const revision = plan.revision
                ask({
                  title: '确认删除历史文件',
                  message: `将按已返回的预览清理选中的 ${fixed.length} 台设备。另有 ${plan.devices.length - fixed.length} 台设备未纳入本次执行。已删除文件无法恢复。`,
                  danger: true,
                  run: async () => {
                    try {
                      await session.mutate('postTeacherHistoryCleanupsIdConfirm', {
                        path: { id },
                        body: { expectedRevision: revision, selections: fixed }
                      })
                      setSelected(new Set())
                    } finally {
                      query.refresh()
                      await session.refreshService()
                    }
                  }
                })
              }}
            >
              确认清理选中设备
            </Button>
          </>
        ) : null}
      </div>
      {dialog}
    </EditorModal>
  )
}
