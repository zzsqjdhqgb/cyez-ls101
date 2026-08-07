import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { AlertTriangle } from 'lucide-react'
import { useRef, type JSX } from 'react'
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
                    <p>{message}</p>
                  </AlertDialog.Description>
                </div>
                <div className={styles.actions}>
                  <AlertDialog.Cancel asChild>
                    <Button variant="ghost">取消</Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <Button
                      variant={danger ? 'danger' : 'primary'}
                      onClick={() => {
                        actionTriggered.current = true
                        onConfirm()
                      }}
                    >
                      {confirmLabel}
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
