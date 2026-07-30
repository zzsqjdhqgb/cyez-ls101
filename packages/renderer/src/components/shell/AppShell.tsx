import { useState, type JSX } from 'react'
import { Outlet } from 'react-router-dom'
import type { AppRouteRegistration } from '../../app/route-registry'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import styles from './AppShell.module.css'

interface AppShellProps {
  routes: readonly AppRouteRegistration[]
}

export function AppShell({ routes }: AppShellProps): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className={styles.shell} data-sidebar-collapsed={sidebarCollapsed || undefined}>
      <TitleBar sidebarCollapsed={sidebarCollapsed} />
      <div className={styles.workspace}>
        <Sidebar
          collapsed={sidebarCollapsed}
          routes={routes}
          onCollapsedChange={setSidebarCollapsed}
        />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
