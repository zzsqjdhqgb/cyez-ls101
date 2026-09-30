import type { JSX, ReactNode } from 'react'
import styles from './PracticeNotice.module.css'

export function PracticeNotice({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className={styles.notice} role="status">
      {children}
    </div>
  )
}
