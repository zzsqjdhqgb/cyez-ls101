import type { JSX } from 'react'
import { Download, Inbox, RefreshCw } from 'lucide-react'
import { Button, EmptyState, IconButton, Page, PageHeader } from '@ls101/desktop-ui'
import { formatTime, useSelection } from '@ls101/lab-renderer'
import { StudentNotice } from '../components/StudentStatus'
import { useWorkspace } from '../session/workspace'
import styles from './Workspace.module.css'

const recordLabels: Record<string, string> = {
  queued: '等待上传',
  sending: '正在上传',
  checking: '待核对',
  'retry-required': '需要重试',
  completed: '提交完成',
  'manual-resolution': '需要人工处理'
}

function RecordsPage({ kind }: { kind: 'pending' | 'errors' | 'history' }): JSX.Element {
  const { view, gate, controller, action } = useWorkspace()
  const selection = useSelection()
  const records = view.records.filter((record) =>
    kind === 'history'
      ? record.state === 'completed'
      : kind === 'errors'
        ? record.state !== 'completed' &&
          (record.lastError ||
            record.state === 'retry-required' ||
            record.state === 'manual-resolution')
        : record.state !== 'completed'
  )
  const exportable = records.filter((record) => record.archivePresent)
  // Background receipts and cleanup can remove a selected row while this page remains open.
  const selected = exportable
    .filter((record) => selection.has(record.submissionId))
    .map((record) => record.submissionId)
  return (
    <Page>
      <PageHeader
        title={kind === 'history' ? '历史作答' : kind === 'errors' ? '异常作答' : '处理中'}
        actions={
          <Button
            disabled={action.busy || selected.length === 0}
            onClick={() => void action.run(() => controller.exportRecords(selected))}
          >
            <Download aria-hidden="true" />
            导出所选
          </Button>
        }
      />
      <div className={styles.stack}>
        <StudentNotice />
        {records.length === 0 ? (
          <EmptyState icon={Inbox} title="暂无记录" />
        ) : (
          <>
            <div className={styles.tableFrame}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.selectColumn}>
                      <input
                        type="checkbox"
                        aria-label="选择全部可导出作答"
                        disabled={exportable.length === 0}
                        checked={exportable.length > 0 && selected.length === exportable.length}
                        ref={(element) => {
                          if (element)
                            element.indeterminate =
                              selected.length > 0 && selected.length < exportable.length
                        }}
                        onChange={(event) =>
                          selection.set(
                            event.target.checked
                              ? exportable.map((record) => record.submissionId)
                              : []
                          )
                        }
                      />
                    </th>
                    <th>姓名</th>
                    <th>考生号</th>
                    <th>完成时间</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.submissionId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择 ${record.candidate.displayName}`}
                          disabled={!record.archivePresent}
                          checked={record.archivePresent && selection.has(record.submissionId)}
                          onChange={(event) =>
                            selection.toggle(record.submissionId, event.target.checked)
                          }
                        />
                      </td>
                      <td>
                        <strong>{record.candidate.displayName}</strong>
                      </td>
                      <td>{record.candidate.candidateId}</td>
                      <td>{formatTime(record.submittedAt)}</td>
                      <td>
                        <span className={styles.badge} data-state={record.state}>
                          {recordLabels[record.state]}
                        </span>
                        {record.lastError && <small>{record.lastError}</small>}
                        {record.retryPolicy === 'receipt-only' && <small>原服务回执待核对</small>}
                      </td>
                      <td>
                        {record.state !== 'completed' && record.retryPolicy !== 'receipt-only' && (
                          <IconButton
                            icon={RefreshCw}
                            label="重试提交"
                            disabled={action.busy || gate !== 'ready'}
                            onClick={() =>
                              void action.run(() => controller.retry(record.submissionId))
                            }
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.summary}>
              共 {records.length} 份作答，已选择 {selected.length} 份
            </div>
          </>
        )}
      </div>
    </Page>
  )
}

export function PendingPage(): JSX.Element {
  return <RecordsPage kind="pending" />
}

export function ErrorsPage(): JSX.Element {
  return <RecordsPage kind="errors" />
}

export function HistoryPage(): JSX.Element {
  return <RecordsPage kind="history" />
}
