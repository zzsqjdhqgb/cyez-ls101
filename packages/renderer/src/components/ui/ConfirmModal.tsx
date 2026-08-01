import { AlertTriangle } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from './Button'
import styles from './ConfirmModal.module.css'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onCancel(): void
  onConfirm(): void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onCancel,
  onConfirm
}: ConfirmModalProps): JSX.Element | null {
  if (!open) return null

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onCancel}>
      <section
        aria-describedby="confirm-modal-description"
        aria-labelledby="confirm-modal-title"
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.icon} data-danger={danger || undefined}>
          <AlertTriangle aria-hidden="true" />
        </div>
        <div className={styles.content}>
          <h2 id="confirm-modal-title">{title}</h2>
          <p id="confirm-modal-description">{message}</p>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  )
}
