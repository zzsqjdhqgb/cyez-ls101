import { useState, type JSX } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { AppToaster } from '../components/ui/ToastViewport'
import { ManualImageGenerationDialog } from '../features/airouter/ManualImageGenerationDialog'
import { ExamLibraryProvider } from '../features/exams/ExamLibraryProvider'
import { InterfaceApplicationProvider } from '../features/interfaces/InterfaceApplicationProvider'
import { BuiltinInterfaceMaintenanceDialog } from '../features/interfaces/BuiltinInterfaceMaintenanceDialog'
import { SchemaApplicationProvider } from '../features/schemas/SchemaApplicationProvider'
import { AppearanceSettingsProvider } from '../features/settings/AppearanceSettingsProvider'
import { SubmissionLibraryProvider } from '../features/submissions/SubmissionLibraryProvider'
import { TemplateApplicationProvider } from '../features/templates/TemplateApplicationProvider'
import { ReleaseNotesModal } from '../features/release-notes/ReleaseNotesModal'
import { NotFoundPage } from '../pages/NotFoundPage'
import { useRegisteredRoutes } from './route-registry'

function RegisteredAppRoutes(): JSX.Element {
  const routes = useRegisteredRoutes()

  return (
    <Routes>
      <Route element={<AppShell routes={routes} />}>
        {routes.map((route) => {
          const Component = route.component
          return <Route key={route.id} path={route.path} element={<Component />} />
        })}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

interface AppProps {
  showReleaseNotesOnStartup?: boolean
}

export function App({ showReleaseNotesOnStartup = false }: AppProps): JSX.Element {
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(showReleaseNotesOnStartup)

  return (
    <AppearanceSettingsProvider>
      <InterfaceApplicationProvider>
        <SchemaApplicationProvider>
          <ExamLibraryProvider>
            <SubmissionLibraryProvider>
              <TemplateApplicationProvider>
                <MemoryRouter>
                  <RegisteredAppRoutes />
                </MemoryRouter>
                <ManualImageGenerationDialog />
                <BuiltinInterfaceMaintenanceDialog />
                <ReleaseNotesModal open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen} />
                <AppToaster />
              </TemplateApplicationProvider>
            </SubmissionLibraryProvider>
          </ExamLibraryProvider>
        </SchemaApplicationProvider>
      </InterfaceApplicationProvider>
    </AppearanceSettingsProvider>
  )
}
