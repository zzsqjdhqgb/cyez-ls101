import { useMemo, useState, type JSX } from 'react'
import { matchRoutes, Outlet, useLocation } from 'react-router-dom'
import type { AppRouteRegistration, RouteLayout } from '../../app/route-registry'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import styles from './AppShell.module.css'

interface AppShellProps {
  routes: readonly AppRouteRegistration[]
}

function resolveRouteLayout(
  routes: readonly AppRouteRegistration[],
  pathname: string
): RouteLayout {
  const matches = matchRoutes(
    routes.map((route) => ({ path: route.path, handle: route })),
    pathname
  )

  return matches?.at(-1)?.route.handle.layout ?? 'standard'
}

export function AppShell({ routes }: AppShellProps): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { pathname } = useLocation()
  const layout = useMemo(() => resolveRouteLayout(routes, pathname), [pathname, routes])
  const sidebarVisible = layout === 'standard'
  const titleBarVisible = layout !== 'immersive'

  return (
    <div
      className={styles.shell}
      data-layout={layout}
      data-sidebar-collapsed={sidebarVisible && sidebarCollapsed ? true : undefined}
    >
      {titleBarVisible ? (
        <TitleBar sidebarCollapsed={sidebarCollapsed} sidebarVisible={sidebarVisible} />
      ) : null}
      <div className={styles.workspace}>
        {sidebarVisible ? (
          <Sidebar
            collapsed={sidebarCollapsed}
            routes={routes}
            onCollapsedChange={setSidebarCollapsed}
          />
        ) : null}
        <main className={styles.content} data-layout={layout}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
