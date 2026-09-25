import { useState, type JSX } from 'react'
import { Button, Page, PageHeader, Banner } from '@ls101/desktop-ui'
import { Download, Trash2 } from 'lucide-react'
import type { Schema } from '@ls101/lab-contracts'
import { formatBytes, formatTime, useSelection } from '@ls101/lab-renderer'
import { useServiceList, useWorkspace } from '../session/workspace'
import {
  ActionNotice,
  EditorModal,
  EmptyList,
  ListFooter,
  QueryNotice,
  RefreshButton,
  useConfirmation
} from '../components/WorkspaceUI'
import styles from './Workspace.module.css'

export function SubmissionsPage(): JSX.Element {
  const { session } = useWorkspace()
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [draftFilters, setDraftFilters] = useState<Record<string, string>>({})
  const [filterError, setFilterError] = useState('')
  const [detail, setDetail] = useState<Schema<'Submission'> | null>(null)
  const [deleted, setDeleted] = useState<Schema<'BatchDeleteResult'> | null>(null)
  const list = useServiceList<Schema<'Submission'>>(
    'getTeacherSubmissions',
    Object.fromEntries(
      Object.entries(filters)
        .filter(([, value]) => value)
        .map(([key, value]) => [
          key,
          ['from', 'before'].includes(key) ? new Date(value).toISOString() : value
        ])
    )
  )
  const selection = useSelection()
  const { action, ask, dialog } = useConfirmation()
  const rows = list.data?.items ?? []
  const selectedIds = [...selection.selected]
  const deleteSelected = (): void => {
    const ids = [...selection.selected]
    ask({
      title: '删除选中作答',
      message: `将永久删除选中的 ${ids.length} 份服务端作答。学生端本地记录不会被删除；当前筛选变化不会扩大本次范围。`,
      danger: true,
      run: async () => {
        const result = await session.mutate<Schema<'BatchDeleteResult'>>(
          'postTeacherSubmissionsDelete',
          { body: { submissionIds: ids } }
        )
        setDeleted(result)
        selection.set(
          result.items.filter((item) => item.status === 'failed').map((item) => item.submissionId)
        )
        list.first()
      }
    })
  }
  return (
    <Page>
      <PageHeader title="作答" actions={<RefreshButton refresh={list.refresh} />} />
      <form
        className={styles.toolbar}
        onSubmit={(event) => {
          event.preventDefault()
          const invalidDate = (['from', 'before'] as const).find(
            (key) => draftFilters[key] && Number.isNaN(Date.parse(draftFilters[key]))
          )
          if (invalidDate) {
            setFilterError(`${invalidDate === 'from' ? '起始' : '结束'}时间格式无效。`)
            return
          }
          setFilterError('')
          setFilters(draftFilters)
          selection.clear()
          setDeleted(null)
        }}
      >
        {(
          [
            ['candidateName', '姓名'],
            ['candidateId', '考生号'],
            ['room', '接收时机房'],
            ['examId', '试卷 ID'],
            ['deviceId', '设备 ID'],
            ['from', '接收时间从'],
            ['before', '接收时间至']
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type={['from', 'before'].includes(key) ? 'datetime-local' : 'search'}
              value={draftFilters[key] ?? ''}
              onChange={(event) => setDraftFilters({ ...draftFilters, [key]: event.target.value })}
            />
          </label>
        ))}
        <Button type="submit" variant="primary" disabled={action.busy}>
          应用筛选
        </Button>
        <Button
          type="button"
          onClick={() => {
            setDraftFilters({})
            setFilters({})
            setFilterError('')
            selection.clear()
            setDeleted(null)
          }}
        >
          清空筛选
        </Button>
      </form>
      {filterError ? <Banner tone="warning">{filterError}</Banner> : null}
      <div className={styles.actions}>
        <span className={styles.hint}>已选 {selection.size} 份（最多 500 份）</span>
        <Button
          icon={Download}
          disabled={!selection.size || selection.size > 500 || action.busy}
          onClick={() =>
            void action.run(() =>
              session.download(
                'postTeacherSubmissionsExport',
                { body: { submissionIds: selectedIds } },
                '作答.zip'
              )
            )
          }
        >
          导出选中
        </Button>
        <Button
          icon={Trash2}
          disabled={!selection.size || selection.size > 500 || action.busy}
          onClick={deleteSelected}
        >
          删除选中
        </Button>
        <Button variant="ghost" disabled={!selection.size} onClick={selection.clear}>
          取消选择
        </Button>
      </div>
      <ActionNotice action={action} />
      <QueryNotice query={list} />
      {deleted ? (
        <Banner
          tone={deleted.items.some((item) => item.status === 'failed') ? 'warning' : 'success'}
        >
          删除结果：{deleted.items.filter((item) => item.status !== 'failed').length} 份已删除，
          {deleted.items.filter((item) => item.status === 'failed').length} 份失败。
          {deleted.items
            .filter((item) => item.status === 'failed')
            .map((item) => (
              <div key={item.submissionId}>
                {item.submissionId}：{'error' in item ? item.error.message : '删除失败'}
              </div>
            ))}
        </Banner>
      ) : null}
      <EmptyList visible={Boolean(list.data && !rows.length)} title="暂无符合条件的作答" />
      {rows.length ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="选择本页作答"
                    checked={rows.every((row) => selection.has(row.id))}
                    onChange={(event) => {
                      const next = new Set(selection.selected)
                      for (const row of rows) {
                        if (event.target.checked) next.add(row.id)
                        else next.delete(row.id)
                      }
                      selection.set(next)
                    }}
                  />
                </th>
                <th>考生</th>
                <th>试卷</th>
                <th>接收时设备</th>
                <th>接收时间</th>
                <th>大小</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`选择作答 ${row.candidate.displayName}`}
                      checked={selection.has(row.id)}
                      onChange={() => selection.toggle(row.id)}
                    />
                  </td>
                  <td>
                    <strong>{row.candidate.displayName}</strong>
                    <small>{row.candidate.candidateId}</small>
                  </td>
                  <td>{row.packageId}</td>
                  <td>
                    {row.deviceAtReceipt.number}
                    <small>
                      {row.deviceAtReceipt.room ?? '未分配机房'} /{' '}
                      {row.deviceAtReceipt.seat ?? '未分配座位'}
                    </small>
                  </td>
                  <td>{formatTime(row.receipt.receivedAt)}</td>
                  <td>{formatBytes(row.archiveBytes)}</td>
                  <td>
                    <div className={styles.actions}>
                      <Button size="small" onClick={() => setDetail(row)}>
                        详情
                      </Button>
                      <Button
                        size="small"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(() =>
                            session.download(
                              'getTeacherSubmissionsIdArchive',
                              { path: { id: row.id } },
                              `${row.candidate.displayName}-${row.candidate.candidateId}.lssubmission`
                            )
                          )
                        }
                      >
                        导出
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
      {detail ? (
        <EditorModal title="作答详情" close={() => setDetail(null)}>
          <dl className={styles.details}>
            <dt>考生</dt>
            <dd>
              {detail.candidate.displayName} · {detail.candidate.candidateId}
            </dd>
            <dt>作答 ID</dt>
            <dd>{detail.id}</dd>
            <dt>试卷 ID</dt>
            <dd>{detail.examId}</dd>
            <dt>提交时间</dt>
            <dd>{formatTime(detail.submittedAt)}</dd>
            <dt>接收时间</dt>
            <dd>{formatTime(detail.receipt.receivedAt)}</dd>
            <dt>接收时设备</dt>
            <dd>
              {detail.deviceAtReceipt.number} / {detail.deviceAtReceipt.room ?? '未分配'} /{' '}
              {detail.deviceAtReceipt.seat ?? '未分配'}
            </dd>
            <dt>当前设备</dt>
            <dd>
              {detail.currentDevice.number} / {detail.currentDevice.room ?? '未分配'} /{' '}
              {detail.currentDevice.seat ?? '未分配'}
            </dd>
          </dl>
        </EditorModal>
      ) : null}
    </Page>
  )
}
