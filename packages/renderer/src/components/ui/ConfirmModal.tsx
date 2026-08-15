import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { AlertTriangle, CircleAlert } from 'lucide-react'
import { useRef, type JSX } from 'react'
import { Button } from './Button'
import styles from './ConfirmModal.module.css'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  secondaryLabel?: string
  danger?: boolean
  error?: string | null
  busy?: boolean
  closeOnConfirm?: boolean
  onCancel(): void
  onConfirm(): void
  onSecondary?(): void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = '确认',
  secondaryLabel,
  danger = false,
  error = null,
  busy = false,
  closeOnConfirm = true,
  onCancel,
  onConfirm,
  onSecondary
}: ConfirmModalProps): JSX.Element | null {
  const actionTriggered = useRef(false)
  const restoreFocus = useRef<HTMLElement | null>(null)

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          actionTriggered.current = false
        } else if (actionTriggered.current) {
          actionTriggered.current = false
        } else {
          onCancel()
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay asChild>
          <div className={styles.backdrop} role="presentation">
            <AlertDialog.Content
              asChild
              onCloseAutoFocus={(event) => {
                if (restoreFocus.current?.isConnected) {
                  event.preventDefault()
                  restoreFocus.current.focus()
                }
              }}
              onOpenAutoFocus={() => {
                const activeElement = document.activeElement
                restoreFocus.current = activeElement instanceof HTMLElement ? activeElement : null
              }}
              onEscapeKeyDown={(event) => {
                event.preventDefault()
              }}
            >
              <section aria-modal="true" className={styles.dialog}>
                <div className={styles.icon} data-danger={danger || undefined}>
                  <AlertTriangle aria-hidden="true" />
                </div>
                <div className={styles.content}>
                  <AlertDialog.Title asChild>
                    <h2>{title}</h2>
                  </AlertDialog.Title>
                  <AlertDialog.Description asChild>
                    <div>
                      <p>{message}</p>
                      {error ? (
                        <div className={styles.error} role="alert">
                          <CircleAlert aria-hidden="true" />
                          <span>{error}</span>
                        </div>
                      ) : null}
                    </div>
                  </AlertDialog.Description>
                </div>
                <div className={styles.actions}>
                  <AlertDialog.Cancel asChild>
                    <Button disabled={busy} variant="ghost">
                      取消
                    </Button>
                  </AlertDialog.Cancel>
                  {secondaryLabel && onSecondary ? (
                    <Button disabled={busy} onClick={onSecondary}>
                      {secondaryLabel}
                    </Button>
                  ) : null}
                  <AlertDialog.Action asChild>
                    <Button
                      aria-busy={busy}
                      disabled={busy}
                      variant={danger ? 'danger' : 'primary'}
                      onClick={(event) => {
                        if (closeOnConfirm) actionTriggered.current = true
                        else event.preventDefault()
                        onConfirm()
                      }}
                    >
                      {busy ? '正在处理...' : confirmLabel}
                    </Button>
                  </AlertDialog.Action>
                </div>
              </section>
            </AlertDialog.Content>
          </div>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
