import { useEffect, type JSX } from 'react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { FileText, Inbox, LogOut, Monitor, RefreshCw, Settings, Wrench } from 'lucide-react'
import { AppShell, IconButton, type AppRouteRegistration } from '@ls101/desktop-ui'
import { useLabAction } from '@ls101/lab-renderer'
import { ActivationPage } from '../pages/ActivationPage'
import { ConnectionPage } from '../pages/ConnectionPage'
import { WorkspacePage } from '../pages/WorkspacePage'
import type { TeacherSession, TeacherView } from '../session/session'
import { useTeacherSession } from '../session/useTeacherSession'
import styles from './App.module.css'

function ExamsPage(): JSX.Element {
  return <WorkspacePage description="试卷列表、导入、上架与删除将在这里实现。" title="试卷" />
}

function SubmissionsPage(): JSX.Element {
  return <WorkspacePage description="作答筛选、导出与删除将在这里实现。" title="作答" />
}

function DevicesPage(): JSX.Element {
  return <WorkspacePage description="设备列表、编辑与重置绑定将在这里实现。" title="设备" />
}

function MaintenancePage(): JSX.Element {
  return <WorkspacePage description="入网、部署测试、历史清理与备份将在这里实现。" title="维护" />
}

function SettingsPage(): JSX.Element {
  return (
    <WorkspacePage description="服务设置、密码、日志与未确认操作将在这里实现。" title="服务设置" />
  )
}

const routes: readonly AppRouteRegistration[] = [
  {
    component: ExamsPage,
    id: 'exams',
    navigation: { icon: FileText, label: '试卷', order: 10 },
    path: '/exams'
  },
  {
    component: SubmissionsPage,
    id: 'submissions',
    navigation: { icon: Inbox, label: '作答', order: 20 },
    path: '/submissions'
  },
  {
    component: DevicesPage,
    id: 'devices',
    navigation: { icon: Monitor, label: '设备', order: 30 },
    path: '/devices'
  },
  {
    component: MaintenancePage,
    id: 'maintenance',
    navigation: { icon: Wrench, label: '维护', order: 40 },
    path: '/maintenance'
  },
  {
    component: SettingsPage,
    id: 'settings',
    navigation: { icon: Settings, label: '服务设置', order: 50 },
    path: '/settings'
  }
]

function ServiceActions({
  session,
  view
}: {
  session: TeacherSession
  view: TeacherView
}): JSX.Element {
  const action = useLabAction()
  const maintenance = view.service?.mode === 'maintenance'

  return (
    <>
      <div className={styles.identity}>
        <strong>{view.service?.name ?? view.connection?.info.name}</strong>
        <span>
          {view.target?.baseUrl ?? '本机服务'} · {view.connection?.info.releaseVersion}
        </span>
      </div>
      <span
        className={[styles.mode, maintenance ? styles.maintenance : null].filter(Boolean).join(' ')}
      >
        {maintenance ? '维护模式' : '正常模式'}
      </span>
      <IconButton
        disabled={action.busy}
        icon={RefreshCw}
        label="刷新服务"
        onClick={() => void action.run(() => session.refreshService())}
      />
      <IconButton icon={LogOut} label="切换服务" onClick={() => void session.disconnect()} />
    </>
  )
}

function Workspace({ session, view }: { session: TeacherSession; view: TeacherView }): JSX.Element {
  useEffect(() => {
    let running = false
    const timer = setInterval(() => {
      if (running) return
      running = true
      void session
        .refreshService()
        .catch(() => undefined)
        .finally(() => {
          running = false
        })
    }, 5000)

    return () => clearInterval(timer)
  }, [session])

  return (
    <MemoryRouter initialEntries={['/exams']}>
      <Routes>
        <Route
          element={
            <AppShell
              actions={<ServiceActions session={session} view={view} />}
              routes={routes}
              subtitle="教师端"
              title="曹二听说101"
            />
          }
        >
          <Route element={<Navigate replace to="/exams" />} index />
          {routes.map((route) => {
            const Component = route.component
            return <Route element={<Component />} key={route.id} path={route.path} />
          })}
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

export function App(): JSX.Element {
  const { session, view } = useTeacherSession()

  useEffect(() => {
    void session.start()
  }, [session])

  if (view.loading) return <div className={styles.loading}>正在启动</div>
  if (!view.active) return <ActivationPage session={session} />
  if (!view.connection) return <ConnectionPage session={session} view={view} />

  return <Workspace session={session} view={view} />
}
