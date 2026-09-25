import { useEffect, useState, type JSX } from 'react'
import { Button, Field } from '@ls101/desktop-ui'
import type { Schema } from '@ls101/lab-contracts'
import { formatBytes, formatTime } from '@ls101/lab-renderer'
import { useServiceList, useWorkspace } from '../../session/workspace'
import {
  ActionNotice,
  EmptyList,
  ListFooter,
  QueryNotice,
  RefreshButton,
  Status,
  useConfirmation
} from '../../components/WorkspaceUI'
import styles from '../Workspace.module.css'

export function EnrollmentPanel(): JSX.Element {
  const { session, view } = useWorkspace()
  const [minutes, setMinutes] = useState(10)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const list = useServiceList<Schema<'Enrollment'>>('getTeacherEnrollments', {}, 5000)
  const { action, ask, dialog } = useConfirmation()
  return (
    <div className={styles.stack}>
      <form
        className={styles.toolbar}
        onSubmit={(event) => {
          event.preventDefault()
          ask({
            title: '开启设备入网',
            message: `将进入维护模式，入网文件有效期 ${minutes} 分钟。请只将文件提供给本次需要加入的设备。`,
            run: async () => {
              await session.refreshService()
              await session.mutate('postTeacherEnrollments', {
                body: {
                  expectedModeRevision: session.getSnapshot().service!.modeRevision,
                  validForSeconds: minutes * 60
                }
              })
              await session.refreshService()
              list.first()
            }
          })
        }}
      >
        <label>
          有效期（分钟）
          <input
            type="number"
            min={1}
            max={1440}
            required
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={action.busy || Boolean(view.service?.openEnrollment)}
        >
          开启入网
        </Button>
        <RefreshButton refresh={list.refresh} />
      </form>
      <p className={styles.hint}>
        下载入网文件后，在学生端导入。关闭或到期后不能继续注册，已入网的设备会保留。
      </p>
      <ActionNotice action={action} />
      <QueryNotice query={list} />
      <EmptyList visible={Boolean(list.data && !list.data.items.length)} title="暂无入网批次" />
      {list.data?.items.length ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>创建时间</th>
                <th>状态</th>
                <th>到期时间</th>
                <th>已注册设备</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((row) => (
                <tr key={row.id}>
                  <td>{formatTime(row.issuedAt)}</td>
                  <td>
                    <Status value={row.status} />
                  </td>
                  <td>{formatTime(row.expiresAt)}</td>
                  <td>{row.registeredCount}</td>
                  <td>
                    <div className={styles.actions}>
                      <Button
                        size="small"
                        disabled={
                          action.busy || row.status !== 'active' || Date.parse(row.expiresAt) <= now
                        }
                        onClick={() =>
                          void action.run(() =>
                            session.download(
                              'getTeacherEnrollmentsIdFile',
                              { path: { id: row.id } },
                              '设备入网.lsjoin'
                            )
                          )
                        }
                      >
                        下载入网文件
                      </Button>
                      <Button
                        size="small"
                        disabled={action.busy || row.status !== 'active'}
                        onClick={() =>
                          ask({
                            title: '关闭入网',
                            message: '关闭后，该批次入网文件将立即失效，已经注册的设备不受影响。',
                            run: async () => {
                              await session.mutate('deleteTeacherEnrollmentsId', {
                                path: { id: row.id }
                              })
                              await session.refreshService()
                              list.refresh()
                            }
                          })
                        }
                      >
                        关闭入网
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
    </div>
  )
}

export function BackupPanel(): JSX.Element {
  const { session, view } = useWorkspace()
  const [password, setPassword] = useState('')
  const list = useServiceList<Schema<'Backup'>>('getTeacherBackups', {}, 5000)
  const { action, ask, dialog } = useConfirmation()
  return (
    <div className={styles.stack}>
      <p className={styles.hint}>
        备份需要维护模式，且其他任务已经结束。请妥善保存备份密码；恢复后不包含快照时间之后的收卷数据。恢复操作在服务所在电脑停服后进行。
      </p>
      <form
        className={styles.toolbar}
        onSubmit={(event) => {
          event.preventDefault()
          const encryptionPassword = password
          setPassword('')
          ask({
            title: '创建加密备份',
            message: '快照期间会暂时停止数据写入。备份结束前不能退出维护，请妥善保存密码。',
            run: async () => {
              await session.mutate('postTeacherBackups', { body: { encryptionPassword } })
              list.first()
              await session.refreshService()
            }
          })
        }}
      >
        <Field htmlFor="backup-encryption-password" label="备份密码">
          <input
            id="backup-encryption-password"
            autoComplete="new-password"
            type="password"
            required
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={
            action.busy ||
            view.service?.mode !== 'maintenance' ||
            Boolean(view.service?.blockers.length) ||
            !password
          }
        >
          创建备份
        </Button>
        <RefreshButton refresh={list.refresh} />
      </form>
      <ActionNotice action={action} />
      <QueryNotice query={list} />
      <EmptyList visible={Boolean(list.data && !list.data.items.length)} title="暂无服务备份" />
      {list.data?.items.length ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>创建时间</th>
                <th>状态</th>
                <th>快照时间</th>
                <th>版本</th>
                <th>大小</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((row) => (
                <tr key={row.id}>
                  <td>{formatTime(row.createdAt)}</td>
                  <td>
                    <Status value={row.status} />
                    {row.error ? <small>{row.error.message}</small> : null}
                  </td>
                  <td>{formatTime(row.snapshotAt)}</td>
                  <td>{row.releaseVersion}</td>
                  <td>{formatBytes(row.archiveBytes)}</td>
                  <td>
                    <Button
                      size="small"
                      disabled={action.busy || row.status !== 'ready'}
                      onClick={() =>
                        void action.run(() =>
                          session.download(
                            'getTeacherBackupsIdArchive',
                            { path: { id: row.id } },
                            `服务备份-${row.id}.7z`
                          )
                        )
                      }
                    >
                      下载备份
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {list.data ? <ListFooter list={list} /> : null}
      {dialog}
    </div>
  )
}
