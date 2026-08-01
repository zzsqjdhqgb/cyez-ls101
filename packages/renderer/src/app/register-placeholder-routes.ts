import { PanelsTopLeft, Settings2, Shapes } from 'lucide-react'
import { InterfaceDetailsPage } from '../features/interfaces/InterfaceDetailsPage'
import { InterfaceDraftEditorPage } from '../features/interfaces/InterfaceDraftEditorPage'
import { InterfaceDraftListPage } from '../features/interfaces/InterfaceDraftListPage'
import { InterfaceInstanceEditorPage } from '../features/interfaces/InterfaceInstanceEditorPage'
import { InterfaceListPage } from '../features/interfaces/InterfaceListPage'
import { SettingsPlaceholderPage } from '../pages/SettingsPlaceholderPage'
import { WorkbenchPage } from '../pages/WorkbenchPage'
import { registerAppRoute } from './route-registry'

const unregisterRoutes = [
  // Default main navigation registration. `placement` defaults to `main`.
  registerAppRoute({
    id: 'workbench',
    path: '/',
    component: WorkbenchPage,
    layout: 'standard',
    navigation: {
      label: '工作台',
      icon: PanelsTopLeft,
      order: 0
    }
  }),

  registerAppRoute({
    id: 'interfaces',
    path: '/interfaces',
    component: InterfaceListPage,
    layout: 'standard',
    navigation: {
      label: '题型',
      icon: Shapes,
      order: 10
    }
  }),

  registerAppRoute({
    id: 'interface-drafts',
    path: '/interfaces/drafts',
    component: InterfaceDraftListPage,
    layout: 'standard'
  }),

  registerAppRoute({
    id: 'interface-draft-editor',
    path: '/interfaces/drafts/:draftId',
    component: InterfaceDraftEditorPage,
    layout: 'focus'
  }),

  registerAppRoute({
    id: 'interface-details',
    path: '/interfaces/:interfaceId',
    component: InterfaceDetailsPage,
    layout: 'standard'
  }),

  registerAppRoute({
    id: 'interface-instance-editor',
    path: '/interfaces/:interfaceId/instances/:instanceId',
    component: InterfaceInstanceEditorPage,
    layout: 'focus'
  }),

  // Footer navigation registration.
  registerAppRoute({
    id: 'settings-placeholder',
    path: '/settings',
    component: SettingsPlaceholderPage,
    navigation: {
      label: '设置',
      icon: Settings2,
      placement: 'footer',
      order: 0
    }
  })
]

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterRoutes.forEach((unregister) => unregister())
  })
}
