import { type JSX, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react'
export function Notice({ error }: { error: string | null }): JSX.Element | null {
  return error ? (
    <p className="error-banner" role="alert">
      {error}
    </p>
  ) : null
}
export function Dialog({
  title,
  children,
  close
}: {
  title: string
  children: ReactNode
  close(): void
}): JSX.Element {
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button title="关闭对话框" aria-label="关闭对话框" onClick={close}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
export function Pager({
  cursor,
  nextCursor,
  onChange,
  refresh
}: {
  cursor: string | null
  nextCursor: string | null
  onChange(value: string | null): void
  refresh(): void
}): JSX.Element {
  return (
    <div className="pager">
      <button
        title="返回首页"
        aria-label="返回首页"
        disabled={!cursor}
        onClick={() => onChange(null)}
      >
        <ChevronLeft />
      </button>
      <button title="刷新列表" aria-label="刷新列表" onClick={refresh}>
        <RefreshCw />
      </button>
      <button
        title="下一页"
        aria-label="下一页"
        disabled={!nextCursor}
        onClick={() => onChange(nextCursor)}
      >
        <ChevronRight />
      </button>
    </div>
  )
}
