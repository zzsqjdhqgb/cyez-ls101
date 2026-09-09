import { useState, type JSX } from 'react'
import type { Schema } from '@ls101/lab-contracts'
import type { TeacherController } from './controller'
import { Dialog, Notice, Pager } from './ui'
import { bytes, time, useAction, useRead, usePagedRead } from './hooks'
import { Operations } from './operations'

export function Settings({ controller }: { controller: TeacherController }): JSX.Element {
  const settings = useRead<Schema<'Settings'>>(controller, 'getTeacherSettings')
  const logs = usePagedRead<Schema<'LogList'>>(
    controller,
    'getTeacherLogs',
    { query: { limit: 50 } },
    true
  )
  const [editing, setEditing] = useState(false),
    [password, setPassword] = useState('')
  const action = useAction(settings.refresh)
  return (
    <>
      <div className="section-header">
        <h1>服务设置</h1>
        <button disabled={!settings.data} onClick={() => setEditing(true)}>
          编辑设置
        </button>
      </div>
      <Notice error={action.error ?? settings.error} />
      {settings.data && (
        <dl>
          <dt>名称</dt>
          <dd>{settings.data.name}</dd>
          <dt>对外地址</dt>
          <dd>{settings.data.baseUrl}</dd>
          <dt>磁盘已用</dt>
          <dd>{bytes(settings.data.storage.usedBytes)}</dd>
          <dt>磁盘可用</dt>
          <dd>{bytes(settings.data.storage.freeBytes)}</dd>
          <dt>等待回收</dt>
          <dd>{bytes(settings.data.storage.pendingGcBytes)}</dd>
        </dl>
      )}
      <section className="settings-band">
        <h2>管理密码</h2>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault()
            const secret = password
            setPassword('')
            action.run(() => controller.changePassword(secret))
          }}
        >
          <label>
            新密码
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button disabled={action.busy} type="submit">
            修改并重新登录
          </button>
        </form>
      </section>
      <section className="settings-band">
        <h2>服务日志</h2>
        <Notice error={logs.error} />
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>级别</th>
              <th>消息</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.items.map((item) => (
              <tr key={item.id}>
                <td>{time(item.at)}</td>
                <td>{item.level}</td>
                <td>{item.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager
          cursor={logs.cursor}
          nextCursor={logs.data?.nextCursor ?? null}
          onChange={logs.setCursor}
          refresh={logs.refresh}
        />
      </section>
      <Operations controller={controller} />
      {editing && settings.data && (
        <SettingsEditor
          controller={controller}
          initial={settings.data}
          close={() => setEditing(false)}
          saved={() => {
            setEditing(false)
            settings.refresh()
          }}
        />
      )}
    </>
  )
}
function SettingsEditor({
  controller,
  initial,
  close,
  saved
}: {
  controller: TeacherController
  initial: Schema<'Settings'>
  close(): void
  saved(): void
}): JSX.Element {
  const [name, setName] = useState(initial.name),
    [baseUrl, setUrl] = useState(initial.baseUrl),
    [limits, setLimits] = useState(initial.limits)
  const [current, setCurrent] = useState(initial)
  const reload = useAction()
  const action = useAction(saved)
  return (
    <Dialog title="编辑服务设置" close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          action.run(() =>
            controller.mutate('patchTeacherSettings', {
              body: { name, baseUrl, limits, expectedRevision: current.revision }
            })
          )
        }}
      >
        <label>
          名称
          <input
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          对外地址
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <p>对外地址更改仅用于新入网文件。已有学生不会自动迁移。</p>
        {(
          [
            ['maxExamArchiveBytes', '试卷上限（字节）'],
            ['maxSubmissionArchiveBytes', '作答上限（字节）'],
            ['maxUncompressedBytes', '解压上限（字节）'],
            ['maxArchiveFiles', '归档文件数上限']
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={1}
              required
              value={limits[key]}
              onChange={(event) => setLimits({ ...limits, [key]: Number(event.target.value) })}
            />
          </label>
        ))}
        <Notice error={action.error} />
        <Notice error={reload.error} />
        {action.error && (
          <>
            <button
              type="button"
              disabled={reload.busy}
              onClick={() =>
                reload.run(async () => setCurrent(await controller.request('getTeacherSettings')))
              }
            >
              载入最新版本
            </button>
            <p>
              服务器：{current.name} / {current.baseUrl}（版本 {current.revision}）
            </p>
            <pre className="local-logs">{JSON.stringify(current.limits, null, 2)}</pre>
          </>
        )}
        <button className="primary" disabled={action.busy} type="submit">
          保存
        </button>
      </form>
    </Dialog>
  )
}
