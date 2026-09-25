import type { JSX, ReactNode } from 'react'
import { CircleAlert, CircleCheckBig, Info, TriangleAlert } from 'lucide-react'
import styles from './Banner.module.css'

export type BannerTone = 'error' | 'warning' | 'success' | 'info'

interface BannerProps {
  tone?: BannerTone
  children: ReactNode
  actions?: ReactNode
  className?: string
}

export function Banner({ tone = 'info', children, actions, className }: BannerProps): JSX.Element {
  const Icon =
    tone === 'error'
      ? CircleAlert
      : tone === 'warning'
        ? TriangleAlert
        : tone === 'success'
          ? CircleCheckBig
          : Info

  return (
    <div
      className={[styles.banner, styles[tone], className].filter(Boolean).join(' ')}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" />
      <div className={styles.content}>{children}</div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  )
}
