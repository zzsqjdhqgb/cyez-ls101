import { useState, type JSX } from 'react'
import { Button, Page, PageHeader, Field, Banner } from '@ls101/desktop-ui'
import type { Schema } from '@ls101/lab-contracts'
import type { TeacherOperation } from '@ls101/lab-desktop-host'
import { formatBytes, formatTime, useLabAction, useLabQuery } from '@ls101/lab-renderer'
import { useServiceList, useServiceQuery, useWorkspace } from '../session/workspace'
import {
  ActionNotice,
  ListFooter,
  QueryNotice,
  RefreshButton,
  useConfirmation
} from '../components/WorkspaceUI'
import styles from './Workspace.module.css'

export function SettingsPage(): JSX.Element {
  const [tab, setTab] = useState('settings')
  return (
    <Page>
      <PageHeader title="服务设置" />
      <div className={styles.tabs}>
        {[
          ['settings', '基本设置'],
          ['logs', '服务日志'],
          ['operations', '操作记录']
        ].map(([id, label]) => (
          <Button
            key={id}
            variant={tab === id ? 'primary' : 'ghost'}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === 'settings' ? (
        <SettingsContent />
      ) : tab === 'logs' ? (
        <LogsContent />
      ) : (
        <OperationsContent />
      )}
    </Page>
  )
}
function SettingsContent(): JSX.Element {
  const query = useServiceQuery<Schema<'Settings'>>('getTeacherSettings')
  return (
    <>
      <QueryNotice query={query} />
      <RefreshButton refresh={query.refresh} />
      {query.data ? (
        <SettingsForm key={query.data.revision} settings={query.data} refresh={query.refresh} />
      ) : null}
    </>
  )
}
function SettingsForm({
  settings,
  refresh
}: {
  settings: Schema<'Settings'>
  refresh(): void
}): JSX.Element {
  const { session } = useWorkspace()
  const [name, setName] = useState(settings.name)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [limits, setLimits] = useState(settings.limits)
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const { action, ask, dialog } = useConfirmation()
  const save = async (): Promise<void> => {
    await session.mutate('patchTeacherSettings', {
      body: {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        limits,
        expectedRevision: settings.revision
      }
    })
    await session.refreshService()
    setNotice('设置已保存。')
    refresh()
  }
  return (
    <>
      <form
        className={styles.card}
        onSubmit={(event) => {
          event.preventDefault()
          if (baseUrl.trim() !== settings.baseUrl)
            ask({
              title: '修改对外地址',
              message:
                '新地址仅用于以后签发的入网文件，已有客户端不会自动更新地址。请确认现有设备仍能连接。',
              run: save
            })
          else void action.run(save)
        }}
      >
        <h2>基本信息</h2>
        <div className={styles.grid}>
          <Field htmlFor="settings-name" label="服务名称">
            <input
              id="settings-name"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field htmlFor="settings-url" label="对外地址">
            <input
              id="settings-url"
              required
              type="url"
              pattern="https://.*"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field>
        </div>
        <h2>传输限制</h2>
        <div className={styles.grid}>
          {(
            [
              ['maxExamArchiveBytes', '试卷包上限（字节）'],
              ['maxSubmissionArchiveBytes', '作答包上限（字节）'],
              ['maxUncompressedBytes', '解压后大小上限（字节）'],
              ['maxArchiveFiles', '包内文件数上限']
            ] as const
          ).map(([key, label]) => (
            <Field key={key} htmlFor={`limit-${key}`} label={label}>
              <input
                id={`limit-${key}`}
                required
                type="number"
                min={1}
                max={Number.MAX_SAFE_INTEGER}
                step={1}
                value={limits[key]}
                onChange={(event) => setLimits({ ...limits, [key]: Number(event.target.value) })}
              />
            </Field>
          ))}
        </div>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={action.busy || !name.trim()}>
            保存设置
          </Button>
          {action.error?.code === 'REVISION_CONFLICT' ? (
            <Button onClick={refresh}>放弃草稿并载入最新值</Button>
          ) : null}
        </div>
      </form>
      <ActionNotice action={action} />
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      <section className={styles.card}>
        <h2>服务存储</h2>
        <div className={styles.stats}>
          {[
            ['已使用', settings.storage.usedBytes],
            ['可用空间', settings.storage.freeBytes],
            ['等待回收', settings.storage.pendingGcBytes]
          ].map(([label, bytes]) => (
            <div className={styles.stat} key={label}>
              {label}
              <strong>{formatBytes(Number(bytes))}</strong>
            </div>
          ))}
        </div>
        <p className={styles.hint}>
          监听端口、开机启动和数据恢复请在服务所在电脑的“本机服务管理”中操作。
        </p>
      </section>
      <form
        className={styles.card}
        onSubmit={(event) => {
          event.preventDefault()
          const next = password
          ask({
            title: '修改管理密码',
            message: '所有教师端会话将失效，修改成功后返回连接页。学生端连接不受影响。',
            danger: true,
            run: () => session.changePassword(next)
          })
          setPassword('')
        }}
      >
        <h2>管理密码</h2>
        <Field htmlFor="settings-password" label="新管理密码">
          <input
            id="settings-password"
            type="password"
            autoComplete="new-password"
            required
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <div>
          <Button disabled={action.busy || !password} type="submit">
            修改管理密码
          </Button>
        </div>
      </form>
      {dialog}
    </>
  )
}
function LogsContent(): JSX.Element {
  const [level, setLevel] = useState('')
  const list = useServiceList<Schema<'LogEntry'>>('getTeacherLogs', { level: level || undefined })
  return (
    <>
      <div className={styles.toolbar}>
        <label>
          日志级别
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">全部</option>
            <option value="info">信息</option>
            <option value="warn">警告</option>
            <option value="error">错误</option>
            <option value="debug">调试</option>
          </select>
        </label>
        <RefreshButton refresh={list.refresh} />
      </div>
      <QueryNotice query={list} />
      <div className={styles.tableFrame}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>时间</th>
              <th>级别</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((row) => (
              <tr key={row.id}>
                <td>{formatTime(row.at)}</td>
                <td>{row.level}</td>
                <td>{row.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data ? <ListFooter list={list} /> : null}
    </>
  )
}
function OperationsContent(): JSX.Element {
  const { session, view } = useWorkspace()
  const action = useLabAction()
  const query = useLabQuery<TeacherOperation[]>({
    queryKey: `operations:${view.connection!.info.serverId}`,
    queryFn: async () =>
      (await session.host.invoke<TeacherOperation[]>('operations.list')).filter(
        (item) => item.serverId === view.connection!.info.serverId
      ),
    pollMs: 5000
  })
  return (
    <>
      <p className={styles.hint}>
        结果未确认不代表操作失败。请先刷新相关页面核实；可重试的操作会沿用原来的请求标识和范围。
      </p>
      <RefreshButton refresh={query.refresh} />
      <QueryNotice query={query} />
      <ActionNotice action={action} />
      <div className={styles.tableFrame}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作</th>
              <th>结果</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.map((item) => (
              <tr key={item.id}>
                <td>{formatTime(item.at)}</td>
                <td>{operationName(item.operationId)}</td>
                <td>
                  {
                    {
                      sending: '结果未确认',
                      unknown: '结果未确认',
                      succeeded: '成功',
                      rejected: '已拒绝'
                    }[item.status]
                  }
                </td>
                <td>
                  {['unknown', 'sending'].includes(item.status) &&
                  item.idempotencyKey &&
                  !item.secretFields.length &&
                  !item.input.archive ? (
                    <Button
                      disabled={action.busy}
                      size="small"
                      onClick={() =>
                        void action.run(async () => {
                          await session.mutate(item.operationId, {
                            ...item.input,
                            idempotencyKey: item.idempotencyKey!
                          })
                          query.refresh()
                        })
                      }
                    >
                      重试原操作
                    </Button>
                  ) : ['unknown', 'sending'].includes(item.status) ? (
                    '请到对应页面核实结果'
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
function operationName(id: string): string {
  if (id.includes('Exams')) return '试卷管理'
  if (id.includes('Submissions')) return '作答管理'
  if (id.includes('Devices')) return '设备管理'
  if (id.includes('Enrollments')) return '设备入网'
  if (id.includes('TestRuns')) return '部署测试'
  if (id.includes('HistoryCleanups')) return '历史清理'
  if (id.includes('Backups')) return '服务备份'
  if (id.includes('Security')) return '管理密码'
  if (id.includes('Mode')) return '切换服务模式'
  return '服务设置'
}
