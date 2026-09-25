import type { JSX, ReactNode } from 'react'
import { TitleBar } from '@ls101/desktop-ui'
import { StudentActions, StudentNotice } from './StudentStatus'
import styles from './GateScreen.module.css'

export function GateScreen({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className={styles.screen}>
      <TitleBar
        sidebarCollapsed={false}
        sidebarVisible={false}
        subtitle="学生端"
        actions={<StudentActions />}
      />
      <main className={styles.main}>
        <div className={styles.content}>
          <StudentNotice />
          {children}
        </div>
      </main>
    </div>
  )
}
