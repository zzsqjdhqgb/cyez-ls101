import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useRef, type JSX, type ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  onOpenChange(open: boolean): void
  children: ReactNode
  overlayClassName?: string
  dismissible?: boolean
}

export function Modal({
  open,
  onOpenChange,
  children,
  overlayClassName,
  dismissible = true
}: ModalProps): JSX.Element {
  const restoreFocus = useRef<HTMLElement | null>(null)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <div className={overlayClassName} role="presentation">
            <DialogPrimitive.Content
              aria-modal="true"
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
                if (!dismissible) event.preventDefault()
              }}
              onInteractOutside={(event) => {
                if (!dismissible) event.preventDefault()
              }}
              onPointerDownOutside={(event) => {
                if (!dismissible) event.preventDefault()
              }}
            >
              {children}
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export const ModalTitle = DialogPrimitive.Title
export const ModalDescription = DialogPrimitive.Description
export const ModalClose = DialogPrimitive.Close
