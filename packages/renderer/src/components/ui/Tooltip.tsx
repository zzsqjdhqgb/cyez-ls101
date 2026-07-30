import type { ReactNode } from 'react'
import styles from './Tooltip.module.css'

interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  disabled?: boolean
}

export function Tooltip({
  label,
  children,
  side = 'top',
  disabled = false
}: TooltipProps): ReactNode {
  if (disabled) return children

  return (
    <span className={styles.root} data-side={side}>
      {children}
      <span className={styles.content} role="tooltip">
        {label}
      </span>
    </span>
  )
}
