import { useState, type JSX, type ReactNode } from 'react'
import { Inbox, RefreshCw } from 'lucide-react'
import {
  Banner,
  Button,
  ConfirmModal,
  EmptyState,
  Modal,
  ModalPanel,
  modalBackdropClassName
} from '@ls101/desktop-ui'
import { useLabAction, type LabQueryResult, type LabAction } from '@ls101/lab-renderer'
import type { ServiceList } from '../session/workspace'
import styles from '../pages/Workspace.module.css'

export function QueryNotice({
  query
}: {
  query: Pick<LabQueryResult<unknown>, 'loading' | 'error' | 'stale'>
}): JSX.Element {
  return (
    <>
      {query.loading ? (
        <p className={styles.hint} role="status">
          正在加载…
        </p>
      ) : null}
      {query.error ? (
        <Banner tone="error">
          {query.stale ? '刷新失败，以下为上次读取的数据。' : ''}
          {query.error.message}
        </Banner>
      ) : null}
    </>
  )
}
export function ActionNotice({ action }: { action: LabAction }): JSX.Element {
  return (
    <>
      {action.error ? <Banner tone="error">{action.error.message}</Banner> : null}
      {action.busy ? (
        <p className={styles.hint} role="status">
          正在处理，请稍候…
        </p>
      ) : null}
    </>
  )
}
export function RefreshButton({
  refresh,
  disabled
}: {
  refresh(): void
  disabled?: boolean
}): JSX.Element {
  return (
    <Button icon={RefreshCw} disabled={disabled} onClick={refresh}>
      刷新
    </Button>
  )
}
export function ListFooter<T>({
  list
}: {
  list: LabQueryResult<ServiceList<T>> & { page: number; next(): void; previous(): void }
}): JSX.Element {
  return (
    <div className={styles.pagination}>
      <span>
        第 {list.page} 页 · 本页 {list.data?.items.length ?? 0} 条
      </span>
      <Button size="small" disabled={list.page === 1 || list.loading} onClick={list.previous}>
        上一页
      </Button>
      <Button size="small" disabled={!list.data?.nextCursor || list.loading} onClick={list.next}>
        下一页
      </Button>
    </div>
  )
}
export function EmptyList({
  visible,
  title = '暂无数据'
}: {
  visible: boolean
  title?: string
}): JSX.Element | null {
  return visible ? <EmptyState icon={Inbox} title={title} /> : null
}
export function EditorModal({
  title,
  close,
  children,
  busy = false
}: {
  title: string
  close(): void
  children: ReactNode
  busy?: boolean
}): JSX.Element {
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
      overlayClassName={modalBackdropClassName}
    >
      <ModalPanel
        title={title}
        close={() => {
          if (!busy) close()
        }}
        width="large"
      >
        {children}
      </ModalPanel>
    </Modal>
  )
}
type Confirmation = {
  title: string
  message: string
  danger?: boolean
  run(): Promise<unknown>
}
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirmation(): {
  action: LabAction
  ask: (confirmation: Confirmation) => void
  dialog: JSX.Element
} {
  const action = useLabAction()
  const [pending, setPending] = useState<Confirmation | null>(null)
  return {
    action,
    ask: setPending,
    dialog: (
      <ConfirmModal
        open={pending !== null}
        title={pending?.title ?? ''}
        message={pending?.message ?? ''}
        danger={pending?.danger}
        busy={action.busy}
        confirmLabel="确认"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending)
            void action.run(async () => {
              await pending.run()
              setPending(null)
            })
        }}
      />
    )
  }
}
export function Status({ value }: { value: string }): JSX.Element {
  return (
    <span
      className={styles.badge}
      data-tone={
        ['failed', 'error', 'expired'].includes(value)
          ? 'error'
          : ['running', 'pending', 'cancel-requested', 'manual-required'].includes(value)
            ? 'warning'
            : undefined
      }
    >
      {statusLabel(value)}
    </span>
  )
}
// eslint-disable-next-line react-refresh/only-export-components
export function statusLabel(value: string): string {
  return (
    (
      {
        pending: '等待执行',
        running: '执行中',
        'cancel-requested': '停止中',
        succeeded: '已完成',
        failed: '失败',
        cancelled: '已取消',
        expired: '已过期',
        passed: '通过',
        'manual-required': '待人工确认',
        'not-confirmed': '未确认',
        previewing: '预览中',
        'awaiting-confirmation': '等待确认',
        executing: '清理中',
        ready: '可下载',
        active: '开放中',
        revoked: '已关闭',
        idle: '空闲',
        preparing: '准备中',
        practicing: '练习中',
        saving: '保存中',
        'maintenance-idle': '维护待机',
        testing: '测试中',
        error: '异常',
        deleted: '已删除',
        'already-deleted': '已删除'
      } as Record<string, string>
    )[value] ?? value
  )
}
