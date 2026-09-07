import { useState, type JSX } from 'react'
import { Download, Pencil, Trash2, Upload } from 'lucide-react'
import type { Schema } from '@ls101/lab-contracts'
import { TeacherController } from './controller'
import { Dialog, Notice, Pager } from './ui'
import { bytes, time, useAction, useRead } from './hooks'

export function Exams({ controller }: { controller: TeacherController }): JSX.Element {
  const [cursor, setCursor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Schema<'Exam'> | null>(null)
  const list = useRead<Schema<'ExamList'>>(controller, 'getTeacherExams', {
    query: { cursor: cursor ?? undefined, limit: 50 }
  })
  const action = useAction(list.refresh)
  return (
    <>
      <div className="section-header">
        <h1>试卷</h1>
        <button
          className="primary"
          disabled={action.busy}
          onClick={() => action.run(() => controller.importExam())}
        >
          <Upload />
          导入试卷
        </button>
      </div>
      <Notice error={action.error ?? list.error} />
      <table>
        <thead>
          <tr>
            <th>试卷名称</th>
            <th>页数</th>
            <th>大小</th>
            <th>导入时间</th>
            <th>发布</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((exam) => (
            <tr key={exam.examId}>
              <td>{exam.title}</td>
              <td>{exam.pageCount}</td>
              <td>{bytes(exam.archiveBytes)}</td>
              <td>{time(exam.importedAt)}</td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`发布 ${exam.title}`}
                  checked={exam.published}
                  disabled={action.busy}
                  onChange={(event) =>
                    action.run(() =>
                      controller.mutate('patchTeacherExamsExamId', {
                        path: { examId: exam.examId },
                        body: { published: event.target.checked, expectedRevision: exam.revision }
                      })
                    )
                  }
                />
              </td>
              <td className="actions">
                <button
                  title="下载试卷"
                  aria-label="下载试卷"
                  onClick={() =>
                    action.run(() =>
                      controller.download(
                        'getTeacherExamsExamIdArchive',
                        { path: { examId: exam.examId } },
                        `${exam.title}.lsexam`
                      )
                    )
                  }
                >
                  <Download />
                </button>
                <button title="删除试卷" aria-label="删除试卷" onClick={() => setDeleting(exam)}>
                  <Trash2 />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.loading && !list.data?.items.length && <p className="empty">暂无试卷</p>}
      <Pager
        cursor={cursor}
        nextCursor={list.data?.nextCursor ?? null}
        onChange={setCursor}
        refresh={list.refresh}
      />
      {deleting && (
        <Dialog title="删除试卷" close={() => setDeleting(null)}>
          <p>{deleting.title}</p>
          <p>已收作答和已经发放的练习许可将保留。</p>
          <Notice error={action.error} />
          <button
            className="danger"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await controller.mutate('deleteTeacherExamsExamId', {
                  path: { examId: deleting.examId }
                })
                setDeleting(null)
              })
            }
          >
            确认删除
          </button>
        </Dialog>
      )}
    </>
  )
}

export function Submissions({ controller }: { controller: TeacherController }): JSX.Element {
  const [cursor, setCursor] = useState<string | null>(null),
    [candidateName, setName] = useState(''),
    [candidateId, setId] = useState(''),
    [room, setRoom] = useState('')
  const [selection, setSelection] = useState(new Map<string, Schema<'Submission'>>())
  const [confirm, setConfirm] = useState(false),
    [details, setDetails] = useState<Schema<'Submission'> | null>(null),
    [result, setResult] = useState<Schema<'BatchDeleteResult'> | null>(null)
  const list = useRead<Schema<'SubmissionList'>>(controller, 'getTeacherSubmissions', {
    query: {
      cursor: cursor ?? undefined,
      limit: 50,
      candidateName: candidateName || undefined,
      candidateId: candidateId || undefined,
      room: room || undefined
    }
  })
  const action = useAction(list.refresh)
  const select = (item: Schema<'Submission'>, checked: boolean): void =>
    setSelection((current) => {
      const next = new Map(current)
      if (checked) next.set(item.id, item)
      else next.delete(item.id)
      return next
    })
  return (
    <>
      <div className="section-header">
        <h1>作答</h1>
        <div className="actions">
          <span>已选 {selection.size}</span>
          <button
            disabled={action.busy || !selection.size || selection.size > 500}
            onClick={() =>
              action.run(() =>
                controller.download(
                  'postTeacherSubmissionsExport',
                  { body: { submissionIds: [...selection.keys()] } },
                  '作答.zip'
                )
              )
            }
          >
            <Download />
            导出
          </button>
          <button
            disabled={action.busy || !selection.size || selection.size > 500}
            onClick={() => setConfirm(true)}
          >
            <Trash2 />
            删除
          </button>
        </div>
      </div>
      <div className="filters">
        <label>
          姓名
          <input
            value={candidateName}
            onChange={(event) => {
              setName(event.target.value)
              setCursor(null)
            }}
          />
        </label>
        <label>
          考生号
          <input
            value={candidateId}
            onChange={(event) => {
              setId(event.target.value)
              setCursor(null)
            }}
          />
        </label>
        <label>
          接收时机房
          <input
            value={room}
            onChange={(event) => {
              setRoom(event.target.value)
              setCursor(null)
            }}
          />
        </label>
      </div>
      <Notice error={action.error ?? list.error} />
      <table>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                aria-label="选择本页"
                checked={
                  Boolean(list.data?.items.length) &&
                  list.data!.items.every((item) => selection.has(item.id))
                }
                onChange={(event) => {
                  for (const item of list.data?.items ?? []) select(item, event.target.checked)
                }}
              />
            </th>
            <th>姓名</th>
            <th>考生号</th>
            <th>设备</th>
            <th>接收时机房 / 座位</th>
            <th>接收时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`选择 ${item.candidate.displayName}`}
                  checked={selection.has(item.id)}
                  onChange={(event) => select(item, event.target.checked)}
                />
              </td>
              <td>
                <button className="text-button" onClick={() => setDetails(item)}>
                  {item.candidate.displayName}
                </button>
              </td>
              <td>{item.candidate.candidateId}</td>
              <td>{item.currentDevice.number}</td>
              <td>
                {item.deviceAtReceipt.room ?? '-'} / {item.deviceAtReceipt.seat ?? '-'}
              </td>
              <td>{time(item.receipt.receivedAt)}</td>
              <td>
                <button
                  title="下载原作答"
                  aria-label="下载原作答"
                  onClick={() =>
                    action.run(() =>
                      controller.download(
                        'getTeacherSubmissionsIdArchive',
                        { path: { id: item.id } },
                        `${item.candidate.displayName}.lssubmission`
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
      {!list.loading && !list.data?.items.length && <p className="empty">暂无作答</p>}
      <Pager
        cursor={cursor}
        nextCursor={list.data?.nextCursor ?? null}
        onChange={setCursor}
        refresh={list.refresh}
      />
      {confirm && (
        <Dialog title="删除所选作答" close={() => setConfirm(false)}>
          <p>确认删除 {selection.size} 份作答，成功回执将保留。此操作无法撤销。</p>
          <ul>
            {[...selection.values()].map((item) => (
              <li key={item.id}>
                {item.candidate.displayName} / {item.candidate.candidateId} /{' '}
                {time(item.receipt.receivedAt)}
              </li>
            ))}
          </ul>
          <button
            className="danger"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                setResult(
                  await controller.mutate('postTeacherSubmissionsDelete', {
                    body: { submissionIds: [...selection.keys()] }
                  })
                )
                setConfirm(false)
                setSelection(new Map())
              })
            }
          >
            确认删除
          </button>
          <Notice error={action.error} />
        </Dialog>
      )}
      {result && (
        <Dialog title="删除结果" close={() => setResult(null)}>
          <ul>
            {result.items.map((item) => (
              <li key={item.submissionId}>
                {item.submissionId}: {item.status}
                {item.status === 'failed' && ` (${item.error.code})`}
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {details && (
        <Dialog title="作答详情" close={() => setDetails(null)}>
          <dl>
            <dt>姓名 / 考生号</dt>
            <dd>
              {details.candidate.displayName} / {details.candidate.candidateId}
            </dd>
            <dt>接收时设备</dt>
            <dd>
              {details.deviceAtReceipt.number} / {details.deviceAtReceipt.room ?? '-'} /{' '}
              {details.deviceAtReceipt.seat ?? '-'}
            </dd>
            <dt>当前设备</dt>
            <dd>
              {details.currentDevice.number} / {details.currentDevice.room ?? '-'} /{' '}
              {details.currentDevice.seat ?? '-'}
            </dd>
            <dt>完成时间</dt>
            <dd>{time(details.submittedAt)}</dd>
            <dt>接收时间</dt>
            <dd>{time(details.receipt.receivedAt)}</dd>
          </dl>
        </Dialog>
      )}
    </>
  )
}

export function Devices({ controller }: { controller: TeacherController }): JSX.Element {
  const [cursor, setCursor] = useState<string | null>(null),
    [room, setRoom] = useState(''),
    [online, setOnline] = useState('')
  const [editing, setEditing] = useState<Schema<'DeviceDetails'> | null>(null),
    [reset, setReset] = useState<Schema<'DeviceDetails'> | null>(null)
  const list = useRead<Schema<'DeviceList'>>(
    controller,
    'getTeacherDevices',
    {
      query: {
        cursor: cursor ?? undefined,
        limit: 50,
        room: room || undefined,
        online: online ? online === 'true' : undefined
      }
    },
    true
  )
  const action = useAction(list.refresh)
  return (
    <>
      <div className="section-header">
        <h1>设备</h1>
      </div>
      <div className="filters">
        <label>
          机房
          <input
            value={room}
            onChange={(event) => {
              setRoom(event.target.value)
              setCursor(null)
            }}
          />
        </label>
        <label>
          在线状态
          <select
            value={online}
            onChange={(event) => {
              setOnline(event.target.value)
              setCursor(null)
            }}
          >
            <option value="">全部</option>
            <option value="true">在线</option>
            <option value="false">离线</option>
          </select>
        </label>
      </div>
      <Notice error={action.error ?? list.error} />
      <table>
        <thead>
          <tr>
            <th>编号</th>
            <th>计算机</th>
            <th>机房 / 座位</th>
            <th>版本 / 激活</th>
            <th>状态</th>
            <th>首次待传 / 未确认 / 异常</th>
            <th>最后心跳</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((device) => (
            <tr key={device.id}>
              <td>{device.number}</td>
              <td>{device.computerName}</td>
              <td>
                {device.room ?? '-'} / {device.seat ?? '-'}
              </td>
              <td>
                {device.heartbeat?.releaseVersion ?? '-'}
                <small>{device.heartbeat?.activationState ?? '未知'}</small>
              </td>
              <td>
                {!device.enabled
                  ? '已禁用'
                  : device.online
                    ? (device.heartbeat?.phase ?? '在线')
                    : '离线'}
              </td>
              <td>
                {device.heartbeat?.submissionSummary
                  ? `${device.heartbeat.submissionSummary.waitingFirstUpload} / ${device.heartbeat.submissionSummary.unconfirmed} / ${device.heartbeat.submissionSummary.failed}`
                  : '未知'}
              </td>
              <td>{time(device.lastHeartbeatAt)}</td>
              <td className="actions">
                <button title="编辑设备" aria-label="编辑设备" onClick={() => setEditing(device)}>
                  <Pencil />
                </button>
                <button title="重置绑定" aria-label="重置绑定" onClick={() => setReset(device)}>
                  重置绑定
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.loading && !list.data?.items.length && <p className="empty">暂无设备</p>}
      <Pager
        cursor={cursor}
        nextCursor={list.data?.nextCursor ?? null}
        onChange={setCursor}
        refresh={list.refresh}
      />
      {editing && (
        <DeviceEditor
          controller={controller}
          device={editing}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null)
            list.refresh()
          }}
        />
      )}
      {reset && (
        <Dialog title="重置设备绑定" close={() => setReset(null)}>
          <p>
            {reset.number} / {reset.computerName}
          </p>
          <p>设备凭证和维护任务将失效，需要重新入网。已收作答及本地历史保留。</p>
          <Notice error={action.error} />
          <button
            className="danger"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await controller.mutate('postTeacherDevicesIdResetBinding', {
                  path: { id: reset.id }
                })
                setReset(null)
              })
            }
          >
            确认重置
          </button>
        </Dialog>
      )}
    </>
  )
}

function DeviceEditor({
  controller,
  device,
  close,
  saved
}: {
  controller: TeacherController
  device: Schema<'DeviceDetails'>
  close(): void
  saved(): void
}): JSX.Element {
  const [draft, setDraft] = useState({
    number: device.number,
    room: device.room ?? '',
    seat: device.seat ?? '',
    displayName: device.displayName ?? '',
    enabled: device.enabled
  })
  const action = useAction(saved)
  return (
    <Dialog title="编辑设备" close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          action.run(() =>
            controller.mutate('patchTeacherDevicesId', {
              path: { id: device.id },
              body: {
                ...draft,
                room: draft.room || null,
                seat: draft.seat || null,
                displayName: draft.displayName || null,
                expectedRevision: device.revision
              }
            })
          )
        }}
      >
        {(
          [
            ['number', '编号'],
            ['room', '机房'],
            ['seat', '座位'],
            ['displayName', '显示名称']
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              required={key === 'number'}
              value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          </label>
        ))}
        <label className="check">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          启用设备
        </label>
        {!draft.enabled && <p>停用将阻止后续远程业务，当前本地作答可以继续保存。</p>}
        <Notice error={action.error} />
        <button className="primary" type="submit" disabled={action.busy}>
          保存
        </button>
      </form>
    </Dialog>
  )
}
