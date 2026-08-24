import type { ComponentType, JSX, SVGProps } from 'react'
import styles from './EmptyState.module.css'

type EmptyStateIcon = ComponentType<SVGProps<SVGSVGElement>>

interface EmptyStateProps {
  icon: EmptyStateIcon
  title: string
}

export function EmptyState({ icon: Icon, title }: EmptyStateProps): JSX.Element {
  return (
    <div className={styles.root}>
      <div className={styles.icon}>
        <Icon aria-hidden="true" />
      </div>
      <p>{title}</p>
    </div>
  )
}
