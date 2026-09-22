import { useEffect, useSyncExternalStore, type JSX } from 'react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { CircleAlert, FileText, History, ListChecks } from 'lucide-react'
import { AppShell, type AppRouteRegistration } from '@ls101/desktop-ui'
import { useLabAction } from '@ls101/lab-renderer'
import { ExamPlayer } from '@ls101/exam-player'
import { admission, canViewRecords } from '../../admission'
import { StudentController } from '../../controller'
import { DeploymentPlayer } from '../../deployment-player'
import { StudentActions, StudentStatus } from '../components/StudentStatus'
import { PracticeNotice } from '../components/PracticeNotice'
import { ActivationPage } from '../pages/ActivationPage'
import { ExamsPage } from '../pages/ExamsPage'
import { ErrorsPage, HistoryPage, PendingPage } from '../pages/RecordsPage'
import { StandbyPage } from '../pages/StandbyPage'
import { WorkspaceContext, useWorkspace } from '../session/workspace'

const controller = new StudentController(window.lab)
const routes: readonly AppRouteRegistration[] = [
  {
    id: 'exams',
    path: '/exams',
    component: ExamsPage,
    navigation: { icon: FileText, label: '试卷', order: 10 }
  },
  {
    id: 'pending',
    path: '/pending',
    component: PendingPage,
    navigation: { icon: ListChecks, label: '处理中', order: 20 }
  },
  {
    id: 'errors',
    path: '/errors',
    component: ErrorsPage,
    navigation: { icon: CircleAlert, label: '异常', order: 30 }
  },
  {
    id: 'history',
    path: '/history',
    component: HistoryPage,
    navigation: { icon: History, label: '历史', order: 40 }
  }
]

function StudentApplication(): JSX.Element {
  const { controller, view, gate, action } = useWorkspace()
  if (view.testPlayer && gate === 'maintenance')
    return <DeploymentPlayer player={view.testPlayer} />
  if (view.player)
    return (
      <>
        <ExamPlayer
          examBaseUrl={view.player.baseUrl}
          beforeStart={controller.beforeStart}
          onFinish={controller.finish}
          onPhaseChange={controller.phaseChanged}
          onExit={() => void action.run(() => controller.exitPractice())}
        />
        {(gate !== 'ready' || action.error) && (
          <PracticeNotice>
            {gate !== 'ready' && <StudentStatus />}
            {action.error && <div>{action.error.message}</div>}
          </PracticeNotice>
        )}
      </>
    )
  if (view.loading) return <StandbyPage />
  if (gate === 'activation-required') return <ActivationPage />
  if (!canViewRecords(view)) return <StandbyPage />
  return (
    <Routes>
      <Route element={<AppShell routes={routes} subtitle="学生端" actions={<StudentActions />} />}>
        <Route index element={<Navigate replace to="/exams" />} />
        {routes.map((route) => {
          const Component = route.component
          return <Route key={route.id} path={route.path} element={<Component />} />
        })}
      </Route>
    </Routes>
  )
}

export function App(): JSX.Element {
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const action = useLabAction()
  useEffect(() => {
    void controller.start()
    return () => {
      void controller.stop()
    }
  }, [])
  return (
    <WorkspaceContext.Provider value={{ controller, view, gate: admission(view), action }}>
      <MemoryRouter initialEntries={['/exams']}>
        <StudentApplication />
      </MemoryRouter>
    </WorkspaceContext.Provider>
  )
}
