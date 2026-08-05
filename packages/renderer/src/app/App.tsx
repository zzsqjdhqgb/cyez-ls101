import type { JSX } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { AppToaster } from '../components/ui/ToastViewport'
import { ManualImageGenerationDialog } from '../features/airouter/ManualImageGenerationDialog'
import { InterfaceApplicationProvider } from '../features/interfaces/InterfaceApplicationProvider'
import { AppearanceSettingsProvider } from '../features/settings/AppearanceSettingsProvider'
import { TemplateApplicationProvider } from '../features/templates/TemplateApplicationProvider'
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

export function App(): JSX.Element {
  return (
    <AppearanceSettingsProvider>
      <InterfaceApplicationProvider>
        <TemplateApplicationProvider>
          <MemoryRouter>
            <RegisteredAppRoutes />
          </MemoryRouter>
          <ManualImageGenerationDialog />
          <AppToaster />
        </TemplateApplicationProvider>
      </InterfaceApplicationProvider>
    </AppearanceSettingsProvider>
  )
}
