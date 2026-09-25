import { useState, type JSX } from 'react'
import { Button, Page, PageHeader, Field, CheckField } from '@ls101/desktop-ui'
import type { Schema } from '@ls101/lab-contracts'
import { formatTime, useLabAction } from '@ls101/lab-renderer'
import { useServiceList, useWorkspace } from '../session/workspace'
import {
  ActionNotice,
  EditorModal,
  EmptyList,
  ListFooter,
  QueryNotice,
  RefreshButton,
  Status,
  useConfirmation
} from '../components/WorkspaceUI'
import styles from './Workspace.module.css'

export function DevicesPage(): JSX.Element {
  const { session } = useWorkspace()
  const [search, setSearch] = useState('')
  const [room, setRoom] = useState('')
  const [online, setOnline] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [editing, setEditing] = useState<Schema<'DeviceDetails'> | null>(null)
  const list = useServiceList<Schema<'DeviceDetails'>>(
    'getTeacherDevices',
    {
      q: search || undefined,
      room: room || undefined,
      online: online ? online === 'true' : undefined,
      versionMismatch: mismatch || undefined
    },
    5000
  )
  const { action, ask, dialog } = useConfirmation()
  return (
    <Page>
      <PageHeader title="设备" actions={<RefreshButton refresh={list.refresh} />} />
      <div className={styles.toolbar}>
        <label>
          搜索设备
          <input
            type="search"
            value={search}
            placeholder="编号、名称或计算机名"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          机房
          <input value={room} onChange={(event) => setRoom(event.target.value)} />
        </label>
        <label>
          在线状态
          <select value={online} onChange={(event) => setOnline(event.target.value)}>
            <option value="">全部</option>
            <option value="true">在线</option>
            <option value="false">离线</option>
          </select>
        </label>
        <CheckField
          id="device-mismatch"
          label="仅版本不一致"
          checked={mismatch}
          onChange={(event) => setMismatch(event.target.checked)}
        />
      </div>
      <p className={styles.hint}>每 5 秒刷新。离线设备显示最后上报值，未知统计不会按零处理。</p>
      <ActionNotice action={action} />
      <QueryNotice query={list} />
      <EmptyList
        visible={Boolean(list.data && !list.data.items.length)}
        title="暂无设备，请在维护页开启设备入网"
      />
      {list.data?.items.length ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>设备</th>
                <th>机房 / 座位</th>
                <th>状态</th>
                <th>版本 / 激活</th>
                <th>待上传 / 未确认 / 异常</th>
                <th>最后心跳</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((device) => (
                <tr key={device.id}>
                  <td>
                    <strong>
                      {device.number}
                      {device.displayName ? ` · ${device.displayName}` : ''}
                    </strong>
                    <small>{device.computerName}</small>
                  </td>
                  <td>
                    {device.room ?? '未分配'} / {device.seat ?? '未分配'}
                  </td>
                  <td>
                    {device.enabled ? (device.online ? '在线' : '离线') : '已禁用'}
                    <small>
                      {device.heartbeat ? <Status value={device.heartbeat.phase} /> : '状态未知'}
                    </small>
                  </td>
                  <td>
                    {device.heartbeat?.releaseVersion ?? '未知'}
                    <small>
                      {device.heartbeat
                        ? device.heartbeat.activationState === 'active'
                          ? '已激活'
                          : '未激活'
                        : '未知'}
                    </small>
                  </td>
                  <td>
                    {device.heartbeat?.submissionSummary
                      ? `${device.heartbeat.submissionSummary.waitingFirstUpload} / ${device.heartbeat.submissionSummary.unconfirmed} / ${device.heartbeat.submissionSummary.failed}`
                      : '未知'}
                    <small>{formatTime(device.submissionSummaryUpdatedAt)}</small>
                  </td>
                  <td>{formatTime(device.lastHeartbeatAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      <Button size="small" onClick={() => setEditing(device)}>
                        编辑设备
                      </Button>
                      <Button
                        size="small"
                        disabled={action.busy}
                        onClick={() =>
                          ask({
                            title: '重置设备绑定',
                            message: `将撤销设备 ${device.number} 的登录凭证及相关任务，设备需要重新入网。本地作答不会删除。`,
                            danger: true,
                            run: async () => {
                              await session.mutate('postTeacherDevicesIdResetBinding', {
                                path: { id: device.id }
                              })
                              list.refresh()
                            }
                          })
                        }
                      >
                        重置绑定
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {list.data ? <ListFooter list={list} /> : null}
      {dialog}
      {editing ? (
        <DeviceEditor device={editing} close={() => setEditing(null)} saved={list.refresh} />
      ) : null}
    </Page>
  )
}

function DeviceEditor({
  device,
  close,
  saved
}: {
  device: Schema<'DeviceDetails'>
  close(): void
  saved(): void
}): JSX.Element {
  const { session } = useWorkspace()
  const [draft, setDraft] = useState({
    number: device.number,
    room: device.room ?? '',
    seat: device.seat ?? '',
    displayName: device.displayName ?? '',
    enabled: device.enabled
  })
  const [revision, setRevision] = useState(device.revision)
  const action = useLabAction()
  const confirmation = useConfirmation()
  const save = async (): Promise<void> => {
    await session.mutate('patchTeacherDevicesId', {
      path: { id: device.id },
      body: {
        ...draft,
        number: draft.number.trim(),
        room: draft.room || null,
        seat: draft.seat || null,
        displayName: draft.displayName || null,
        expectedRevision: revision
      }
    })
    saved()
    close()
  }
  return (
    <EditorModal title="编辑设备" close={close} busy={action.busy || confirmation.action.busy}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          if (device.enabled && !draft.enabled)
            confirmation.ask({
              title: '禁用设备',
              message: `禁用 ${device.number} 后将拒绝后续远程业务，本地正在进行的作答会保留。`,
              danger: true,
              run: save
            })
          else void action.run(save)
        }}
      >
        <div className={styles.grid}>
          {(
            [
              ['number', '设备编号'],
              ['displayName', '显示名称'],
              ['room', '机房'],
              ['seat', '座位']
            ] as const
          ).map(([key, label]) => (
            <Field key={key} htmlFor={`edit-device-${key}`} label={label}>
              <input
                id={`edit-device-${key}`}
                required={key === 'number'}
                maxLength={key === 'number' ? 64 : 200}
                value={draft[key]}
                disabled={action.busy}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </Field>
          ))}
        </div>
        <CheckField
          id="edit-device-enabled"
          label="启用设备"
          checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
        />
        <ActionNotice action={action} />
        <ActionNotice action={confirmation.action} />
        {action.error?.code === 'REVISION_CONFLICT' ? (
          <Button
            onClick={() =>
              void action.run(async () => {
                const current = await session.request<Schema<'DeviceDetails'>>(
                  'getTeacherDevicesId',
                  { path: { id: device.id } }
                )
                setDraft({
                  number: current.number,
                  room: current.room ?? '',
                  seat: current.seat ?? '',
                  displayName: current.displayName ?? '',
                  enabled: current.enabled
                })
                setRevision(current.revision)
              })
            }
          >
            放弃草稿并载入最新值
          </Button>
        ) : null}
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            disabled={action.busy || confirmation.action.busy || !draft.number.trim()}
          >
            保存设备
          </Button>
          <Button onClick={close} disabled={action.busy || confirmation.action.busy}>
            取消
          </Button>
        </div>
      </form>
      {confirmation.dialog}
    </EditorModal>
  )
}
