import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import { ModalTitle } from './Modal'
import styles from './ModalPanel.module.css'

interface ModalPanelProps extends HTMLAttributes<HTMLDivElement> {
  title: string
  children: ReactNode
  close(): void
  width?: 'small' | 'medium' | 'large'
}

/**
 * Panel surface for `Modal`. Forwards its ref and spreads Radix's content props onto the root
 * element so `Modal`'s `asChild` content keeps role="dialog" and its accessible name.
 */
export const ModalPanel = forwardRef<HTMLDivElement, ModalPanelProps>(function ModalPanel(
  { title, children, close, width = 'medium', className, ...props },
  ref
) {
  return (
    <div
      {...props}
      className={[styles.panel, styles[width], className].filter(Boolean).join(' ')}
      ref={ref}
    >
      <header className={styles.header}>
        <ModalTitle asChild>
          <h2>{title}</h2>
        </ModalTitle>
        <IconButton icon={X} label="关闭对话框" onClick={close} />
      </header>
      {children}
    </div>
  )
})
