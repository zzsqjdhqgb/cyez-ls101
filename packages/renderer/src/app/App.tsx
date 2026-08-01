import type { JSX } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { InterfaceApplicationProvider } from '../features/interfaces/InterfaceApplicationProvider'
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
    <InterfaceApplicationProvider>
      <MemoryRouter>
        <RegisteredAppRoutes />
      </MemoryRouter>
    </InterfaceApplicationProvider>
  )
}
