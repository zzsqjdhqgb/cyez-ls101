import type { JSX } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { AppRouteRegistration } from '../../app/route-registry'
import { Tooltip } from '../ui/Tooltip'
import styles from './Sidebar.module.css'

interface SidebarProps {
  routes: readonly AppRouteRegistration[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

function sortNavigationRoutes(routes: readonly AppRouteRegistration[]): AppRouteRegistration[] {
  return routes
    .filter((route) => route.navigation)
    .sort((left, right) => {
      const leftOrder = left.navigation?.order ?? 0
      const rightOrder = right.navigation?.order ?? 0
      return leftOrder - rightOrder
    })
}

function NavigationLink({
  route,
  collapsed
}: {
  route: AppRouteRegistration
  collapsed: boolean
}): JSX.Element | null {
  const navigation = route.navigation
  if (!navigation) return null

  const Icon = navigation.icon
  const link = (
    <NavLink
      aria-label={navigation.label}
      className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
      end={route.path === '/'}
      to={route.path}
    >
      <Icon aria-hidden="true" />
      <span>{navigation.label}</span>
    </NavLink>
  )

  return (
    <Tooltip label={navigation.label} side="right" disabled={!collapsed}>
      {link}
    </Tooltip>
  )
}

function NavigationList({
  routes,
  collapsed,
  placement
}: {
  routes: readonly AppRouteRegistration[]
  collapsed: boolean
  placement: 'main' | 'footer'
}): JSX.Element {
  const navigationRoutes = sortNavigationRoutes(routes).filter(
    (route) => (route.navigation?.placement ?? 'main') === placement
  )

  const groups = navigationRoutes.reduce<
    Array<{ key: string; label?: string; routes: AppRouteRegistration[] }>
  >((result, route) => {
    const label = route.navigation?.group
    const key = label ?? '__ungrouped__'
    const existingGroup = result.find((group) => group.key === key)

    if (existingGroup) {
      existingGroup.routes.push(route)
    } else {
      result.push({ key, label, routes: [route] })
    }

    return result
  }, [])

  return (
    <nav className={styles.navigation} aria-label={placement === 'main' ? '主导航' : '辅助导航'}>
      {groups.map((group) => (
        <div className={styles.group} key={group.key}>
          {group.label ? <div className={styles.groupLabel}>{group.label}</div> : null}
          {group.routes.map((route) => (
            <NavigationLink key={route.id} route={route} collapsed={collapsed} />
          ))}
        </div>
      ))}
    </nav>
  )
}

export function Sidebar({ routes, collapsed, onCollapsedChange }: SidebarProps): JSX.Element {
  const CollapseIcon = collapsed ? ChevronRight : ChevronLeft
  const collapseLabel = collapsed ? '展开侧边栏' : '收起侧边栏'

  return (
    <aside className={styles.sidebar} data-collapsed={collapsed || undefined}>
      <NavigationList routes={routes} collapsed={collapsed} placement="main" />
      <div className={styles.footer}>
        <NavigationList routes={routes} collapsed={collapsed} placement="footer" />
        <div className={styles.collapseRow}>
          <Tooltip label={collapseLabel} side="right" disabled={!collapsed}>
            <button
              aria-label={collapseLabel}
              className={styles.collapseButton}
              type="button"
              onClick={() => onCollapsedChange(!collapsed)}
            >
              <CollapseIcon aria-hidden="true" />
              <span>{collapseLabel}</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  )
}
